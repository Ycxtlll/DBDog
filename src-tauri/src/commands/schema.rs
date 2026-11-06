use crate::drivers::backend::resolve;
use crate::error::AppError;
use crate::schema::model::{CompletionSchema, Database, SearchResult, Table, TableDetails};
use crate::state::AppState;
use uuid::Uuid;

#[tauri::command]
pub async fn get_databases(
    state: tauri::State<'_, AppState>,
    connection_id: Uuid,
) -> Result<Vec<Database>, AppError> {
    if let Some(dbs) = state.schema_cache.get_databases(connection_id) {
        return Ok(dbs);
    }

    let backend = resolve(&state, connection_id).await?;
    let dbs = backend.fetch_databases().await?;
    state.schema_cache.set_databases(connection_id, &dbs);
    Ok(dbs)
}

#[tauri::command]
pub async fn get_tables(
    state: tauri::State<'_, AppState>,
    connection_id: Uuid,
    database: String,
) -> Result<Vec<Table>, AppError> {
    if let Some(tables) = state.schema_cache.get_tables(connection_id, &database) {
        return Ok(tables);
    }

    let backend = resolve(&state, connection_id).await?;
    let tables = backend.fetch_tables(&database).await?;
    state
        .schema_cache
        .set_tables(connection_id, &database, &tables);
    Ok(tables)
}

#[tauri::command]
pub async fn get_table_details(
    state: tauri::State<'_, AppState>,
    connection_id: Uuid,
    database: String,
    table: String,
) -> Result<TableDetails, AppError> {
    if let Some(details) = state
        .schema_cache
        .get_table_details(connection_id, &database, &table)
    {
        return Ok(details);
    }

    let backend = resolve(&state, connection_id).await?;
    let details = backend.fetch_table_details(&database, &table).await?;
    state
        .schema_cache
        .set_table_details(connection_id, &database, &table, &details);
    Ok(details)
}

#[tauri::command]
pub async fn refresh_schema(
    state: tauri::State<'_, AppState>,
    connection_id: Uuid,
    database: Option<String>,
) -> Result<(), AppError> {
    match database {
        Some(db) => state.schema_cache.invalidate_database(&connection_id, &db),
        None => state.schema_cache.invalidate_connection(&connection_id),
    }
    Ok(())
}

#[tauri::command]
pub async fn search_schema(
    state: tauri::State<'_, AppState>,
    connection_id: Uuid,
    keyword: String,
) -> Result<Vec<SearchResult>, AppError> {
    let backend = resolve(&state, connection_id).await?;
    backend.search_schema(&keyword).await
}

/// Full database → table → column snapshot for the SQL editor's completion.
/// Not cached server-side: the frontend keeps its own TTL cache and
/// refetches on schema changes, so this stays cheap (one
/// information_schema.columns pass) and always reasonably fresh.
#[tauri::command]
pub async fn get_completion_schema(
    state: tauri::State<'_, AppState>,
    connection_id: Uuid,
    database: Option<String>,
) -> Result<CompletionSchema, AppError> {
    let backend = resolve(&state, connection_id).await?;
    backend
        .fetch_completion_schema(database.as_deref())
        .await
}

/// Generate the target-reshaping ALTER statements for a structure diff
/// (compare feature). Pure generation, no connection.
#[tauri::command]
pub async fn compare_alter_statements_command(
    database: String,
    diff: serde_json::Value,
) -> Result<Vec<String>, AppError> {
    crate::schema::alter_gen::compare_alter_statements(&database, &diff)
}

/// Generate a single multi-clause ALTER TABLE for the visual table designer.
#[tauri::command]
pub async fn designer_prepare_alter(
    database: String,
    table: String,
    orig_columns: Vec<crate::schema::alter_gen::DesignerColumn>,
    columns: Vec<crate::schema::alter_gen::DesignerColumn>,
    orig_indexes: Vec<crate::schema::alter_gen::DesignerIndex>,
    indexes: Vec<crate::schema::alter_gen::DesignerIndex>,
) -> Result<crate::schema::alter_gen::AlterBuildResult, AppError> {
    Ok(crate::schema::alter_gen::designer_alter_statement(
        &database,
        &table,
        &orig_columns,
        &columns,
        &orig_indexes,
        &indexes,
    ))
}

/// Designer sanity checks (i18n key + params for the first problem).
#[tauri::command]
pub async fn designer_validate_command(
    columns: Vec<crate::schema::alter_gen::DesignerColumn>,
    indexes: Vec<crate::schema::alter_gen::DesignerIndex>,
) -> Result<Option<crate::schema::alter_gen::DesignError>, AppError> {
    Ok(crate::schema::alter_gen::designer_validate(&columns, &indexes))
}

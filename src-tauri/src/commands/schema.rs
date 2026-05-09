use crate::drivers::mysql::metadata::MySqlDriver;
use crate::drivers::DatabaseMetadata;
use crate::error::AppError;
use crate::schema::model::{Database, SearchResult, Table, TableDetails};
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

    let pool = state
        .pool_manager
        .get(&connection_id)
        .ok_or_else(|| AppError::ConnectionNotFound(connection_id.to_string()))?;

    let driver = MySqlDriver::new();
    let dbs = driver.fetch_databases(&pool).await?;
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

    let pool = state
        .pool_manager
        .get(&connection_id)
        .ok_or_else(|| AppError::ConnectionNotFound(connection_id.to_string()))?;

    let driver = MySqlDriver::new();
    let tables = driver.fetch_tables(&pool, &database).await?;
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

    let pool = state
        .pool_manager
        .get(&connection_id)
        .ok_or_else(|| AppError::ConnectionNotFound(connection_id.to_string()))?;

    let driver = MySqlDriver::new();
    let details = driver.fetch_table_details(&pool, &database, &table).await?;
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
    let pool = state
        .pool_manager
        .get(&connection_id)
        .ok_or_else(|| AppError::ConnectionNotFound(connection_id.to_string()))?;

    let driver = MySqlDriver::new();
    driver.search_schema(&pool, &keyword).await
}

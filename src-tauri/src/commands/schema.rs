use tauri::State;

use crate::db::driver::*;
use crate::db::types::*;
use crate::error::{AppError, Result};
use crate::state::AppState;

#[tauri::command]
pub async fn list_databases(
    connection_id: String,
    use_cache: Option<bool>,
    state: State<'_, AppState>,
) -> Result<Vec<String>> {
    let should_cache = use_cache.unwrap_or(true);

    if should_cache {
        if let Some(cached) = state.schema_cache.get_databases(&connection_id) {
            return Ok(cached);
        }
        if let Some(cached) = state.disk_cache.get_databases(&connection_id) {
            state.schema_cache.set_databases(&connection_id, cached.clone());
            return Ok(cached);
        }
    }

    let pool = state
        .pool_manager
        .get(&connection_id)
        .ok_or_else(|| AppError::Connection("Not connected".to_string()))?;

    let databases = state.driver.list_databases(&pool).await?;
    state.schema_cache.set_databases(&connection_id, databases.clone());
    state.disk_cache.set_databases(&connection_id, databases.clone());
    let _ = state.disk_cache.save();
    Ok(databases)
}

#[tauri::command]
pub async fn list_tables(
    connection_id: String,
    database: String,
    filter: Option<String>,
    use_cache: Option<bool>,
    state: State<'_, AppState>,
) -> Result<Vec<TableInfo>> {
    let should_cache = use_cache.unwrap_or(true) && filter.is_none();

    if should_cache {
        if let Some(cached) = state.schema_cache.get_tables(&connection_id, &database) {
            return Ok(cached);
        }
        if let Some(cached) = state.disk_cache.get_tables(&connection_id, &database) {
            state.schema_cache.set_tables(&connection_id, &database, cached.clone());
            return Ok(cached);
        }
    }

    let pool = state
        .pool_manager
        .get(&connection_id)
        .ok_or_else(|| AppError::Connection("Not connected".to_string()))?;

    let tables = state
        .driver
        .list_tables(&pool, &database, filter.as_deref())
        .await?;

    if should_cache {
        state.schema_cache.set_tables(&connection_id, &database, tables.clone());
        state.disk_cache.set_tables(&connection_id, &database, tables.clone());
        let _ = state.disk_cache.save();
    }

    Ok(tables)
}


#[tauri::command]
pub async fn describe_table(
    connection_id: String,
    database: String,
    table: String,
    state: State<'_, AppState>,
) -> Result<TableDetail> {
    let pool = state
        .pool_manager
        .get(&connection_id)
        .ok_or_else(|| AppError::Connection("Not connected".to_string()))?;

    state.driver.describe_table(&pool, &database, &table).await
}

#[tauri::command]
pub async fn get_create_table_sql(
    connection_id: String,
    database: String,
    table: String,
    state: State<'_, AppState>,
) -> Result<String> {
    let pool = state
        .pool_manager
        .get(&connection_id)
        .ok_or_else(|| AppError::Connection("Not connected".to_string()))?;

    state.driver.get_create_table_sql(&pool, &database, &table).await
}

#[tauri::command]
pub async fn search_schema(
    connection_id: String,
    query: String,
    state: State<'_, AppState>,
) -> Result<Vec<SchemaSearchHit>> {
    let pool = state
        .pool_manager
        .get(&connection_id)
        .ok_or_else(|| AppError::Connection("Not connected".to_string()))?;

    state.driver.search_schema(&pool, &query).await
}

#[tauri::command]
pub async fn refresh_schema(
    connection_id: String,
    database: Option<String>,
    state: State<'_, AppState>,
) -> Result<()> {
    if let Some(db) = database {
        state.schema_cache.invalidate_database(&connection_id, &db);
        state.disk_cache.invalidate_database(&connection_id, &db);
    } else {
        state.schema_cache.invalidate_connection(&connection_id);
        state.disk_cache.invalidate_connection(&connection_id);
    }
    let _ = state.disk_cache.save();
    Ok(())
}

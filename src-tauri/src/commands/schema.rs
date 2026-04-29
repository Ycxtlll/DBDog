use tauri::State;

use crate::db::types::*;
use crate::error::{AppError, Result};
use crate::state::AppState;
use crate::db::driver::*;

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
    }

    let pool = state
        .pool_manager
        .get(&connection_id)
        .ok_or_else(|| AppError::Connection("Not connected".to_string()))?;

    let databases = state.driver.list_databases(&pool).await?;
    state.schema_cache.set_databases(&connection_id, databases.clone());
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
    let should_cache = use_cache.unwrap_or(true);

    if should_cache && filter.is_none() {
        if let Some(cached) = state.schema_cache.get_tables(&connection_id, &database) {
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

    if filter.is_none() {
        state
            .schema_cache
            .set_tables(&connection_id, &database, tables.clone());
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
pub async fn refresh_schema(
    connection_id: String,
    database: Option<String>,
    state: State<'_, AppState>,
) -> Result<()> {
    match database {
        Some(db) => state.schema_cache.invalidate_database(&connection_id, &db),
        None => state.schema_cache.invalidate_connection(&connection_id),
    }
    Ok(())
}

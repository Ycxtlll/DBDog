use tauri::State;

use crate::db::types::*;
use crate::error::{AppError, Result};
use crate::state::AppState;
use crate::db::driver::*;

#[tauri::command]
pub async fn get_columns(
    connection_id: String,
    database: String,
    table: String,
    use_cache: Option<bool>,
    state: State<'_, AppState>,
) -> Result<Vec<ColumnInfo>> {
    let should_cache = use_cache.unwrap_or(true);

    if should_cache {
        if let Some(cached) = state
            .schema_cache
            .get_columns(&connection_id, &database, &table)
        {
            return Ok(cached);
        }
    }

    let pool = state
        .pool_manager
        .get(&connection_id)
        .ok_or_else(|| AppError::Connection("Not connected".to_string()))?;

    let columns = state.driver.get_columns(&pool, &database, &table).await?;
    state
        .schema_cache
        .set_columns(&connection_id, &database, &table, columns.clone());
    Ok(columns)
}

#[tauri::command]
pub async fn get_indexes(
    connection_id: String,
    database: String,
    table: String,
    state: State<'_, AppState>,
) -> Result<Vec<IndexInfo>> {
    let pool = state
        .pool_manager
        .get(&connection_id)
        .ok_or_else(|| AppError::Connection("Not connected".to_string()))?;

    state.driver.get_indexes(&pool, &database, &table).await
}

#[tauri::command]
pub async fn get_foreign_keys(
    connection_id: String,
    database: String,
    table: String,
    state: State<'_, AppState>,
) -> Result<Vec<ForeignKeyInfo>> {
    let pool = state
        .pool_manager
        .get(&connection_id)
        .ok_or_else(|| AppError::Connection("Not connected".to_string()))?;

    state.driver.get_foreign_keys(&pool, &database, &table).await
}

#[tauri::command]
pub async fn get_triggers(
    connection_id: String,
    database: String,
    table: String,
    state: State<'_, AppState>,
) -> Result<Vec<TriggerInfo>> {
    let pool = state
        .pool_manager
        .get(&connection_id)
        .ok_or_else(|| AppError::Connection("Not connected".to_string()))?;

    state.driver.get_triggers(&pool, &database, &table).await
}

#[tauri::command]
pub async fn list_views(
    connection_id: String,
    database: String,
    state: State<'_, AppState>,
) -> Result<Vec<String>> {
    let pool = state
        .pool_manager
        .get(&connection_id)
        .ok_or_else(|| AppError::Connection("Not connected".to_string()))?;

    state.driver.list_views(&pool, &database).await
}

use tauri::State;

use crate::db::types::{QueryResult, UpdateResult};
use crate::error::{AppError, Result};
use crate::state::AppState;
use crate::db::driver::*;

#[tauri::command]
pub async fn execute_query(
    connection_id: String,
    sql: String,
    limit: Option<u64>,
    state: State<'_, AppState>,
) -> Result<QueryResult> {
    let pool = state
        .pool_manager
        .get(&connection_id)
        .ok_or_else(|| AppError::Connection(format!("Connection '{}' is not active. Please connect first.", connection_id)))?;

    state.driver.execute_query(&pool, &sql, limit).await
}

#[tauri::command]
pub async fn execute_update(
    connection_id: String,
    sql: String,
    state: State<'_, AppState>,
) -> Result<UpdateResult> {
    let pool = state
        .pool_manager
        .get(&connection_id)
        .ok_or_else(|| AppError::Connection(format!("Connection '{}' is not active. Please connect first.", connection_id)))?;

    let result = state.driver.execute_update(&pool, &sql).await?;

    // Detect DDL and invalidate cache
    let sql_upper = sql.trim().to_uppercase();
    if sql_upper.starts_with("ALTER")
        || sql_upper.starts_with("CREATE")
        || sql_upper.starts_with("DROP")
        || sql_upper.starts_with("RENAME")
        || sql_upper.starts_with("TRUNCATE")
    {
        // Broad invalidation for DDL — we don't know which database was affected
        state.schema_cache.invalidate_connection(&connection_id);
    }

    Ok(result)
}

#[tauri::command]
pub async fn cancel_query(
    connection_id: String,
    state: State<'_, AppState>,
) -> Result<()> {
    let pool = state
        .pool_manager
        .get(&connection_id)
        .ok_or_else(|| AppError::Connection(format!("Connection '{}' is not active. Please connect first.", connection_id)))?;

    state.driver.cancel_query(&pool).await
}

#[tauri::command]
pub async fn explain_query(
    connection_id: String,
    sql: String,
    state: State<'_, AppState>,
) -> Result<QueryResult> {
    let pool = state
        .pool_manager
        .get(&connection_id)
        .ok_or_else(|| AppError::Connection(format!("Connection '{}' is not active. Please connect first.", connection_id)))?;

    let explain_sql = format!("EXPLAIN {}", sql);
    state.driver.execute_query(&pool, &explain_sql, None).await
}

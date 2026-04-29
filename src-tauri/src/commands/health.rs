use tauri::State;

use crate::db::types::*;
use crate::error::{AppError, Result};
use crate::state::AppState;
use crate::db::driver::*;

#[tauri::command]
pub async fn get_process_list(
    connection_id: String,
    state: State<'_, AppState>,
) -> Result<Vec<ProcessInfo>> {
    let pool = state
        .pool_manager
        .get(&connection_id)
        .ok_or_else(|| AppError::Connection("Not connected".to_string()))?;

    state.driver.get_process_list(&pool).await
}

#[tauri::command]
pub async fn get_status_variables(
    connection_id: String,
    state: State<'_, AppState>,
) -> Result<Vec<StatusVariable>> {
    let pool = state
        .pool_manager
        .get(&connection_id)
        .ok_or_else(|| AppError::Connection("Not connected".to_string()))?;

    state.driver.get_status_variables(&pool).await
}

#[tauri::command]
pub async fn get_system_variables(
    connection_id: String,
    state: State<'_, AppState>,
) -> Result<Vec<SystemVariable>> {
    let pool = state
        .pool_manager
        .get(&connection_id)
        .ok_or_else(|| AppError::Connection("Not connected".to_string()))?;

    state.driver.get_system_variables(&pool).await
}

#[tauri::command]
pub async fn get_innodb_status(
    connection_id: String,
    state: State<'_, AppState>,
) -> Result<InnodbStatus> {
    let pool = state
        .pool_manager
        .get(&connection_id)
        .ok_or_else(|| AppError::Connection("Not connected".to_string()))?;

    state.driver.get_innodb_status(&pool).await
}

#[tauri::command]
pub async fn kill_process(
    connection_id: String,
    process_id: u64,
    state: State<'_, AppState>,
) -> Result<()> {
    let pool = state
        .pool_manager
        .get(&connection_id)
        .ok_or_else(|| AppError::Connection("Not connected".to_string()))?;

    state.driver.kill_process(&pool, process_id).await
}

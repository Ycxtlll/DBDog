use tauri::State;

use crate::db::driver::*;
use crate::db::types::{ConnectionConfig, ConnectionInfo, ConnectionSummary};
use crate::error::Result;
use crate::state::AppState;

#[tauri::command]
pub async fn test_connection(config: ConnectionConfig, state: State<'_, AppState>) -> Result<()> {
    state.driver.test_connection(&config).await
}

#[tauri::command]
pub async fn save_connection(config: ConnectionConfig, state: State<'_, AppState>) -> Result<String> {
    state.connection_manager.save(config).await
}

#[tauri::command]
pub async fn list_connections(state: State<'_, AppState>) -> Result<Vec<ConnectionSummary>> {
    Ok(state.connection_manager.list().await)
}

#[tauri::command]
pub async fn delete_connection(id: String, state: State<'_, AppState>) -> Result<()> {
    let _ = state.pool_manager.disconnect(&id).await;
    state.connection_manager.delete(&id).await
}

#[tauri::command]
pub async fn connect(id: String, state: State<'_, AppState>) -> Result<ConnectionInfo> {
    let mut config = state
        .connection_manager
        .get(&id)
        .await
        .ok_or_else(|| crate::error::AppError::NotFound(format!("Connection {} not found", id)))?;

    if config.password.is_empty() {
        if let Ok(pwd) = state.connection_manager.load_password(&id).await {
            config.password = pwd;
        }
    }

    let pool = state.pool_manager.get_or_create(&state.driver, &config).await?;
    let version = state.driver.server_version(&pool).await?;

    state.disk_cache.warm_up_l1(&id, &state.schema_cache);

    Ok(ConnectionInfo {
        id: config.id,
        name: config.name,
        server_version: version,
        db_type: config.db_type,
    })
}

#[tauri::command]
pub async fn disconnect(id: String, state: State<'_, AppState>) -> Result<()> {
    state.pool_manager.disconnect(&id).await?;
    state.schema_cache.invalidate_connection(&id);
    Ok(())
}

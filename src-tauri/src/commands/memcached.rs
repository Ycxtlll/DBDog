use crate::connection::model::DatabaseType;
use crate::drivers::memcached::{
    MemcachedDriver, MemcachedEntry, MemcachedKeyList, MemcachedServerInfo,
};
use crate::error::AppError;
use crate::state::AppState;
use uuid::Uuid;

#[tauri::command]
pub async fn memcached_list_keys(
    state: tauri::State<'_, AppState>,
    connection_id: Uuid,
    search: Option<String>,
) -> Result<MemcachedKeyList, AppError> {
    let config = state.get_config(&connection_id).await?;
    if config.db_type != DatabaseType::Memcached {
        return Err(AppError::DriverNotSupported(
            "此操作仅支持 Memcached 连接".into(),
        ));
    }
    MemcachedDriver::list_keys(&config, search.as_deref()).await
}

#[tauri::command]
pub async fn memcached_get_item(
    state: tauri::State<'_, AppState>,
    connection_id: Uuid,
    key: String,
) -> Result<MemcachedEntry, AppError> {
    let config = state.get_config(&connection_id).await?;
    if config.db_type != DatabaseType::Memcached {
        return Err(AppError::DriverNotSupported(
            "此操作仅支持 Memcached 连接".into(),
        ));
    }
    MemcachedDriver::get_item(&config, &key).await
}

#[tauri::command]
pub async fn memcached_delete_item(
    state: tauri::State<'_, AppState>,
    connection_id: Uuid,
    key: String,
) -> Result<(), AppError> {
    let config = state.get_config(&connection_id).await?;
    if config.db_type != DatabaseType::Memcached {
        return Err(AppError::DriverNotSupported(
            "此操作仅支持 Memcached 连接".into(),
        ));
    }
    MemcachedDriver::delete_item(&config, &key).await
}

#[tauri::command]
pub async fn memcached_flush_all(
    state: tauri::State<'_, AppState>,
    connection_id: Uuid,
) -> Result<(), AppError> {
    let config = state.get_config(&connection_id).await?;
    if config.db_type != DatabaseType::Memcached {
        return Err(AppError::DriverNotSupported(
            "此操作仅支持 Memcached 连接".into(),
        ));
    }
    MemcachedDriver::flush_all(&config).await
}

#[tauri::command]
pub async fn memcached_get_stats(
    state: tauri::State<'_, AppState>,
    connection_id: Uuid,
) -> Result<MemcachedServerInfo, AppError> {
    let config = state.get_config(&connection_id).await?;
    if config.db_type != DatabaseType::Memcached {
        return Err(AppError::DriverNotSupported(
            "此操作仅支持 Memcached 连接".into(),
        ));
    }
    MemcachedDriver::get_stats(&config).await
}

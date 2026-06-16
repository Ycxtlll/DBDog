use crate::connection::model::{ConnectionConfig, DatabaseType, ServerInfo};
use crate::drivers::memcached::MemcachedDriver;
use crate::drivers::mysql::metadata::MySqlDriver;
use crate::drivers::{DatabaseDriver, DatabaseMetadata};
use crate::error::AppError;
use crate::state::AppState;
use uuid::Uuid;

#[tauri::command]
pub async fn list_connections(
    state: tauri::State<'_, AppState>,
) -> Result<Vec<ConnectionConfig>, AppError> {
    state.storage.load_all().await
}

#[tauri::command]
pub async fn save_connection(
    state: tauri::State<'_, AppState>,
    config: ConnectionConfig,
) -> Result<ConnectionConfig, AppError> {
    state.storage.save(&config).await?;
    Ok(config)
}

#[tauri::command]
pub async fn delete_connection(
    state: tauri::State<'_, AppState>,
    id: Uuid,
) -> Result<(), AppError> {
    state.pool_manager.disconnect(&id).await;
    state.schema_cache.invalidate_connection(&id);
    state.storage.delete(id).await
}

#[tauri::command]
pub async fn test_connection(
    _state: tauri::State<'_, AppState>,
    config: ConnectionConfig,
) -> Result<String, AppError> {
    match config.db_type {
        DatabaseType::Mysql => {
            let driver = MySqlDriver::new();
            driver.test(&config).await
        }
        DatabaseType::Memcached => MemcachedDriver::test(&config).await,
    }
}
#[tauri::command]
pub async fn connect(
    state: tauri::State<'_, AppState>,
    id: Uuid,
    password: Option<String>,
) -> Result<ServerInfo, AppError> {
    let configs = state.storage.load_all().await?;
    let config = configs
        .into_iter()
        .find(|c| c.id == id)
        .ok_or_else(|| AppError::ConnectionNotFound(id.to_string()))?;

    match config.db_type {
        DatabaseType::Memcached => {
            let version = MemcachedDriver::test(&config).await?;
            Ok(ServerInfo {
                version,
                connection_id: format!("{}:{}", config.host, config.port),
            })
        }
        DatabaseType::Mysql => connect_mysql(state, id, password, config).await,
    }
}

async fn connect_mysql(
    state: tauri::State<'_, AppState>,
    id: Uuid,
    password: Option<String>,
    mut config: ConnectionConfig,
) -> Result<ServerInfo, AppError> {
    if state.pool_manager.is_connected(&id) {
        let pool = state
            .pool_manager
            .get(&id)
            .ok_or_else(|| AppError::ConnectionNotFound(id.to_string()))?;
        let row: (String, u64) = sqlx::query_as("SELECT VERSION(), CONNECTION_ID()")
            .fetch_one(&pool)
            .await
            .map_err(|e| AppError::QueryFailed(e.to_string()))?;
        return Ok(ServerInfo {
            version: row.0,
            connection_id: row.1.to_string(),
        });
    }

    if config.password.as_deref().is_some_and(|s| s.is_empty()) {
        config.password = None;
    }

    if config.password.is_none() {
        if let Some(pwd) = password {
            if !pwd.is_empty() {
                config.password = Some(pwd);
            }
        }
    }

    if config.password.is_none() {
        return Err(AppError::ConnectionFailed(
            "Password not found. Please edit the connection and re-enter the password."
                .to_string(),
        ));
    }

    let driver = MySqlDriver::new();
    let pool = driver.connect(&config).await?;

    let row: (String, u64) = sqlx::query_as("SELECT VERSION(), CONNECTION_ID()")
        .fetch_one(&pool)
        .await
        .map_err(|e| AppError::QueryFailed(e.to_string()))?;

    state.pool_manager.connect(id, pool.clone()).await;

    let server_info = ServerInfo {
        version: row.0,
        connection_id: row.1.to_string(),
    };

    // Warm up schema cache asynchronously
    let cache = state.schema_cache.clone();
    let pool_clone = pool.clone();
    tokio::spawn(async move {
        let meta = MySqlDriver::new();
        if let Ok(dbs) = meta.fetch_databases(&pool_clone).await {
            cache.set_databases(id, &dbs);
        }
    });

    Ok(server_info)
}

#[tauri::command]
pub async fn disconnect(state: tauri::State<'_, AppState>, id: Uuid) -> Result<(), AppError> {
    state.pool_manager.disconnect(&id).await;
    state.schema_cache.invalidate_connection(&id);
    Ok(())
}

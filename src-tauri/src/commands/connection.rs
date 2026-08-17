use crate::connection::model::{ConnectionConfig, DatabaseType, ServerInfo};
use crate::drivers::memcached::MemcachedDriver;
use crate::drivers::zookeeper::ZkDriver;
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
    state.session_databases.remove(&id);
    state.storage.delete(id).await
}

#[tauri::command]
pub async fn test_connection(
    state: tauri::State<'_, AppState>,
    config: ConnectionConfig,
) -> Result<String, AppError> {
    // When editing a saved connection the form leaves the password blank
    // ("keep existing"); merge the stored credential so Test actually works.
    let config = if config.db_type == DatabaseType::Mysql && config.password.is_none() {
        match state.storage.load_all().await {
            Ok(configs) => configs
                .into_iter()
                .find(|c| c.id == config.id)
                .map(|stored| {
                    let mut merged = config.clone();
                    merged.password = stored.password;
                    merged
                })
                .unwrap_or(config),
            Err(_) => config,
        }
    } else {
        config
    };

    match config.db_type {
        DatabaseType::Mysql => {
            let driver = MySqlDriver::new();
            driver.test(&config).await
        }
        DatabaseType::Memcached => MemcachedDriver::test(&config).await,
        DatabaseType::Zookeeper => ZkDriver::test(&config).await,
    }
}
#[tauri::command]
pub async fn connect(
    state: tauri::State<'_, AppState>,
    id: Uuid,
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
        DatabaseType::Zookeeper => {
            let version = ZkDriver::test(&config).await?;
            Ok(ServerInfo {
                version,
                connection_id: format!("{}:{}", config.host, config.port),
            })
        }
        DatabaseType::Mysql => connect_mysql(state, id, config).await,
    }
}


async fn connect_mysql(
    state: tauri::State<'_, AppState>,
    id: Uuid,
    mut config: ConnectionConfig,
) -> Result<ServerInfo, AppError> {
    if state.pool_manager.is_connected(&id) {
        if let Some(pool) = state.pool_manager.get(&id) {
            if let Ok(row) = sqlx::query_as::<_, (String, u64)>(
                "SELECT VERSION(), CONNECTION_ID()",
            )
            .fetch_one(&pool)
            .await
            {
                return Ok(ServerInfo {
                    version: row.0,
                    connection_id: row.1.to_string(),
                });
            }
        }
        // Probe on the existing pool failed — drop the stale pool and
        // reconnect instead of erroring out until an explicit disconnect.
        state.pool_manager.disconnect(&id).await;
    }

    if config.password.as_deref().is_some_and(|s| s.is_empty()) {
        config.password = None;
    }

    if config.password.is_none() {
        return Err(AppError::PasswordRequired);
    }
    let driver = MySqlDriver::new();
    let pool = driver.connect(&config).await?;

    let row: (String, u64) = sqlx::query_as("SELECT VERSION(), CONNECTION_ID()")
        .fetch_one(&pool)
        .await
        .map_err(|e| AppError::QueryFailed(e.to_string()))?;

    state.pool_manager.connect(id, pool.clone()).await;

    // Remember the configured default database so queries that don't pin a
    // database explicitly can be reset to it (a pooled connection keeps
    // whatever `USE` ran last on it).
    if let Some(ref db) = config.database {
        state.session_databases.insert(id, db.clone());
    }

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
    state.session_databases.remove(&id);
    Ok(())
}

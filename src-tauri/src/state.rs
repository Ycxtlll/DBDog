use std::sync::Arc;

use crate::cache::SchemaCache;
use crate::config::connections::ConnectionManager;
use crate::config::app_config::AppConfig;
use crate::db::mysql::MysqlDriver;
use crate::db::pool::PoolManager;

pub struct AppState {
    pub pool_manager: PoolManager,
    pub connection_manager: ConnectionManager,
    pub schema_cache: SchemaCache,
    pub app_config: Arc<tokio::sync::RwLock<AppConfig>>,
    pub driver: MysqlDriver,
}

impl AppState {
    pub fn new(connection_manager: ConnectionManager) -> Self {
        Self {
            pool_manager: PoolManager::new(),
            connection_manager,
            schema_cache: SchemaCache::new(),
            app_config: Arc::new(tokio::sync::RwLock::new(AppConfig::default())),
            driver: MysqlDriver,
        }
    }
}

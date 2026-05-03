use std::sync::Arc;

use crate::cache::DiskCache;
use crate::cache::SchemaCache;
use crate::config::connections::ConnectionManager;
use crate::config::app_config::AppConfig;
use crate::db::local::LocalDb;
use crate::db::mysql::MysqlDriver;
use crate::db::pool::PoolManager;

pub struct AppState {
    pub pool_manager: PoolManager,
    pub connection_manager: ConnectionManager,
    pub schema_cache: SchemaCache,
    pub disk_cache: DiskCache,
    #[allow(dead_code)]
    pub app_config: Arc<tokio::sync::RwLock<AppConfig>>,
    pub driver: MysqlDriver,
    pub local_db: Arc<LocalDb>,
}

impl AppState {
    pub fn new(connection_manager: ConnectionManager, cache_dir: std::path::PathBuf) -> Self {
        let local_db = LocalDb::new(cache_dir.join("dbdog.db")).expect("Failed to open local database");
        Self {
            pool_manager: PoolManager::new(),
            connection_manager,
            schema_cache: SchemaCache::new(),
            disk_cache: DiskCache::new(cache_dir.join("schema_cache.json")),
            app_config: Arc::new(tokio::sync::RwLock::new(AppConfig::default())),
            driver: MysqlDriver,
            local_db: Arc::new(local_db),
        }
    }
}

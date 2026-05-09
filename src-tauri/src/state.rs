use crate::connection::manager::PoolManager;
use crate::connection::storage::ConnectionStorage;
use crate::schema::cache::SchemaCache;
use std::sync::Arc;

pub struct AppState {
    pub pool_manager: PoolManager,
    pub storage: ConnectionStorage,
    pub schema_cache: Arc<SchemaCache>,
}

impl AppState {
    pub fn new(app_handle: tauri::AppHandle) -> Self {
        Self {
            pool_manager: PoolManager::new(),
            storage: ConnectionStorage::new(app_handle),
            schema_cache: Arc::new(SchemaCache::new()),
        }
    }
}

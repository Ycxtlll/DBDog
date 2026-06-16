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

    /// Look up a connection config by ID from storage.
    /// This is a convenience for commands that need the config directly (e.g. Memcached).
    pub async fn get_config(&self, id: &uuid::Uuid) -> Result<crate::connection::model::ConnectionConfig, crate::error::AppError> {
        let configs = self.storage.load_all().await?;
        configs
            .into_iter()
            .find(|c| &c.id == id)
            .ok_or_else(|| crate::error::AppError::ConnectionNotFound(id.to_string()))
    }
}

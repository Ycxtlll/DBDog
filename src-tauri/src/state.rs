use crate::connection::manager::PoolManager;
use crate::connection::storage::ConnectionStorage;
use crate::schema::cache::SchemaCache;
use dashmap::DashMap;
use std::sync::atomic::AtomicBool;
use std::sync::Arc;

pub struct AppState {
    pub pool_manager: PoolManager,
    pub storage: ConnectionStorage,
    pub schema_cache: Arc<SchemaCache>,
    /// Cancellation tokens for in-progress exports (export_id → cancel flag).
    pub export_cancels: Arc<DashMap<uuid::Uuid, Arc<AtomicBool>>>,
    /// Configured default database per MySQL connection. `USE` executed on a
    /// pooled connection sticks after release, so queries that don't pin a
    /// database explicitly are reset to this default before running.
    pub session_databases: Arc<DashMap<uuid::Uuid, String>>,
}

impl AppState {
    pub fn new(app_handle: tauri::AppHandle) -> Self {
        Self {
            pool_manager: PoolManager::new(),
            storage: ConnectionStorage::new(app_handle),
            schema_cache: Arc::new(SchemaCache::new()),
            export_cancels: Arc::new(DashMap::new()),
            session_databases: Arc::new(DashMap::new()),
        }
    }

    /// Look up a connection config by ID from storage.
    pub async fn get_config(&self, id: &uuid::Uuid) -> Result<crate::connection::model::ConnectionConfig, crate::error::AppError> {
        let configs = self.storage.load_all().await?;
        configs
            .into_iter()
            .find(|c| &c.id == id)
            .ok_or_else(|| crate::error::AppError::ConnectionNotFound(id.to_string()))
    }
}

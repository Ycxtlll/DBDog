use dashmap::DashMap;
use sqlx::MySqlPool;

use crate::db::types::ConnectionConfig;
use crate::db::mysql::MysqlDriver;
use crate::db::driver::DatabaseDriver;
use crate::error::Result;

pub struct PoolManager {
    pools: DashMap<String, MySqlPool>,
}

impl PoolManager {
    pub fn new() -> Self {
        Self {
            pools: DashMap::new(),
        }
    }

    pub async fn get_or_create(&self, driver: &MysqlDriver, config: &ConnectionConfig) -> Result<MySqlPool> {
        // Fast path: already exists
        if let Some(pool) = self.pools.get(&config.id) {
            return Ok(pool.clone());
        }
        // Slow path: create and insert atomically
        let pool = driver.create_pool(config).await?;
        // entry().or_insert() ensures only one pool is created per connection_id
        let existing = self.pools.entry(config.id.clone()).or_insert_with(|| pool.clone());
        Ok(existing.clone())
    }

    pub fn get(&self, connection_id: &str) -> Option<MySqlPool> {
        self.pools.get(connection_id).map(|p| p.clone())
    }

    pub async fn disconnect(&self, connection_id: &str) -> Result<()> {
        if let Some((_, pool)) = self.pools.remove(connection_id) {
            pool.close().await;
        }
        Ok(())
    }

    #[allow(dead_code)]
    pub fn is_connected(&self, connection_id: &str) -> bool {
        self.pools.contains_key(connection_id)
    }
}

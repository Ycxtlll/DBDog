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
        if let Some(pool) = self.pools.get(&config.id) {
            return Ok(pool.clone());
        }
        let pool = driver.create_pool(config).await?;
        self.pools.insert(config.id.clone(), pool.clone());
        Ok(pool)
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

    pub fn is_connected(&self, connection_id: &str) -> bool {
        self.pools.contains_key(connection_id)
    }
}

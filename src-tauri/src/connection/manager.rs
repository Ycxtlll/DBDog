use dashmap::DashMap;
use sqlx::mysql::MySqlPool;
use uuid::Uuid;

pub struct PoolManager {
    pools: DashMap<Uuid, MySqlPool>,
}

impl Default for PoolManager {
    fn default() -> Self {
        Self::new()
    }
}

impl PoolManager {
    pub fn new() -> Self {
        Self {
            pools: DashMap::new(),
        }
    }

    pub async fn connect(&self, id: Uuid, pool: MySqlPool) {
        // Replace any existing pool: keeping the old one via or_insert would
        // pin a dead pool forever (server restart, network drop) and the
        // freshly created pool's connections would never be used.
        if let Some(old) = self.pools.insert(id, pool) {
            old.close().await;
        }
    }

    pub fn get(&self, id: &Uuid) -> Option<MySqlPool> {
        self.pools.get(id).map(|e| e.clone())
    }

    pub async fn disconnect(&self, id: &Uuid) {
        if let Some((_, pool)) = self.pools.remove(id) {
            pool.close().await;
        }
    }

    pub fn is_connected(&self, id: &Uuid) -> bool {
        self.pools.contains_key(id)
    }
}

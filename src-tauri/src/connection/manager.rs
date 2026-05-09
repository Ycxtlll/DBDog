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
        self.pools.entry(id).or_insert(pool);
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

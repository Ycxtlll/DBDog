use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use std::time::{Duration, SystemTime};

use crate::db::types::*;
use crate::error::{AppError, Result};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CachedEntry<T> {
    pub data: T,
    pub cached_at: SystemTime,
    pub ttl_seconds: u64,
}

impl<T> CachedEntry<T> {
    fn new(data: T, ttl_seconds: u64) -> Self {
        Self {
            data,
            cached_at: SystemTime::now(),
            ttl_seconds,
        }
    }

    fn is_valid(&self) -> bool {
        match SystemTime::now().duration_since(self.cached_at) {
            Ok(elapsed) => elapsed.as_secs() < self.ttl_seconds,
            Err(_) => false,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConnectionCache {
    pub databases: Option<CachedEntry<Vec<String>>>,
    pub tables: HashMap<String, CachedEntry<Vec<TableInfo>>>, // database -> tables
    pub columns: HashMap<String, CachedEntry<Vec<ColumnInfo>>>, // "database.table" -> columns
}

impl Default for ConnectionCache {
    fn default() -> Self {
        Self {
            databases: None,
            tables: HashMap::new(),
            columns: HashMap::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiskCacheData {
    pub connections: HashMap<String, ConnectionCache>,
    pub created_at: SystemTime,
    pub updated_at: SystemTime,
}

impl Default for DiskCacheData {
    fn default() -> Self {
        Self {
            connections: HashMap::new(),
            created_at: SystemTime::now(),
            updated_at: SystemTime::now(),
        }
    }
}

pub struct DiskCache {
    cache_path: PathBuf,
    data: std::sync::RwLock<DiskCacheData>,
    default_ttl: u64,
}

impl DiskCache {
    pub fn new(cache_path: PathBuf) -> Self {
        let data = Self::load(&cache_path).unwrap_or_default();
        Self {
            cache_path,
            data: std::sync::RwLock::new(data),
            default_ttl: 3600, // 1 hour
        }
    }

    fn load(cache_path: &PathBuf) -> Option<DiskCacheData> {
        if !cache_path.exists() {
            return None;
        }
        match std::fs::read_to_string(cache_path) {
            Ok(content) => serde_json::from_str(&content).ok(),
            Err(_) => None,
        }
    }

    pub fn save(&self) -> Result<()> {
        let data = self.data.read().unwrap();
        let content = serde_json::to_string_pretty(&*data)?;
        if let Some(parent) = self.cache_path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        std::fs::write(&self.cache_path, content)?;
        Ok(())
    }

    pub fn get_databases(&self, connection_id: &str) -> Option<Vec<String>> {
        let data = self.data.read().unwrap();
        let conn_cache = data.connections.get(connection_id)?;
        conn_cache
            .databases
            .as_ref()
            .filter(|e| e.is_valid())
            .map(|e| e.data.clone())
    }

    pub fn set_databases(&self, connection_id: &str, databases: Vec<String>) {
        let mut data = self.data.write().unwrap();
        let conn_cache = data
            .connections
            .entry(connection_id.to_string())
            .or_default();
        conn_cache.databases = Some(CachedEntry::new(databases, self.default_ttl));
        data.updated_at = SystemTime::now();
    }

    pub fn get_tables(&self, connection_id: &str, database: &str) -> Option<Vec<TableInfo>> {
        let data = self.data.read().unwrap();
        let conn_cache = data.connections.get(connection_id)?;
        conn_cache
            .tables
            .get(database)
            .filter(|e| e.is_valid())
            .map(|e| e.data.clone())
    }

    pub fn set_tables(&self, connection_id: &str, database: &str, tables: Vec<TableInfo>) {
        let mut data = self.data.write().unwrap();
        let conn_cache = data
            .connections
            .entry(connection_id.to_string())
            .or_default();
        conn_cache
            .tables
            .insert(database.to_string(), CachedEntry::new(tables, self.default_ttl));
        data.updated_at = SystemTime::now();
    }

    pub fn get_columns(&self, connection_id: &str, database: &str, table: &str) -> Option<Vec<ColumnInfo>> {
        let key = format!("{}.{}", database, table);
        let data = self.data.read().unwrap();
        let conn_cache = data.connections.get(connection_id)?;
        conn_cache
            .columns
            .get(&key)
            .filter(|e| e.is_valid())
            .map(|e| e.data.clone())
    }

    pub fn set_columns(&self, connection_id: &str, database: &str, table: &str, columns: Vec<ColumnInfo>) {
        let key = format!("{}.{}", database, table);
        let mut data = self.data.write().unwrap();
        let conn_cache = data
            .connections
            .entry(connection_id.to_string())
            .or_default();
        conn_cache
            .columns
            .insert(key, CachedEntry::new(columns, self.default_ttl));
        data.updated_at = SystemTime::now();
    }

    pub fn invalidate_connection(&self, connection_id: &str) {
        let mut data = self.data.write().unwrap();
        data.connections.remove(connection_id);
        data.updated_at = SystemTime::now();
    }

    pub fn invalidate_database(&self, connection_id: &str, database: &str) {
        let mut data = self.data.write().unwrap();
        if let Some(conn_cache) = data.connections.get_mut(connection_id) {
            conn_cache.tables.remove(database);
            conn_cache
                .columns
                .retain(|k, _| !k.starts_with(&format!("{}.", database)));
            data.updated_at = SystemTime::now();
        }
    }

    pub fn warm_up_l1(&self, connection_id: &str, l1_cache: &crate::cache::l1::SchemaCache) {
        let data = self.data.read().unwrap();
        if let Some(conn_cache) = data.connections.get(connection_id) {
            if let Some(ce) = &conn_cache.databases {
                if ce.is_valid() {
                    l1_cache.set_databases(connection_id, ce.data.clone());
                }
            }
        }
    }
}

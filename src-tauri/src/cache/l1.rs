use dashmap::DashMap;
use std::time::{Duration, Instant};

use crate::db::types::*;

struct CacheEntry<T> {
    data: T,
    expires_at: Instant,
}

impl<T> CacheEntry<T> {
    fn new(data: T, ttl: Duration) -> Self {
        Self {
            data,
            expires_at: Instant::now() + ttl,
        }
    }

    fn is_valid(&self) -> bool {
        Instant::now() < self.expires_at
    }
}

pub struct SchemaCache {
    databases: DashMap<String, CacheEntry<Vec<String>>>,
    tables: DashMap<String, CacheEntry<Vec<TableInfo>>>,
    columns: DashMap<String, CacheEntry<Vec<ColumnInfo>>>,
    table_details: DashMap<String, CacheEntry<TableDetail>>,
    default_ttl: Duration,
}

impl SchemaCache {
    pub fn new() -> Self {
        Self {
            databases: DashMap::new(),
            tables: DashMap::new(),
            columns: DashMap::new(),
            table_details: DashMap::new(),
            default_ttl: Duration::from_secs(300),
        }
    }

    pub fn get_databases(&self, connection_id: &str) -> Option<Vec<String>> {
        let key = format!("{}:databases", connection_id);
        self.databases.get(&key).and_then(|e| {
            if e.is_valid() {
                Some(e.data.clone())
            } else {
                None
            }
        })
    }

    pub fn set_databases(&self, connection_id: &str, databases: Vec<String>) {
        let key = format!("{}:databases", connection_id);
        self.databases
            .insert(key, CacheEntry::new(databases, self.default_ttl));
    }

    pub fn get_tables(&self, connection_id: &str, database: &str) -> Option<Vec<TableInfo>> {
        let key = format!("{}:tables:{}", connection_id, database);
        self.tables.get(&key).and_then(|e| {
            if e.is_valid() {
                Some(e.data.clone())
            } else {
                None
            }
        })
    }

    pub fn set_tables(&self, connection_id: &str, database: &str, tables: Vec<TableInfo>) {
        let key = format!("{}:tables:{}", connection_id, database);
        self.tables
            .insert(key, CacheEntry::new(tables, self.default_ttl));
    }

    pub fn get_columns(&self, connection_id: &str, database: &str, table: &str) -> Option<Vec<ColumnInfo>> {
        let key = format!("{}:columns:{}:{}", connection_id, database, table);
        self.columns.get(&key).and_then(|e| {
            if e.is_valid() {
                Some(e.data.clone())
            } else {
                None
            }
        })
    }

    pub fn set_columns(&self, connection_id: &str, database: &str, table: &str, columns: Vec<ColumnInfo>) {
        let key = format!("{}:columns:{}:{}", connection_id, database, table);
        self.columns
            .insert(key, CacheEntry::new(columns, self.default_ttl));
    }

    pub fn invalidate_connection(&self, connection_id: &str) {
        let prefix = format!("{}:", connection_id);
        self.databases.retain(|k, _| !k.starts_with(&prefix));
        self.tables.retain(|k, _| !k.starts_with(&prefix));
        self.columns.retain(|k, _| !k.starts_with(&prefix));
        self.table_details.retain(|k, _| !k.starts_with(&prefix));
    }

    pub fn invalidate_database(&self, connection_id: &str, database: &str) {
        let table_prefix = format!("{}:tables:{}", connection_id, database);
        let column_prefix = format!("{}:columns:{}", connection_id, database);
        let detail_prefix = format!("{}:detail:{}", connection_id, database);
        self.tables.retain(|k, _| !k.starts_with(&table_prefix));
        self.columns.retain(|k, _| !k.starts_with(&column_prefix));
        self.table_details.retain(|k, _| !k.starts_with(&detail_prefix));
    }
}

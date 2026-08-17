use super::model::*;
use dashmap::DashMap;
use serde_json::Value;
use std::path::PathBuf;
use uuid::Uuid;

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
struct CacheKey {
    conn_id: Uuid,
    db: String,
    obj_type: ObjectType,
    obj_name: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
#[allow(dead_code)]
enum ObjectType {
    Database,
    Table,
    Column,
    Index,
    ForeignKey,
    Trigger,
    CreateTableSql,
    TableDetails,
}

#[derive(Debug, Clone)]
struct CachedValue {
    data: Value,
    cached_at: chrono::DateTime<chrono::Utc>,
}

impl CachedValue {
    fn is_expired_l1(&self) -> bool {
        self.cached_at < chrono::Utc::now() - chrono::Duration::minutes(5)
    }
}

pub struct SchemaCache {
    l1: DashMap<CacheKey, CachedValue>,
    #[allow(dead_code)]
    base_path: PathBuf,
}

impl Default for SchemaCache {
    fn default() -> Self {
        Self::new()
    }
}

impl SchemaCache {
    pub fn new() -> Self {
        Self {
            l1: DashMap::new(),
            base_path: std::env::temp_dir().join("dbdog_schema_cache"),
        }
    }

    fn key(conn_id: Uuid, db: &str, obj_type: ObjectType, obj_name: &str) -> CacheKey {
        CacheKey {
            conn_id,
            db: db.to_string(),
            obj_type,
            obj_name: obj_name.to_string(),
        }
    }

    /// Fetch a cached value, evicting it if expired. Expired entries were
    /// previously left in the map forever (slow memory leak across many
    /// databases/tables until the connection was invalidated).
    fn get_cached(&self, key: &CacheKey) -> Option<Value> {
        if let Some(v) = self.l1.get(key) {
            if v.is_expired_l1() {
                drop(v);
                self.l1.remove(key);
                return None;
            }
            return Some(v.data.clone());
        }
        None
    }

    pub fn get_databases(&self, conn_id: Uuid) -> Option<Vec<Database>> {
        let key = Self::key(conn_id, "_global", ObjectType::Database, "_all");
        self.get_cached(&key)
            .and_then(|d| serde_json::from_value(d).ok())
    }

    pub fn set_databases(&self, conn_id: Uuid, databases: &[Database]) {
        let key = Self::key(conn_id, "_global", ObjectType::Database, "_all");
        if let Ok(val) = serde_json::to_value(databases) {
            self.l1.insert(
                key,
                CachedValue {
                    data: val,
                    cached_at: chrono::Utc::now(),
                },
            );
        }
    }

    pub fn get_tables(&self, conn_id: Uuid, db: &str) -> Option<Vec<Table>> {
        let key = Self::key(conn_id, db, ObjectType::Table, "_all");
        self.get_cached(&key)
            .and_then(|d| serde_json::from_value(d).ok())
    }

    pub fn set_tables(&self, conn_id: Uuid, db: &str, tables: &[Table]) {
        let key = Self::key(conn_id, db, ObjectType::Table, "_all");
        if let Ok(val) = serde_json::to_value(tables) {
            self.l1.insert(
                key,
                CachedValue {
                    data: val,
                    cached_at: chrono::Utc::now(),
                },
            );
        }
    }

    pub fn get_table_details(&self, conn_id: Uuid, db: &str, table: &str) -> Option<TableDetails> {
        let key = Self::key(conn_id, db, ObjectType::TableDetails, table);
        self.get_cached(&key)
            .and_then(|d| serde_json::from_value(d).ok())
    }

    pub fn set_table_details(&self, conn_id: Uuid, db: &str, table: &str, details: &TableDetails) {
        let key = Self::key(conn_id, db, ObjectType::TableDetails, table);
        if let Ok(val) = serde_json::to_value(details) {
            self.l1.insert(
                key,
                CachedValue {
                    data: val,
                    cached_at: chrono::Utc::now(),
                },
            );
        }
    }

    pub fn invalidate_connection(&self, conn_id: &Uuid) {
        self.l1.retain(|key, _| key.conn_id != *conn_id);
    }

    pub fn invalidate_database(&self, conn_id: &Uuid, db: &str) {
        self.l1
            .retain(|key, _| !(key.conn_id == *conn_id && key.db == db));
    }

    pub fn invalidate_on_ddl(&self, conn_id: &Uuid, sql: &str) {
        let is_ddl = first_sql_token(sql).map_or(false, |token| {
            matches!(
                token.as_str(),
                "CREATE" | "ALTER" | "DROP" | "RENAME" | "TRUNCATE"
            )
        });
        if is_ddl {
            self.invalidate_connection(conn_id);
        }
    }
}

/// Extracts the first SQL token (keyword/identifier) from a statement,
/// skipping leading whitespace and `--`, `#` and `/* */` comments.
/// This is a lightweight lexical scan, not a full parser.
fn first_sql_token(sql: &str) -> Option<String> {
    let mut s = sql;
    loop {
        s = s.trim_start();
        if s.starts_with("--") || s.starts_with('#') {
            if let Some(idx) = s.find('\n') {
                s = &s[idx + 1..];
                continue;
            }
            return None;
        }
        if s.starts_with("/*") {
            if let Some(idx) = s.find("*/") {
                s = &s[idx + 2..];
                continue;
            }
            return None;
        }
        let end = s
            .find(|c: char| !c.is_alphanumeric() && c != '_')
            .unwrap_or(s.len());
        if end == 0 {
            return None;
        }
        return Some(s[..end].to_ascii_uppercase());
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn first_token_skips_all_comment_styles() {
        assert_eq!(first_sql_token("SELECT 1").as_deref(), Some("SELECT"));
        assert_eq!(first_sql_token("-- lead comment\nDROP TABLE t").as_deref(), Some("DROP"));
        assert_eq!(first_sql_token("# hash comment\nALTER TABLE t ADD c INT").as_deref(), Some("ALTER"));
        assert_eq!(first_sql_token("/* block */ create table t (id INT)").as_deref(), Some("CREATE"));
        assert_eq!(first_sql_token("-- only a comment").is_none(), true);
        assert_eq!(first_sql_token("   ").is_none(), true);
    }
}

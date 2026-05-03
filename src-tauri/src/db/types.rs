use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConnectionConfig {
    pub id: String,
    pub name: String,
    pub db_type: String, // "mysql", "mariadb"
    pub host: String,
    pub port: u16,
    pub user: String,
    #[serde(skip_serializing)]
    pub password: String,
    pub database: Option<String>,
    pub max_connections: Option<u32>,
    pub ssl_mode: Option<String>,
    pub ssl_cert: Option<String>,
}

impl ConnectionConfig {
    #[allow(dead_code)]
    pub fn new(name: &str, db_type: &str, host: &str, port: u16, user: &str) -> Self {
        Self {
            id: uuid::Uuid::new_v4().to_string(),
            name: name.to_string(),
            db_type: db_type.to_string(),
            host: host.to_string(),
            port,
            user: user.to_string(),
            password: String::new(),
            database: None,
            max_connections: Some(5),
            ssl_mode: None,
            ssl_cert: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConnectionSummary {
    pub id: String,
    pub name: String,
    pub db_type: String,
    pub host: String,
    pub port: u16,
    pub user: String,
    pub database: Option<String>,
}

impl From<&ConnectionConfig> for ConnectionSummary {
    fn from(c: &ConnectionConfig) -> Self {
        Self {
            id: c.id.clone(),
            name: c.name.clone(),
            db_type: c.db_type.clone(),
            host: c.host.clone(),
            port: c.port,
            user: c.user.clone(),
            database: c.database.clone(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConnectionInfo {
    pub id: String,
    pub name: String,
    pub server_version: String,
    pub db_type: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QueryResult {
    pub columns: Vec<ColumnInfo>,
    pub rows: Vec<serde_json::Map<String, serde_json::Value>>,
    pub row_count: usize,
    pub truncated: bool,
    pub execution_time_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ColumnInfo {
    pub name: String,
    pub ordinal: usize,
    pub type_name: String,
    pub nullable: bool,
    pub is_primary_key: bool,
    pub auto_increment: bool,
    pub default_value: Option<String>,
    pub comment: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TableInfo {
    pub name: String,
    pub schema: String,
    pub table_type: String,
    pub row_count: Option<u64>,
    pub comment: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TableDetail {
    pub table: TableInfo,
    pub columns: Vec<ColumnInfo>,
    pub indexes: Vec<IndexInfo>,
    pub foreign_keys: Vec<ForeignKeyInfo>,
    pub create_sql: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ForeignKeyInfo {
    pub name: String,
    pub column_name: String,
    pub referenced_table: String,
    pub referenced_column: String,
    pub on_delete: String,
    pub on_update: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IndexInfo {
    pub name: String,
    pub columns: Vec<String>,
    pub is_unique: bool,
    pub is_primary: bool,
    pub index_type: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TriggerInfo {
    pub name: String,
    pub event: String,
    pub timing: String,
    pub statement: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateResult {
    pub rows_affected: u64,
    pub last_insert_id: Option<u64>,
    pub execution_time_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProcessInfo {
    pub id: u64,
    pub user: String,
    pub host: String,
    pub db: Option<String>,
    pub command: String,
    pub time: u64,
    pub state: Option<String>,
    pub info: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StatusVariable {
    pub name: String,
    pub value: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SystemVariable {
    pub name: String,
    pub value: String,
    pub is_global: bool,
    pub is_session: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InnodbStatus {
    pub raw_text: String,
    pub active_transactions: Option<u64>,
    pub lock_waits: Option<u64>,
    pub buffer_pool_hits: Option<u64>,
    pub buffer_pool_reads: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SchemaSearchHit {
    pub database: String,
    pub object_type: String, // "table", "column", "view"
    pub object_name: String,
    pub parent: Option<String>, // parent table name for columns
    pub match_field: String,    // which field matched
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DatabaseSnapshot {
    pub id: String,
    pub connection_id: String,
    pub database_name: String,
    pub captured_at: String,
    pub tables: Vec<TableDetail>,
    pub views: Vec<TableInfo>,
    pub triggers: Vec<TriggerInfo>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum SchemaChange {
    TableAdded { table: TableDetail },
    TableDropped { table: TableInfo },
    TableModified {
        table_name: String,
        columns_added: Vec<ColumnInfo>,
        columns_dropped: Vec<ColumnInfo>,
        columns_modified: Vec<ColumnInfo>,
        indexes_added: Vec<IndexInfo>,
        indexes_dropped: Vec<IndexInfo>,
        foreign_keys_added: Vec<ForeignKeyInfo>,
        foreign_keys_dropped: Vec<ForeignKeyInfo>,
    },
    ViewAdded { view: TableInfo },
    ViewDropped { view: TableInfo },
    TriggerAdded { trigger: TriggerInfo },
    TriggerDropped { trigger: TriggerInfo },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SchemaDiff {
    pub from_snapshot_id: String,
    pub to_snapshot_id: String,
    pub changes: Vec<SchemaChange>,
}

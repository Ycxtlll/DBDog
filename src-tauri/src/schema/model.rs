use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

/// Schema snapshot for the SQL editor's completion: database → table →
/// column names. BTreeMap keeps the ordering deterministic across fetches.
pub type CompletionSchema = BTreeMap<String, BTreeMap<String, Vec<String>>>;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Database {
    pub name: String,
    pub charset: Option<String>,
    pub collation: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Table {
    pub name: String,
    pub engine: Option<String>,
    pub rows: Option<u64>,
    pub size_mb: Option<f64>,
    pub comment: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Column {
    pub name: String,
    pub ordinal_position: u32,
    pub data_type: String,
    pub nullable: bool,
    pub is_primary_key: bool,
    pub is_auto_increment: bool,
    pub default_value: Option<String>,
    pub comment: Option<String>,
    pub max_length: Option<u32>,
    /// Raw `Extra` from SHOW FULL COLUMNS ("auto_increment", "DEFAULT_GENERATED",
    /// "on update current_timestamp()", ...). Needed so visual table editing can
    /// round-trip ON UPDATE / expression defaults without silently dropping them.
    /// `default` keeps older L2 disk-cache JSON (without this field) loadable.
    #[serde(default)]
    pub extra: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Index {
    pub name: String,
    pub columns: Vec<String>,
    pub is_unique: bool,
    pub is_primary: bool,
    pub index_type: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ForeignKey {
    pub name: String,
    pub column: String,
    pub referenced_table: Option<String>,
    pub referenced_column: Option<String>,
    pub update_rule: Option<String>,
    pub delete_rule: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Trigger {
    pub name: String,
    pub event: String,
    pub timing: String,
    pub statement: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TableDetails {
    pub columns: Vec<Column>,
    pub indexes: Vec<Index>,
    pub foreign_keys: Vec<ForeignKey>,
    pub triggers: Vec<Trigger>,
    pub create_table_sql: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchResult {
    pub database: String,
    pub object_type: String,
    pub object_name: String,
    pub column_name: Option<String>,
}

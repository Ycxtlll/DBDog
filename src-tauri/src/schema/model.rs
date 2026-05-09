use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Database {
    pub name: String,
    pub charset: Option<String>,
    pub collation: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Table {
    pub name: String,
    pub engine: Option<String>,
    pub rows: Option<u64>,
    pub size_mb: Option<f64>,
    pub comment: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
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
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Index {
    pub name: String,
    pub columns: Vec<String>,
    pub is_unique: bool,
    pub is_primary: bool,
    pub index_type: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ForeignKey {
    pub name: String,
    pub column: String,
    pub referenced_table: String,
    pub referenced_column: String,
    pub update_rule: String,
    pub delete_rule: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Trigger {
    pub name: String,
    pub event: String,
    pub timing: String,
    pub statement: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TableDetails {
    pub columns: Vec<Column>,
    pub indexes: Vec<Index>,
    pub foreign_keys: Vec<ForeignKey>,
    pub triggers: Vec<Trigger>,
    pub create_table_sql: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchResult {
    pub database: String,
    pub object_type: String,
    pub object_name: String,
    pub column_name: Option<String>,
}

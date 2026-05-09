use serde::Serialize;
use serde_json::Value;

#[derive(Debug, Serialize)]
pub struct QueryResult {
    pub columns: Vec<ColumnMeta>,
    pub rows: Vec<Vec<Value>>,
    pub total_count: u64,
    pub truncated: bool,
    pub elapsed_ms: u64,
}

#[derive(Debug, Serialize)]
pub struct UpdateResult {
    pub rows_affected: u64,
    pub last_insert_id: Option<u64>,
    pub elapsed_ms: u64,
}

#[derive(Debug, Serialize)]
pub struct ColumnMeta {
    pub name: String,
    pub data_type: String,
    pub nullable: bool,
}

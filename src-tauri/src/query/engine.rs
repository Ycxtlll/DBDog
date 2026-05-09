use super::result::{ColumnMeta, QueryResult, UpdateResult};
use crate::error::AppError;
use serde_json::Value;
use sqlx::mysql::MySqlPool;
use sqlx::Column;
use sqlx::Row;
use sqlx::TypeInfo;
use std::time::Instant;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[allow(dead_code)]
pub enum SqlType {
    Query,
    Update,
}

#[allow(dead_code)]
pub fn classify_sql(sql: &str) -> SqlType {
    let first_word = sql
        .trim()
        .split_whitespace()
        .next()
        .map(|s| s.to_uppercase())
        .unwrap_or_default();

    match first_word.as_str() {
        "SELECT" | "SHOW" | "DESCRIBE" | "DESC" | "EXPLAIN" => SqlType::Query,
        _ => SqlType::Update,
    }
}

pub async fn execute_query(
    pool: &MySqlPool,
    sql: &str,
    limit: u32,
) -> Result<QueryResult, AppError> {
    let start = Instant::now();

    let rows = sqlx::query(sql).fetch_all(pool).await?;
    let total_count = rows.len() as u64;
    let truncated = total_count > limit as u64;

    let columns = if let Some(first_row) = rows.first() {
        first_row
            .columns()
            .iter()
            .map(|col| ColumnMeta {
                name: col.name().to_string(),
                data_type: col.type_info().name().to_string(),
                nullable: true,
            })
            .collect()
    } else {
        vec![]
    };

    let mut result_rows = Vec::new();
    for row in rows.into_iter().take(limit as usize) {
        let mut values = Vec::new();
        for (i, _) in row.columns().iter().enumerate() {
            let val: Value = if let Ok(v) = row.try_get::<i64, _>(i) {
                Value::Number(v.into())
            } else if let Ok(v) = row.try_get::<f64, _>(i) {
                serde_json::Number::from_f64(v)
                    .map(Value::Number)
                    .unwrap_or(Value::Null)
            } else if let Ok(v) = row.try_get::<String, _>(i) {
                Value::String(v)
            } else if let Ok(v) = row.try_get::<bool, _>(i) {
                Value::Bool(v)
            } else if let Ok(v) = row.try_get::<Vec<u8>, _>(i) {
                Value::String(base64::Engine::encode(
                    &base64::engine::general_purpose::STANDARD,
                    v,
                ))
            } else {
                Value::Null
            };
            values.push(val);
        }
        result_rows.push(values);
    }

    let elapsed_ms = start.elapsed().as_millis() as u64;

    Ok(QueryResult {
        columns,
        rows: result_rows,
        total_count,
        truncated,
        elapsed_ms,
    })
}

pub async fn execute_update(pool: &MySqlPool, sql: &str) -> Result<UpdateResult, AppError> {
    let start = Instant::now();
    let result = sqlx::query(sql).execute(pool).await?;
    let elapsed_ms = start.elapsed().as_millis() as u64;

    Ok(UpdateResult {
        rows_affected: result.rows_affected(),
        last_insert_id: Some(result.last_insert_id()),
        elapsed_ms,
    })
}

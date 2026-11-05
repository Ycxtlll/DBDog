use super::result::{ColumnMeta, QueryResult, UpdateResult};
use crate::drivers::mysql::decode;
use crate::error::AppError;
use futures_util::stream::TryStreamExt;
use sqlx::mysql::{MySqlConnection, MySqlPool};
use sqlx::Column;
use sqlx::Row;
use sqlx::TypeInfo;
use std::time::Instant;

/// Stream a SELECT (or any result-returning statement) on the session
/// connection. Counts every row but keeps at most `limit` in memory,
/// reporting the rest via `total_count` + `truncated`.
pub async fn execute_query(
    conn: &mut MySqlConnection,
    sql: &str,
    limit: u32,
) -> Result<QueryResult, AppError> {
    let start = Instant::now();

    let mut stream = sqlx::query(sql).fetch(&mut *conn);
    let mut rows: Vec<sqlx::mysql::MySqlRow> = Vec::new();
    let mut total_count = 0u64;

    while let Some(row) = stream.try_next().await? {
        total_count += 1;
        if rows.len() < limit as usize {
            rows.push(row);
        }
    }

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
        for i in 0..row.columns().len() {
            values.push(decode::cell_to_json(&row, i));
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

/// Run one DML/DDL statement on the session connection (which carries the
/// tab's `USE db` state). MySQL answers ER_UNSUPPORTED_PS (1295) for CREATE
/// TRIGGER / PROCEDURE / FUNCTION / EVENT on every version, so those are
/// retried over the text protocol on a pooled connection — session state
/// does not carry over, so such statements should qualify names with their
/// schema.
pub async fn execute_update(
    pool: &MySqlPool,
    conn: &mut MySqlConnection,
    sql: &str,
) -> Result<UpdateResult, AppError> {
    let start = Instant::now();
    let result = match run_prepared(conn, sql).await {
        Ok(result) => result,
        Err(e) if is_unsupported_prepared_statement(&e) => run_text_protocol(pool, sql).await?,
        Err(e) => return Err(e.into()),
    };
    let elapsed_ms = start.elapsed().as_millis() as u64;

    Ok(UpdateResult {
        rows_affected: result.rows_affected(),
        last_insert_id: Some(result.last_insert_id()),
        elapsed_ms,
    })
}

fn is_unsupported_prepared_statement(e: &sqlx::Error) -> bool {
    e.as_database_error()
        .map(|d| {
            d.code().as_deref() == Some("1295")
                || d.message()
                    .to_lowercase()
                    .contains("prepared statement protocol")
        })
        .unwrap_or(false)
}

// Each executor call lives in its own function: awaiting two raw sqlx
// executor futures in one async fn body trips rustc's higher-ranked
// auto-trait analysis ("implementation of `Executor` is not general
// enough") under Tauri's boxed command futures.
async fn run_prepared(
    conn: &mut MySqlConnection,
    sql: &str,
) -> Result<sqlx::mysql::MySqlQueryResult, sqlx::Error> {
    sqlx::query(sql).execute(&mut *conn).await
}

async fn run_text_protocol(
    pool: &MySqlPool,
    sql: &str,
) -> Result<sqlx::mysql::MySqlQueryResult, AppError> {
    let result = sqlx::raw_sql(sql).execute(pool).await?;
    Ok(result)
}

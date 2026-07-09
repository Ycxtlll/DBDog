use crate::drivers::mysql::metadata::MySqlDriver;
use crate::drivers::DatabaseMetadata;
use crate::error::AppError;
use crate::state::AppState;
use futures_util::stream::TryStreamExt;
use serde::Serialize;
use sqlx::Column;
use sqlx::Row;
use sqlx::TypeInfo;
use sqlx::ValueRef;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Instant;
use tauri::Emitter;
use tokio::io::AsyncWriteExt;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportProgress {
    pub total_rows: u64,
    pub phase: String, // "running" | "done" | "cancelled" | "error"
    pub error: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportResult {
    pub total_rows: u64,
    pub elapsed_ms: u64,
    pub file_path: String,
}

/// Decode a MySQL cell to string for CSV output.
fn cell_to_string(row: &sqlx::mysql::MySqlRow, i: usize) -> String {
    if row.try_get_raw(i).map_or(true, |v| v.is_null()) {
        return String::new();
    }
    let type_name = row.column(i).type_info().name().to_uppercase();
    decode_cell_string(row, i, &type_name)
}

fn decode_cell_string(row: &sqlx::mysql::MySqlRow, i: usize, type_name: &str) -> String {
    macro_rules! try_get {
        ($t:ty) => {
            row.try_get_unchecked::<$t, _>(i)
                .map(|v| v.to_string())
                .unwrap_or_default()
        };
    }

    if type_name.starts_with("TINYINT") {
        if type_name.contains("UNSIGNED") { try_get!(u8) } else { try_get!(i8) }
    } else if type_name.starts_with("SMALLINT") {
        if type_name.contains("UNSIGNED") { try_get!(u16) } else { try_get!(i16) }
    } else if type_name.starts_with("MEDIUMINT") || type_name.starts_with("INT") || type_name.starts_with("INTEGER") {
        if type_name.contains("UNSIGNED") { try_get!(u32) } else { try_get!(i32) }
    } else if type_name.starts_with("BIGINT") {
        if type_name.contains("UNSIGNED") { try_get!(u64) } else { try_get!(i64) }
    } else if type_name.starts_with("FLOAT") {
        try_get!(f32)
    } else if type_name.starts_with("DOUBLE") || type_name.starts_with("REAL") {
        try_get!(f64)
    } else if type_name.starts_with("DECIMAL") || type_name.starts_with("NUMERIC") {
        row.try_get_unchecked::<bigdecimal::BigDecimal, _>(i)
            .map(|v| v.to_string()).unwrap_or_default()
    } else if type_name.starts_with("BIT") {
        row.try_get_unchecked::<Vec<u8>, _>(i)
            .map(|bytes| {
                if bytes.is_empty() { return String::new(); }
                let mut val: u64 = 0;
                for b in bytes { val = (val << 8) | u64::from(b); }
                val.to_string()
            }).unwrap_or_default()
    } else if type_name == "DATE" {
        row.try_get_unchecked::<chrono::NaiveDate, _>(i).map(|v| v.to_string()).unwrap_or_default()
    } else if type_name == "DATETIME" || type_name == "TIMESTAMP" {
        row.try_get_unchecked::<chrono::NaiveDateTime, _>(i).map(|v| v.to_string()).unwrap_or_default()
    } else if type_name == "TIME" {
        row.try_get_unchecked::<chrono::NaiveTime, _>(i).map(|v| v.to_string()).unwrap_or_default()
    } else if type_name == "YEAR" {
        try_get!(i16)
    } else {
        row.try_get_unchecked::<String, _>(i).unwrap_or_default()
    }
}

fn csv_escape(field: &str) -> String {
    if field.contains(',') || field.contains('"') || field.contains('\n') || field.contains('\r') {
        format!("\"{}\"", field.replace('"', "\"\""))
    } else {
        field.to_string()
    }
}

fn sql_quote(val: &str) -> String {
    if val.is_empty() {
        "NULL".to_string()
    } else {
        format!("'{}'", val.replace('\\', "\\\\").replace('\'', "\\'"))
    }
}

fn build_keyset_where(order_cols: &[String], last_vals: &[String]) -> String {
    if order_cols.len() == 1 {
        format!("`{}` > {}", order_cols[0], sql_quote(&last_vals[0]))
    } else {
        let cols: Vec<String> = order_cols.iter().map(|c| format!("`{}`", c)).collect();
        let vals: Vec<String> = last_vals.iter().map(|v| sql_quote(v)).collect();
        format!("({}) > ({})", cols.join(", "), vals.join(", "))
    }
}

fn download_dir() -> std::path::PathBuf {
    #[cfg(target_os = "windows")]
    {
        if let Ok(home) = std::env::var("USERPROFILE") {
            return std::path::PathBuf::from(home).join("Downloads");
        }
    }
    #[cfg(not(target_os = "windows"))]
    {
        if let Ok(home) = std::env::var("HOME") {
            return std::path::PathBuf::from(home).join("Downloads");
        }
    }
    std::env::temp_dir()
}

#[tauri::command]
pub async fn execute_export(
    app_handle: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    connection_id: Uuid,
    database: String,
    table: String,
    file_path: String,
    export_id: Uuid,
) -> Result<ExportResult, AppError> {
    // Resolve relative paths to the download directory
    let file_path = {
        let p = std::path::Path::new(&file_path);
        if p.is_absolute() {
            p.to_path_buf()
        } else {
            download_dir().join(p)
        }
    };

    let start = Instant::now();
    let cancel_flag = Arc::new(AtomicBool::new(false));
    state.export_cancels.insert(export_id, cancel_flag.clone());

    // Clean up cancel token on exit
    let cancels = state.export_cancels.clone();
    let eid = export_id;

    let emit_progress = |total_rows: u64, phase: &str, error: Option<String>| {
        let _ = app_handle.emit("export-progress", ExportProgress {
            total_rows,
            phase: phase.to_string(),
            error,
        });
    };

    let result: Result<ExportResult, AppError> = async {
        let pool = state
            .pool_manager
            .get(&connection_id)
            .ok_or_else(|| AppError::ConnectionNotFound(connection_id.to_string()))?;

        // Get table metadata
        let driver = MySqlDriver::new();
        let details = driver
            .fetch_table_details(&pool, &database, &table)
            .await?;

        let all_columns = &details.columns;

        let order_col_names: Vec<String> = {
            let pks: Vec<_> = all_columns.iter().filter(|c| c.is_primary_key).map(|c| c.name.clone()).collect();
            if pks.is_empty() { all_columns.iter().map(|c| c.name.clone()).collect() } else { pks }
        };

        let order_indices: Vec<usize> = order_col_names.iter()
            .map(|name| all_columns.iter().position(|c| &c.name == name).unwrap_or(0))
            .collect();

        let order_clause = order_col_names.iter().map(|c| format!("`{}`", c)).collect::<Vec<_>>().join(", ");

        let batch_size: u32 = 5000;

        let mut file = tokio::fs::File::create(&file_path)
            .await
            .map_err(|e| AppError::QueryFailed(format!("无法创建文件: {}", e)))?;

        let header: Vec<String> = all_columns.iter().map(|c| csv_escape(&c.name)).collect();
        file.write_all(header.join(",").as_bytes()).await.unwrap();
        file.write_all(b"\n").await.unwrap();

        let mut conn = pool.acquire().await.map_err(|e| AppError::QueryFailed(e.to_string()))?;
        let mut total_rows: u64 = 0;
        let mut last_pk_values: Option<Vec<String>> = None;

        loop {
            // Check cancellation
            if cancel_flag.load(Ordering::Relaxed) {
                emit_progress(total_rows, "cancelled", None);
                return Err(AppError::QueryFailed("导出已取消".to_string()));
            }

            let sql = if let Some(ref last_vals) = last_pk_values {
                let where_clause = build_keyset_where(&order_col_names, last_vals);
                format!(
                    "SELECT * FROM `{}`.`{}` WHERE {} ORDER BY {} LIMIT {}",
                    database, table, where_clause, order_clause, batch_size
                )
            } else {
                format!(
                    "SELECT * FROM `{}`.`{}` ORDER BY {} LIMIT {}",
                    database, table, order_clause, batch_size
                )
            };

            let mut stream = sqlx::query(&sql).fetch(&mut *conn);
            let mut batch_rows: u64 = 0;
            let mut batch_csv = String::new();

            while let Some(row) = stream.try_next().await.map_err(|e| AppError::QueryFailed(e.to_string()))? {
                let col_count = row.columns().len();
                let mut fields = Vec::with_capacity(col_count);
                for i in 0..col_count {
                    fields.push(csv_escape(&cell_to_string(&row, i)));
                }
                batch_csv.push_str(&fields.join(","));
                batch_csv.push('\n');
                batch_rows += 1;

                last_pk_values = Some(
                    order_indices.iter().map(|&idx| cell_to_string(&row, idx)).collect(),
                );
            }

            if batch_rows == 0 { break; }

            file.write_all(batch_csv.as_bytes()).await.unwrap();
            total_rows += batch_rows;
            emit_progress(total_rows, "running", None);

            if batch_rows < batch_size as u64 { break; }
        }

        file.flush().await.unwrap();
        Ok(ExportResult { total_rows, elapsed_ms: start.elapsed().as_millis() as u64, file_path: file_path.to_string_lossy().to_string() })
    }.await;

    cancels.remove(&eid);

    match &result {
        Ok(r) => emit_progress(r.total_rows, "done", None),
        Err(e) => emit_progress(0, "error", Some(e.to_string())),
    }

    result
}

#[tauri::command]
pub async fn cancel_export(
    state: tauri::State<'_, AppState>,
    export_id: Uuid,
) -> Result<(), AppError> {
    if let Some(flag) = state.export_cancels.get(&export_id) {
        flag.store(true, Ordering::Relaxed);
    }
    Ok(())
}

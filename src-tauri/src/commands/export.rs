use crate::connection::model::DatabaseType;
use crate::drivers::mysql::metadata::MySqlDriver;
use crate::drivers::DatabaseMetadata;
use crate::error::AppError;
use crate::state::AppState;
use crate::utils::escape_mysql_identifier;
use futures_util::stream::TryStreamExt;
use serde::Serialize;
use sqlx::Row;
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

fn csv_escape(field: &str) -> String {
    if field.contains(',') || field.contains('"') || field.contains('\n') || field.contains('\r') {
        format!("\"{}\"", field.replace('"', "\"\""))
    } else {
        field.to_string()
    }
}

fn write_err(e: std::io::Error) -> AppError {
    AppError::QueryFailed(format!("写入文件失败: {e}"))
}

fn sql_quote(val: &str) -> String {
    format!("'{}'", val.replace('\\', "\\\\").replace('\'', "\\'"))
}

/// Decode a keyset pagination value. Returns None when the cell is SQL NULL —
/// `col > NULL` matches no rows, so the caller must abort with an error
/// instead of silently truncating the export.
fn keyset_value(row: &sqlx::mysql::MySqlRow, i: usize) -> Option<String> {
    if row.try_get_raw(i).map_or(true, |v| v.is_null()) {
        return None;
    }
    Some(crate::drivers::mysql::decode::cell_to_csv_string(row, i))
}

fn build_keyset_where(order_cols: &[String], last_vals: &[String]) -> String {
    if order_cols.len() == 1 {
        format!(
            "{} > {}",
            escape_mysql_identifier(&order_cols[0]),
            sql_quote(&last_vals[0])
        )
    } else {
        let cols: Vec<String> = order_cols
            .iter()
            .map(|c| escape_mysql_identifier(c))
            .collect();
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
    // Export is MySQL-only for now (it leans on SHOW-based metadata).
    if state.get_config(&connection_id).await?.db_type != DatabaseType::Mysql {
        return Err(AppError::QueryFailed("导出目前仅支持 MySQL 连接".to_string()));
    }
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

        let pk_cols: Vec<String> = all_columns
            .iter()
            .filter(|c| c.is_primary_key)
            .map(|c| c.name.clone())
            .collect();
        let has_pk = !pk_cols.is_empty();

        let order_col_names: Vec<String> = if has_pk {
            pk_cols
        } else {
            all_columns.iter().map(|c| c.name.clone()).collect()
        };

        let order_indices: Vec<usize> = order_col_names.iter()
            .map(|name| all_columns.iter().position(|c| &c.name == name).unwrap_or(0))
            .collect();

        let order_clause = order_col_names
            .iter()
            .map(|c| escape_mysql_identifier(c))
            .collect::<Vec<_>>()
            .join(", ");

        // database/table come from the frontend — always escape them so a
        // backtick in either cannot break out of the identifier.
        let esc_db = escape_mysql_identifier(&database);
        let esc_table = escape_mysql_identifier(&table);

        let batch_size: u32 = 5000;

        let mut file = tokio::fs::File::create(&file_path)
            .await
            .map_err(|e| AppError::QueryFailed(format!("无法创建文件: {}", e)))?;

        let header: Vec<String> = all_columns.iter().map(|c| csv_escape(&c.name)).collect();
        file.write_all(header.join(",").as_bytes())
            .await
            .map_err(write_err)?;
        file.write_all(b"\n").await.map_err(write_err)?;

        let mut conn = pool.acquire().await.map_err(|e| AppError::QueryFailed(e.to_string()))?;
        let mut total_rows: u64 = 0;
        let mut last_pk_values: Option<Vec<String>> = None;
        // No primary key: keyset pagination over all columns drops rows when
        // keys contain NULLs or duplicate rows exist on a batch boundary, so
        // fall back to OFFSET paging (slower, but complete).
        let mut offset: u64 = 0;

        loop {
            // Check cancellation
            if cancel_flag.load(Ordering::Relaxed) {
                emit_progress(total_rows, "cancelled", None);
                return Err(AppError::QueryFailed("导出已取消".to_string()));
            }

            let sql = if !has_pk {
                format!(
                    "SELECT * FROM {}.{} ORDER BY {} LIMIT {} OFFSET {}",
                    esc_db, esc_table, order_clause, batch_size, offset
                )
            } else if let Some(ref last_vals) = last_pk_values {
                let where_clause = build_keyset_where(&order_col_names, last_vals);
                format!(
                    "SELECT * FROM {}.{} WHERE {} ORDER BY {} LIMIT {}",
                    esc_db, esc_table, where_clause, order_clause, batch_size
                )
            } else {
                format!(
                    "SELECT * FROM {}.{} ORDER BY {} LIMIT {}",
                    esc_db, esc_table, order_clause, batch_size
                )
            };

            let mut stream = sqlx::query(&sql).fetch(&mut *conn);
            let mut batch_rows: u64 = 0;
            let mut batch_csv = String::new();
            let mut keyset_has_null = false;

            while let Some(row) = stream.try_next().await.map_err(|e| AppError::QueryFailed(e.to_string()))? {
                let col_count = row.columns().len();
                let mut fields = Vec::with_capacity(col_count);
                for i in 0..col_count {
                    fields.push(csv_escape(&crate::drivers::mysql::decode::cell_to_csv_string(
                        &row, i,
                    )));
                }
                batch_csv.push_str(&fields.join(","));
                batch_csv.push('\n');
                batch_rows += 1;

                if has_pk {
                    let row_vals: Option<Vec<String>> = order_indices
                        .iter()
                        .map(|&idx| keyset_value(&row, idx))
                        .collect();
                    match row_vals {
                        Some(v) => last_pk_values = Some(v),
                        None => keyset_has_null = true,
                    }
                }
            }

            if batch_rows == 0 { break; }

            if keyset_has_null {
                return Err(AppError::QueryFailed(
                    "导出中止：排序键（主键）包含 NULL 值，无法继续分页导出".to_string(),
                ));
            }

            if !has_pk {
                offset += batch_rows;
            }

            file.write_all(batch_csv.as_bytes()).await.map_err(write_err)?;
            total_rows += batch_rows;
            emit_progress(total_rows, "running", None);

            if batch_rows < batch_size as u64 { break; }
        }

        file.flush().await.map_err(write_err)?;
        Ok(ExportResult { total_rows, elapsed_ms: start.elapsed().as_millis() as u64, file_path: file_path.to_string_lossy().to_string() })
    }.await;

    cancels.remove(&eid);

    if cancel_flag.load(Ordering::Relaxed) {
        // The in-loop check already emitted the terminal "cancelled" event;
        // don't overwrite it with a contradictory "error" event.
    } else {
        match &result {
            Ok(r) => emit_progress(r.total_rows, "done", None),
            Err(e) => emit_progress(0, "error", Some(e.to_string())),
        }
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

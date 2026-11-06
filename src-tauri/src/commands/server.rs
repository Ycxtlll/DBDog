use crate::connection::model::DatabaseType;
use crate::drivers::mysql::decode;
use crate::error::AppError;
use crate::state::AppState;
use crate::utils::validate_thread_id;
use serde::Serialize;
use uuid::Uuid;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProcessRow {
    pub id: u64,
    pub user: String,
    pub host: String,
    pub db: Option<String>,
    pub command: String,
    pub time_secs: u64,
    pub state: Option<String>,
    pub info: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerVariable {
    pub name: String,
    pub value: Option<String>,
}

#[tauri::command]
pub async fn get_processlist(
    state: tauri::State<'_, AppState>,
    connection_id: Uuid,
) -> Result<Vec<ProcessRow>, AppError> {
    if state.get_config(&connection_id).await?.db_type != DatabaseType::Mysql {
        return Err(AppError::QueryFailed("服务器面板暂仅支持 MySQL 连接".to_string()));
    }
    let pool = state
        .pool_manager
        .get(&connection_id)
        .ok_or_else(|| AppError::ConnectionNotFound(connection_id.to_string()))?;

    let rows = sqlx::query(
        "SELECT id, user, host, db, command, time, state, info \
         FROM information_schema.processlist ORDER BY id",
    )
    .fetch_all(&pool)
    .await?;

    Ok(rows
        .iter()
        .map(|row| ProcessRow {
            id: decode::sql_opt_u64(row, "id").unwrap_or(0),
            user: decode::sql_string(row, "user"),
            host: decode::sql_string(row, "host"),
            db: decode::sql_opt_string(row, "db"),
            command: decode::sql_string(row, "command"),
            time_secs: decode::sql_opt_u64(row, "time").unwrap_or(0),
            state: decode::sql_opt_string(row, "state"),
            info: decode::sql_opt_string(row, "info"),
        })
        .collect())
}

#[tauri::command]
pub async fn get_server_variables(
    state: tauri::State<'_, AppState>,
    connection_id: Uuid,
) -> Result<Vec<ServerVariable>, AppError> {
    if state.get_config(&connection_id).await?.db_type != DatabaseType::Mysql {
        return Err(AppError::QueryFailed("服务器面板暂仅支持 MySQL 连接".to_string()));
    }
    let pool = state
        .pool_manager
        .get(&connection_id)
        .ok_or_else(|| AppError::ConnectionNotFound(connection_id.to_string()))?;

    // SHOW works on MySQL 5.7/8.x and MariaDB alike — the
    // information_schema.global_variables table was removed in MySQL 8.0
    // (error 1109). Column names are decoded case-insensitively.
    let rows = sqlx::query("SHOW GLOBAL VARIABLES").fetch_all(&pool).await?;

    Ok(rows
        .iter()
        .map(|row| ServerVariable {
            name: decode::sql_string(row, "variable_name"),
            value: decode::sql_opt_string(row, "variable_value"),
        })
        .collect())
}

#[tauri::command]
pub async fn get_server_status(
    state: tauri::State<'_, AppState>,
    connection_id: Uuid,
) -> Result<Vec<ServerVariable>, AppError> {
    if state.get_config(&connection_id).await?.db_type != DatabaseType::Mysql {
        return Err(AppError::QueryFailed("服务器面板暂仅支持 MySQL 连接".to_string()));
    }
    let pool = state
        .pool_manager
        .get(&connection_id)
        .ok_or_else(|| AppError::ConnectionNotFound(connection_id.to_string()))?;

    // See get_server_variables: SHOW instead of the 8.0-removed
    // information_schema.global_status (error 1109).
    let rows = sqlx::query("SHOW GLOBAL STATUS").fetch_all(&pool).await?;

    Ok(rows
        .iter()
        .map(|row| ServerVariable {
            name: decode::sql_string(row, "variable_name"),
            value: decode::sql_opt_string(row, "variable_value"),
        })
        .collect())
}

/// Disconnect another client's connection (`KILL <id>` — distinct from the
/// query editor's cancel, which runs `KILL QUERY` and leaves the session).
#[tauri::command]
pub async fn kill_process(
    state: tauri::State<'_, AppState>,
    connection_id: Uuid,
    thread_id: u64,
) -> Result<(), AppError> {
    if state.get_config(&connection_id).await?.db_type != DatabaseType::Mysql {
        return Err(AppError::QueryFailed("服务器面板暂仅支持 MySQL 连接".to_string()));
    }
    let pool = state
        .pool_manager
        .get(&connection_id)
        .ok_or_else(|| AppError::ConnectionNotFound(connection_id.to_string()))?;

    let validated_id =
        validate_thread_id(thread_id).map_err(AppError::QueryFailed)?;
    // KILL does not support prepared-statement placeholders; the id is
    // validated to be a non-zero u64 so only digits can be interpolated.
    let kill_sql = format!("KILL {}", validated_id);
    sqlx::raw_sql(&kill_sql)
        .execute(&pool)
        .await
        .map_err(|e| AppError::QueryFailed(format!("KILL failed: {}", e)))?;
    Ok(())
}

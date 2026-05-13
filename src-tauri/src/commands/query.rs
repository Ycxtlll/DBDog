use crate::drivers::mysql::metadata::MySqlDriver;
use crate::drivers::DatabaseDriver;
use crate::error::AppError;
use crate::query::result::{QueryResult, UpdateResult};
use crate::state::AppState;
use crate::utils::escape_mysql_identifier;
use uuid::Uuid;

#[tauri::command]
pub async fn execute_query(
    state: tauri::State<'_, AppState>,
    connection_id: Uuid,
    sql: String,
    limit: Option<u32>,
    database: Option<String>,
) -> Result<QueryResult, AppError> {
    let pool = state
        .pool_manager
        .get(&connection_id)
        .ok_or_else(|| AppError::ConnectionNotFound(connection_id.to_string()))?;

    let mut conn = pool
        .acquire()
        .await
        .map_err(|e| AppError::QueryFailed(e.to_string()))?;

    if let Some(ref db) = database {
        let use_sql = format!("USE {}", escape_mysql_identifier(db));
        sqlx::query(&use_sql)
            .execute(&mut *conn)
            .await
            .map_err(|e| AppError::QueryFailed(e.to_string()))?;
    }

    let result = crate::query::engine::execute_query(
        &mut conn,
        &sql,
        limit.unwrap_or(1000),
    )
    .await;

    // Invalidate cache on DDL
    if let Ok(ref res) = result {
        let _ = res; // suppress unused warning
        state.schema_cache.invalidate_on_ddl(&connection_id, &sql);
    }

    result
}

#[tauri::command]
pub async fn execute_update(
    state: tauri::State<'_, AppState>,
    connection_id: Uuid,
    sql: String,
    database: Option<String>,
) -> Result<UpdateResult, AppError> {
    let pool = state
        .pool_manager
        .get(&connection_id)
        .ok_or_else(|| AppError::ConnectionNotFound(connection_id.to_string()))?;

    let mut conn = pool
        .acquire()
        .await
        .map_err(|e| AppError::QueryFailed(e.to_string()))?;

    if let Some(ref db) = database {
        let use_sql = format!("USE {}", escape_mysql_identifier(db));
        sqlx::query(&use_sql)
            .execute(&mut *conn)
            .await
            .map_err(|e| AppError::QueryFailed(e.to_string()))?;
    }

    let result = crate::query::engine::execute_update(&mut conn, &sql).await;

    state.schema_cache.invalidate_on_ddl(&connection_id, &sql);

    result
}

#[tauri::command]
pub async fn cancel_query(
    state: tauri::State<'_, AppState>,
    connection_id: Uuid,
    thread_id: u64,
) -> Result<(), AppError> {
    let pool = state
        .pool_manager
        .get(&connection_id)
        .ok_or_else(|| AppError::ConnectionNotFound(connection_id.to_string()))?;

    let driver = MySqlDriver::new();
    driver.cancel_query(&pool, thread_id).await
}

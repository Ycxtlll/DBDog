use crate::drivers::mysql::metadata::MySqlDriver;
use crate::drivers::DatabaseDriver;
use crate::error::AppError;
use crate::query::result::{QueryResult, UpdateResult};
use crate::state::AppState;
use crate::utils::escape_mysql_identifier;
use uuid::Uuid;

/// Execute a `USE <database>` statement via the MySQL text protocol.
///
/// `USE` is not supported by MySQL's prepared-statement protocol, so we use
/// `sqlx::raw_sql` instead of `sqlx::query` to send it via COM_QUERY.
/// We use `block_in_place` + `block_on` to resolve the raw_sql future
/// locally, avoiding HRTB lifetime issues with `#[tauri::command]` async fns.
fn switch_database(
    conn: &mut sqlx::pool::PoolConnection<sqlx::MySql>,
    db: &str,
) -> Result<(), AppError> {
    let use_sql = format!("USE {}", escape_mysql_identifier(db));
    tokio::task::block_in_place(|| {
        tokio::runtime::Handle::current().block_on(async {
            let _ = sqlx::raw_sql(&use_sql)
                .execute(&mut **conn)
                .await
                .map_err(|e| AppError::QueryFailed(e.to_string()))?;
            Ok::<_, AppError>(())
        })
    })
}

/// Resolve which database the query should run in: the explicitly requested
/// one, or the connection's configured default. A pooled connection keeps
/// whatever `USE` ran last on it (e.g. from another tab), so never running
/// with "whatever is left over" prevents wrong-database reads/writes.
fn effective_database(
    state: &tauri::State<'_, AppState>,
    connection_id: &Uuid,
    database: &Option<String>,
) -> Option<String> {
    database
        .clone()
        .or_else(|| state.session_databases.get(connection_id).map(|e| e.value().clone()))
}

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

    if let Some(db) = effective_database(&state, &connection_id, &database) {
        switch_database(&mut conn, &db)?;
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

    if let Some(db) = effective_database(&state, &connection_id, &database) {
        switch_database(&mut conn, &db)?;
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

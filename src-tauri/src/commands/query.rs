use serde::Serialize;
use crate::connection::model::DatabaseType;
use crate::drivers::mysql::metadata::MySqlDriver;
use crate::drivers::postgres::PgDriver;
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
    let db_type = state.get_config(&connection_id).await?.db_type;

    if db_type == DatabaseType::Postgresql {
        // PostgreSQL: schemas are the tree level, and the tab's selection is
        // pinned per query via set_config (SET cannot take a parameter).
        let pool = state
            .pg_pool_manager
            .get(&connection_id)
            .ok_or_else(|| AppError::ConnectionNotFound(connection_id.to_string()))?;
        return PgDriver::new()
            .execute_query(&pool, &sql, limit.unwrap_or(1000), database.as_deref())
            .await;
    }

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
    assume_yes: Option<bool>,
) -> Result<UpdateResult, AppError> {
    let config = state.get_config(&connection_id).await?;
    let db_type = config.db_type;

    // Connection-level safety switch: read-only connections refuse every
    // write at the engine layer, before any driver sees the statement.
    if config.read_only == Some(true) {
        return Err(AppError::QueryFailed(
            "此连接为只读连接，已拒绝写入语句（UPDATE/DELETE/INSERT/DDL）".to_string(),
        ));
    }

    // Authoritative top-level WHERE guard: reject when the caller has not
    // confirmed an unscoped UPDATE/DELETE (the GUI confirms first, then
    // passes assume_yes).
    if !assume_yes.unwrap_or(false) {
        if let crate::query::guard::StatementKind::Update(kind) =
            crate::query::guard::classify_statement(&sql)
        {
            if (kind == "UPDATE" || kind == "DELETE") && !crate::query::guard::has_top_level_where(&sql)
            {
                return Err(AppError::UnscopedDml(kind));
            }
        }
    }

    if db_type == DatabaseType::Postgresql {
        let pool = state
            .pg_pool_manager
            .get(&connection_id)
            .ok_or_else(|| AppError::ConnectionNotFound(connection_id.to_string()))?;
        return PgDriver::new().execute_update(&pool, &sql).await;
    }

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

    let result = crate::query::engine::execute_update(&pool, &mut conn, &sql).await;

    state.schema_cache.invalidate_on_ddl(&connection_id, &sql);

    result
}

#[tauri::command]
pub async fn cancel_query(
    state: tauri::State<'_, AppState>,
    connection_id: Uuid,
    thread_id: u64,
) -> Result<(), AppError> {
    let db_type = state.get_config(&connection_id).await?.db_type;
    if db_type == DatabaseType::Postgresql {
        let pool = state
            .pg_pool_manager
            .get(&connection_id)
            .ok_or_else(|| AppError::ConnectionNotFound(connection_id.to_string()))?;
        // pg_cancel_backend takes the backend PID (int4).
        sqlx::query("SELECT pg_cancel_backend($1)")
            .bind(thread_id as i32)
            .execute(&pool)
            .await
            .map(|_| ())
            .map_err(|e| AppError::QueryFailed(e.to_string()))
    } else {
        let pool = state
            .pool_manager
            .get(&connection_id)
            .ok_or_else(|| AppError::ConnectionNotFound(connection_id.to_string()))?;
        let driver = MySqlDriver::new();
        driver.cancel_query(&pool, thread_id).await
    }
}

/// Apply a staged changeset: every statement runs inside ONE transaction —
/// either the whole batch lands or nothing does. A failed statement aborts
/// and rolls back, and the error names the failing statement.
#[tauri::command]
pub async fn execute_transaction(
    state: tauri::State<'_, AppState>,
    connection_id: Uuid,
    statements: Vec<String>,
    assume_yes: Option<bool>,
) -> Result<u64, AppError> {
    let config = state.get_config(&connection_id).await?;
    if config.read_only == Some(true) {
        return Err(AppError::QueryFailed(
            "此连接为只读连接，已拒绝写入".to_string(),
        ));
    }
    if config.db_type != DatabaseType::Mysql {
        return Err(AppError::DriverNotSupported(
            "变更集事务暂仅支持 MySQL 连接".to_string(),
        ));
    }
    if statements.is_empty() {
        return Ok(0);
    }
    // Authoritative guard inside the transaction too — the review panel is
    // the confirmation, so the GUI passes assume_yes=true.
    if !assume_yes.unwrap_or(false) {
        for stmt in &statements {
            if let crate::query::guard::StatementKind::Update(kind) =
                crate::query::guard::classify_statement(stmt)
            {
                if (kind == "UPDATE" || kind == "DELETE") && !crate::query::guard::has_top_level_where(stmt)
                {
                    return Err(AppError::UnscopedDml(kind));
                }
            }
        }
    }

    let pool = state
        .pool_manager
        .get(&connection_id)
        .ok_or_else(|| AppError::ConnectionNotFound(connection_id.to_string()))?;

    for stmt in &statements {
        state.schema_cache.invalidate_on_ddl(&connection_id, stmt);
    }
    let affected = crate::query::engine::execute_transaction(pool, statements).await?;
    Ok(affected)
}

/// Per-statement outcome of `execute_script` (for history/debugging).
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StatementOutcome {
    pub kind: String,
    pub sql: String,
    pub rows_affected: u64,
    pub elapsed_ms: u64,
}

/// Authoritative script execution: the backend splits the script, pre-scans
/// every write for the top-level WHERE guard (before ANYTHING runs — a
/// rejected pre-scan leaves no partial side effects) and executes statement
/// by statement on one pooled connection so `USE` session state applies
/// (MySQL). PostgreSQL runs per-statement through its driver with the schema
/// pinned per query. The editor's cursor/selection UX stays in the frontend.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScriptResult {
    pub statements: Vec<StatementOutcome>,
    /// Result of the last SELECT-like statement, if any.
    pub final_result: Option<QueryResult>,
    /// Every query statement's result set in statement order — the editor
    /// shows them as switchable result tabs (multi-SELECT scripts used to
    /// drop everything but the last).
    pub query_results: Vec<QueryResult>,
    pub final_is_query: bool,
    pub final_rows_affected: u64,
    /// Sum of every query's total row count (matches the old frontend loop).
    pub total_rows: u64,
    /// Effective database after any USE statements in the script.
    pub last_database: Option<String>,
    pub elapsed_ms: u64,
}

#[tauri::command]
pub async fn execute_script(
    state: tauri::State<'_, AppState>,
    connection_id: Uuid,
    sql: String,
    limit: Option<u32>,
    database: Option<String>,
    assume_yes: Option<bool>,
) -> Result<ScriptResult, AppError> {
    use crate::query::guard::{classify_statement, has_top_level_where, limit_guard, split_statements, StatementKind};

    let config = state.get_config(&connection_id).await?;
    let read_only = config.read_only == Some(true);
    let assume_yes = assume_yes == Some(true);

    let statements = split_statements(&sql);
    // A comment-only selection is not an error — the old frontend silently
    // ignored it and the editor's UX depends on that.
    if statements.is_empty() {
        return Ok(ScriptResult {
            statements: vec![],
            final_result: None,
            query_results: vec![],
            final_is_query: false,
            final_rows_affected: 0,
            total_rows: 0,
            last_database: effective_database(&state, &connection_id, &database),
            elapsed_ms: 0,
        });
    }

    // Pre-scan BEFORE executing anything: read-only rejects every write;
    // unscoped UPDATE/DELETE requires assume_yes (the GUI confirms and
    // retries). A rejected pre-scan leaves zero side effects.
    for stmt in &statements {
        match classify_statement(stmt) {
            StatementKind::Update(kind) => {
                if read_only {
                    return Err(AppError::QueryFailed(
                        "此连接为只读连接，已拒绝写入语句".to_string(),
                    ));
                }
                if (kind == "UPDATE" || kind == "DELETE") && !has_top_level_where(stmt) && !assume_yes {
                    return Err(AppError::UnscopedDml(kind));
                }
            }
            _ => {}
        }
    }

    // PostgreSQL has no USE/session-database semantics — run each statement
    // through the PG driver with the schema pinned per query. The same
    // pre-scan guards (read-only + top-level WHERE) apply.
    if config.db_type == DatabaseType::Postgresql {
        let pool = state
            .pg_pool_manager
            .get(&connection_id)
            .ok_or_else(|| AppError::ConnectionNotFound(connection_id.to_string()))?;
        let overall_start = std::time::Instant::now();
        let cap = limit.unwrap_or(1000);
        let mut outcomes: Vec<StatementOutcome> = Vec::new();
        let mut total_rows: u64 = 0;
        let mut final_result: Option<QueryResult> = None;
        let mut query_results: Vec<QueryResult> = Vec::new();
        let mut final_is_query = false;
        let mut final_rows_affected: u64 = 0;
        let count = statements.len();
        for (idx, stmt) in statements.iter().enumerate() {
            let is_last = idx + 1 == count;
            let start = std::time::Instant::now();
            match classify_statement(stmt) {
                StatementKind::Use(_) => {
                    // Not a PG concept; the server would reject it. Execute
                    // anyway so the error surfaces like it used to.
                    let result = PgDriver::new().execute_update(&pool, stmt).await?;
                    if is_last {
                        final_rows_affected = result.rows_affected;
                    }
                    outcomes.push(StatementOutcome {
                        kind: "update".to_string(),
                        sql: stmt.clone(),
                        rows_affected: result.rows_affected,
                        elapsed_ms: start.elapsed().as_millis() as u64,
                    });
                }
                StatementKind::Query => {
                    let result = PgDriver::new()
                        .execute_query(&pool, stmt, cap, database.as_deref())
                        .await?;
                    total_rows += result.total_count;
                    if is_last {
                        final_result = Some(result.clone());
                        final_is_query = true;
                    }
                    query_results.push(result);
                    outcomes.push(StatementOutcome {
                        kind: "query".to_string(),
                        sql: stmt.clone(),
                        rows_affected: 0,
                        elapsed_ms: start.elapsed().as_millis() as u64,
                    });
                }
                StatementKind::Update(_) => {
                    let result = PgDriver::new().execute_update(&pool, stmt).await?;
                    if is_last {
                        final_rows_affected = result.rows_affected;
                        final_is_query = false;
                    }
                    outcomes.push(StatementOutcome {
                        kind: "update".to_string(),
                        sql: stmt.clone(),
                        rows_affected: result.rows_affected,
                        elapsed_ms: start.elapsed().as_millis() as u64,
                    });
                }
            }
        }
        return Ok(ScriptResult {
            statements: outcomes,
            final_result,
            query_results,
            final_is_query,
            final_rows_affected,
            total_rows,
            last_database: database.clone(),
            elapsed_ms: overall_start.elapsed().as_millis() as u64,
        });
    }

    if config.db_type != DatabaseType::Mysql {
        return Err(AppError::DriverNotSupported(
            "不支持的连接类型".to_string(),
        ));
    }

    let pool = state
        .pool_manager
        .get(&connection_id)
        .ok_or_else(|| AppError::ConnectionNotFound(connection_id.to_string()))?;

    let overall_start = std::time::Instant::now();
    let mut conn = pool
        .acquire()
        .await
        .map_err(|e| AppError::QueryFailed(e.to_string()))?;

    let mut current_db = effective_database(&state, &connection_id, &database);
    if let Some(db) = &current_db {
        switch_database(&mut conn, &db)?;
    }

    let cap = limit.unwrap_or(1000);
    let mut outcomes: Vec<StatementOutcome> = Vec::new();
    let mut total_rows: u64 = 0;
    let mut final_result: Option<QueryResult> = None;
    let mut query_results: Vec<QueryResult> = Vec::new();
    let mut final_is_query = false;
    let mut final_rows_affected: u64 = 0;
    let count = statements.len();

    for (idx, stmt) in statements.iter().enumerate() {
        let is_last = idx + 1 == count;
        let start = std::time::Instant::now();
        match classify_statement(stmt) {
            StatementKind::Use(db) => {
                switch_database(&mut conn, &db)?;
                current_db = Some(db);
                outcomes.push(StatementOutcome {
                    kind: "use".to_string(),
                    sql: stmt.clone(),
                    rows_affected: 0,
                    elapsed_ms: start.elapsed().as_millis() as u64,
                });
            }
            StatementKind::Query => {
                let sent = limit_guard(stmt, cap);
                let result = crate::query::engine::execute_query(&mut conn, &sent, cap).await?;
                total_rows += result.total_count;
                state.schema_cache.invalidate_on_ddl(&connection_id, stmt);
                if is_last {
                    final_result = Some(result.clone());
                    final_is_query = true;
                }
                query_results.push(result);
                outcomes.push(StatementOutcome {
                    kind: "query".to_string(),
                    sql: stmt.clone(),
                    rows_affected: 0,
                    elapsed_ms: start.elapsed().as_millis() as u64,
                });
            }
            StatementKind::Update(_) => {
                let result = crate::query::engine::execute_update(&pool, &mut conn, stmt).await?;
                state.schema_cache.invalidate_on_ddl(&connection_id, stmt);
                if is_last {
                    final_rows_affected = result.rows_affected;
                    final_is_query = false;
                }
                outcomes.push(StatementOutcome {
                    kind: "update".to_string(),
                    sql: stmt.clone(),
                    rows_affected: result.rows_affected,
                    elapsed_ms: start.elapsed().as_millis() as u64,
                });
            }
        }
    }

    Ok(ScriptResult {
        statements: outcomes,
        final_result,
        query_results,
        final_is_query,
        final_rows_affected,
        total_rows,
        last_database: current_db,
        elapsed_ms: overall_start.elapsed().as_millis() as u64,
    })
}

/// Generate a staged change's forward + rollback SQL on the backend — the
/// rollback statements are the changeset's safety net and must match the
/// Rust-tested generators exactly (frontend string building removed).
#[tauri::command]
pub async fn changeset_prepare(
    request: crate::query::changeset::ChangesetPrepareRequest,
) -> Result<crate::query::changeset::PreparedChange, AppError> {
    crate::query::changeset::prepare(request)
}

/// Pure filter-model → search-SQL translation (no connection needed).
#[tauri::command]
pub async fn filter_search_sql_command(
    database: String,
    table: String,
    model: serde_json::Value,
) -> Result<Option<String>, AppError> {
    Ok(crate::query::filter_translate::filter_search_sql(
        &database, &table, &model,
    ))
}

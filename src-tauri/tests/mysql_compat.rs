//! MySQL-variant compatibility matrix for DBDog's driver.
//!
//! Runs every metadata + query code path against live servers and asserts
//! names/values decode correctly. Guards against the class of bug where a
//! server-version wire quirk (MySQL 8.4: BINARY-flagged information_schema
//! strings, uppercased unaliased column names) silently empties the UI.
//!
//! Opt-in, so plain `cargo test` never needs a database:
//!
//! ```text
//! DBDOG_COMPAT_TARGETS='dev84=root:pw@127.0.0.1:3306,mysql57=root:pw@127.0.0.1:23306' \
//!   cargo test --test mysql_compat -- --nocapture
//! ```
//!
//! Target format: `label=user:password@host:port`, comma-separated.
//! Each target gets a scratch database `__dbdog_compat` (dropped before and
//! after) with representative column types: utf8mb4 text, _bin collation,
//! DECIMAL, BIGINT UNSIGNED, YEAR, VARBINARY, ENUM, TEXT, JSON, plus a FK
//! child table and a trigger.

use dbdog_lib::connection::model::{ConnectionConfig, DatabaseType, SslMode};
use dbdog_lib::drivers::mysql::metadata::MySqlDriver;
use dbdog_lib::drivers::{DatabaseDriver, DatabaseMetadata};
use dbdog_lib::query::engine;
use serde_json::Value;
use sqlx::mysql::MySqlPool;

const SCRATCH_DB: &str = "__dbdog_compat";
const UTF8_TEXT: &str = "狗🐶text";
const BIN_TEXT: &str = "CaseSenSitive";
const BIG_UNSIGNED: u64 = 18_446_744_073_709_551_615;

fn parse_targets() -> Vec<(String, ConnectionConfig)> {
    let raw = match std::env::var("DBDOG_COMPAT_TARGETS") {
        Ok(v) if !v.trim().is_empty() => v,
        _ => return Vec::new(),
    };
    raw.split(',')
        .filter_map(|entry| {
            let entry = entry.trim();
            let (label, rest) = entry.split_once('=')?;
            let (creds, hostport) = rest.rsplit_once('@')?;
            let (user, pass) = creds.split_once(':')?;
            let (host, port) = hostport.rsplit_once(':')?;
            Some((
                label.trim().to_string(),
                ConnectionConfig {
                    id: uuid::Uuid::new_v4(),
                    name: label.trim().to_string(),
                    db_type: DatabaseType::Mysql,
                    host: host.trim().to_string(),
                    port: port.trim().parse().ok()?,
                    username: user.trim().to_string(),
                    password: Some(pass.to_string()),
                    database: None,
                    max_connections: Some(4),
                    ssl_mode: Some(SslMode::Disabled),
                    ssl_cert_path: None,
                    password_hash: None,
                    group: None,
                    ssh_enabled: None,
                    ssh_host: None,
                    ssh_port: None,
                    ssh_user: None,
                    ssh_key_path: None,
        read_only: None,
                },
            ))
        })
        .collect()
}

async fn exec(pool: &MySqlPool, sql: &str) -> Result<(), String> {
    sqlx::query(sql)
        .execute(pool)
        .await
        .map(|_| ())
        .map_err(|e| format!("DDL failed: {sql:.80}…: {e}"))
}

async fn setup_scratch(pool: &MySqlPool) -> Result<(), String> {
    exec(pool, &format!("DROP DATABASE IF EXISTS `{SCRATCH_DB}`")).await?;
    exec(pool, &format!("CREATE DATABASE `{SCRATCH_DB}` CHARACTER SET utf8mb4")).await?;
    exec(
        pool,
        &format!(
            "CREATE TABLE `{SCRATCH_DB}`.`compat_main` (
                id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
                vc VARCHAR(100) NOT NULL,
                vc_bin VARCHAR(64) NOT NULL COLLATE utf8mb4_bin,
                amount DECIMAL(10,2) NOT NULL,
                bu BIGINT UNSIGNED NOT NULL,
                yr YEAR NULL,
                bl VARBINARY(64) NOT NULL,
                e ENUM('a','b') NOT NULL,
                t TEXT NULL,
                j JSON NULL
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4"
        ),
    )
    .await?;
    exec(
        pool,
        &format!(
            "CREATE TABLE `{SCRATCH_DB}`.`compat_child` (
                id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
                main_id INT UNSIGNED NOT NULL,
                CONSTRAINT `fk_compat_main` FOREIGN KEY (main_id)
                    REFERENCES `{SCRATCH_DB}`.`compat_main`(id)
            ) ENGINE=InnoDB"
        ),
    )
    .await?;
    exec(
        pool,
        &format!(
            "INSERT INTO `{SCRATCH_DB}`.`compat_main` (vc, vc_bin, amount, bu, yr, bl, e, t, j)
             VALUES ('{UTF8_TEXT}', '{BIN_TEXT}', 123.46, {BIG_UNSIGNED}, 2024,
                     UNHEX('C328'), 'a', 'some text', '{{\"x\": 1}}')"
        ),
    )
    .await
}

async fn teardown_scratch(pool: &MySqlPool) {
    let _ = sqlx::query(&format!("DROP DATABASE IF EXISTS `{SCRATCH_DB}`"))
        .execute(pool)
        .await;
}

fn require(cond: bool, what: &str) -> Result<(), String> {
    if cond {
        Ok(())
    } else {
        Err(format!("assertion failed: {what}"))
    }
}

async fn run_target(label: &str, config: &ConnectionConfig) -> Result<(), String> {
    let driver = MySqlDriver::new();

    let version = driver
        .test(config)
        .await
        .map_err(|e| format!("test() failed: {e:?}"))?;
    require(!version.is_empty(), "VERSION() non-empty")?;
    println!("[{label}] server version: {version}");

    let pool = driver
        .connect(config)
        .await
        .map_err(|e| format!("connect() failed: {e:?}"))?;

    let result = run_checks(label, &driver, &pool).await;
    teardown_scratch(&pool).await;
    pool.close().await;
    result
}

async fn run_checks(
    label: &str,
    driver: &MySqlDriver,
    pool: &MySqlPool,
) -> Result<(), String> {
    setup_scratch(pool).await?;

    // ── databases ──
    let dbs = driver
        .fetch_databases(pool)
        .await
        .map_err(|e| format!("fetch_databases failed: {e:?}"))?;
    require(
        dbs.iter().all(|d| !d.name.is_empty()),
        "fetch_databases: every database has a non-empty name",
    )?;
    require(
        dbs.iter().any(|d| d.name == SCRATCH_DB),
        "fetch_databases: scratch database listed",
    )?;

    // ── tables ──
    let tables = driver
        .fetch_tables(pool, SCRATCH_DB)
        .await
        .map_err(|e| format!("fetch_tables failed: {e:?}"))?;
    let main = tables
        .iter()
        .find(|t| t.name == "compat_main")
        .ok_or("fetch_tables: compat_main listed")?;
    require(
        main.engine.as_deref().unwrap_or("").eq_ignore_ascii_case("innodb"),
        "fetch_tables: engine decoded",
    )?;
    require(main.rows.is_some(), "fetch_tables: row count decoded")?;
    require(main.size_mb.is_some(), "fetch_tables: size decoded")?;

    // ── columns ──
    let cols = driver
        .fetch_columns(pool, SCRATCH_DB, "compat_main")
        .await
        .map_err(|e| format!("fetch_columns failed: {e:?}"))?;
    let vc = cols
        .iter()
        .find(|c| c.name == "vc")
        .ok_or("fetch_columns: vc column listed")?;
    require(vc.nullable == false, "fetch_columns: vc NOT NULL flag")?;
    require(vc.max_length == Some(100), "fetch_columns: vc max_length=100")?;
    let id = cols
        .iter()
        .find(|c| c.name == "id")
        .ok_or("fetch_columns: id column listed")?;
    require(id.is_primary_key && id.is_auto_increment, "fetch_columns: id PK + auto_increment")?;
    let amount = cols
        .iter()
        .find(|c| c.name == "amount")
        .ok_or("fetch_columns: amount column listed")?;
    require(
        amount.data_type.to_lowercase().starts_with("decimal"),
        "fetch_columns: amount decimal type",
    )?;

    // ── indexes ──
    let idx = driver
        .fetch_indexes(pool, SCRATCH_DB, "compat_main")
        .await
        .map_err(|e| format!("fetch_indexes failed: {e:?}"))?;
    let pk = idx
        .iter()
        .find(|i| i.is_primary)
        .ok_or("fetch_indexes: PRIMARY found")?;
    require(pk.columns.contains(&"id".to_string()), "fetch_indexes: PRIMARY on id")?;
    require(pk.is_unique, "fetch_indexes: PRIMARY unique")?;

    // ── foreign keys ──
    let fks = driver
        .fetch_foreign_keys(pool, SCRATCH_DB, "compat_child")
        .await
        .map_err(|e| format!("fetch_foreign_keys failed: {e:?}"))?;
    let fk = fks
        .first()
        .ok_or("fetch_foreign_keys: at least one FK")?;
    require(!fk.name.is_empty(), "fetch_foreign_keys: FK name non-empty")?;
    require(fk.referenced_table.as_deref() == Some("compat_main"), "fetch_foreign_keys: referenced table")?;
    require(fk.referenced_column.as_deref() == Some("id"), "fetch_foreign_keys: referenced column")?;
    require(fk.update_rule.as_deref().unwrap_or("").len() > 0, "fetch_foreign_keys: update_rule decoded")?;

    // ── triggers: created through DBDog's execute_update, which must fall
    // back to the text protocol because the server-side prepared-statement
    // protocol rejects CREATE TRIGGER (ER_UNSUPPORTED_PS 1295) ──
    let mut conn = pool
        .acquire()
        .await
        .map_err(|e| format!("acquire failed: {e:?}"))?;
    engine::execute_update(
        pool,
        &mut conn,
        &format!(
            "CREATE TRIGGER `{SCRATCH_DB}`.compat_trg AFTER INSERT ON `{SCRATCH_DB}`.`compat_main`
             FOR EACH ROW SET @compat_dummy = 1"
        ),
    )
    .await
    .map_err(|e| format!("execute_update(CREATE TRIGGER) failed: {e:?}"))?;

    let trigs = driver
        .fetch_triggers(pool, SCRATCH_DB, "compat_main")
        .await
        .map_err(|e| format!("fetch_triggers failed: {e:?}"))?;
    let trg = trigs.first().ok_or("fetch_triggers: trigger listed")?;
    require(trg.name == "compat_trg", "fetch_triggers: trigger name decoded")?;
    require(trg.event == "INSERT" && trg.timing == "AFTER", "fetch_triggers: event/timing decoded")?;
    require(!trg.statement.is_empty(), "fetch_triggers: statement decoded")?;

    // ── CREATE TABLE ──
    let ddl = driver
        .fetch_create_table(pool, SCRATCH_DB, "compat_main")
        .await
        .map_err(|e| format!("fetch_create_table failed: {e:?}"))?;
    require(
        ddl.contains("compat_main") && ddl.to_uppercase().contains("CREATE TABLE"),
        "fetch_create_table: DDL decoded",
    )?;

    // ── search (both the table-name and the column-name branch) ──
    let hits = driver
        .search_schema(pool, "compat_main")
        .await
        .map_err(|e| format!("search_schema failed: {e:?}"))?;
    require(
        hits.iter()
            .any(|r| r.database == SCRATCH_DB && r.object_name == "compat_main"),
        "search_schema: scratch table found with real names",
    )?;
    let col_hits = driver
        .search_schema(pool, "main_id")
        .await
        .map_err(|e| format!("search_schema(column) failed: {e:?}"))?;
    require(
        col_hits.iter().any(|r| {
            r.database == SCRATCH_DB
                && r.object_type == "column"
                && r.object_name == "compat_child"
                && r.column_name.as_deref() == Some("main_id")
        }),
        "search_schema: column search hit with database/table/column",
    )?;

    // ── completion schema (both bounded and unbounded paths) ──
    let comp = driver
        .fetch_completion_schema(pool, Some(SCRATCH_DB))
        .await
        .map_err(|e| format!("fetch_completion_schema(Some) failed: {e:?}"))?;
    require(
        comp.get(SCRATCH_DB)
            .and_then(|t| t.get("compat_main"))
            .map(|c| c.contains(&"vc".to_string()))
            .unwrap_or(false),
        "fetch_completion_schema(Some): columns listed",
    )?;
    let comp_all = driver
        .fetch_completion_schema(pool, None)
        .await
        .map_err(|e| format!("fetch_completion_schema(None) failed: {e:?}"))?;
    require(
        comp_all.contains_key(SCRATCH_DB),
        "fetch_completion_schema(None): scratch database present",
    )?;

    // ── query engine: user-data decode across representative types ──
    let mut conn = pool
        .acquire()
        .await
        .map_err(|e| format!("acquire failed: {e:?}"))?;
    let result = engine::execute_query(
        &mut conn,
        &format!("SELECT id, vc, vc_bin, amount, bu, yr, bl, e, t, j FROM `{SCRATCH_DB}`.`compat_main` ORDER BY id"),
        100,
    )
    .await
    .map_err(|e| format!("execute_query failed: {e:?}"))?;
    require(result.rows.len() == 1, "execute_query: one row")?;
    let row = &result.rows[0];
    require(
        row[0] == Value::Number(1u32.into()),
        "query: id INT UNSIGNED",
    )?;
    require(row[1] == Value::String(UTF8_TEXT.into()), "query: utf8mb4 text")?;
    require(row[2] == Value::String(BIN_TEXT.into()), "query: _bin collation text")?;
    require(row[3] == Value::String("123.46".into()), "query: DECIMAL as string")?;
    require(
        row[4] == serde_json::json!(BIG_UNSIGNED),
        "query: BIGINT UNSIGNED max value",
    )?;
    require(row[5] == serde_json::json!(2024), "query: YEAR")?;
    require(
        row[6] == Value::String("wyg=".into()),
        "query: VARBINARY (invalid UTF-8) as base64",
    )?;
    require(row[7] == Value::String("a".into()), "query: ENUM")?;
    require(row[8] == Value::String("some text".into()), "query: TEXT")?;
    require(
        row[9].as_object().is_some()
            || row[9]
                .as_str()
                .map(|s| s.contains("\"x\""))
                .unwrap_or(false),
        "query: JSON decodes (object on MySQL, text on MariaDB)",
    )?;

    println!("[{label}] all checks passed");
    Ok(())
}

#[tokio::test]
async fn mysql_variant_compatibility_matrix() {
    let targets = parse_targets();
    if targets.is_empty() {
        eprintln!(
            "DBDOG_COMPAT_TARGETS not set; skipping mysql compatibility matrix \
             (see tests/mysql_compat.rs header for usage)"
        );
        return;
    }
    let mut failures = Vec::new();
    for (label, config) in targets {
        // Run every target even when one fails, so a break on one server
        // version doesn't hide the results of the others.
        if let Err(e) = run_target(&label, &config).await {
            eprintln!("[{label}] FAILED: {e}");
            failures.push(format!("{label}: {e}"));
        }
    }
    if !failures.is_empty() {
        panic!(
            "compatibility matrix failed on {} target(s):\n{}",
            failures.len(),
            failures.join("\n")
        );
    }
}

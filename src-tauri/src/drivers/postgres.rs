//! PostgreSQL driver: connection, metadata and query execution.
//!
//! The GUI's tree model maps PostgreSQL schemas to the "database" level —
//! a PostgreSQL connection logs into one database and `get_databases`
//! returns its schemas (public, …), so everything above stays uniform.

use crate::connection::model::{ConnectionConfig, DatabaseType, SslMode};
use crate::error::AppError;
use crate::query::result::{QueryResult, UpdateResult};
use crate::schema::model::*;
use serde_json::Value;
use sqlx::postgres::{PgConnectOptions, PgPool, PgPoolOptions, PgRow, PgSslMode};
use sqlx::{Column as _, Row, TypeInfo, ValueRef};
use std::time::Instant;

pub struct PgDriver;

impl Default for PgDriver {
    fn default() -> Self {
        Self::new()
    }
}

impl PgDriver {
    pub fn new() -> Self {
        Self
    }

    /// PostgreSQL requires a database in the login packet; fall back to the
    /// always-present `postgres` maintenance database.
    pub fn build_options(config: &ConnectionConfig) -> Result<PgConnectOptions, AppError> {
        let mut opts = PgConnectOptions::new()
            .host(&config.host)
            .port(config.port)
            .username(&config.username);
        if let Some(ref password) = config.password {
            opts = opts.password(password);
        }
        let database = config
            .database
            .clone()
            .filter(|d| !d.is_empty())
            .unwrap_or_else(|| "postgres".to_string());
        opts = opts.database(&database);
        opts = match config.ssl_mode.unwrap_or(SslMode::Disabled) {
            SslMode::Disabled => opts.ssl_mode(PgSslMode::Disable),
            // PG has no certificate verification modes without a root cert
            // wired up; required/verify map to the server-side "require".
            _ => opts.ssl_mode(PgSslMode::Require),
        };
        Ok(opts)
    }

    pub async fn test(&self, config: &ConnectionConfig) -> Result<String, AppError> {
        let pool = self.connect(config).await?;
        let version: (String,) = sqlx::query_as("SELECT version()")
            .fetch_one(&pool)
            .await
            .map_err(|e| AppError::QueryFailed(e.to_string()))?;
        pool.close().await;
        Ok(version.0)
    }

    pub async fn connect(&self, config: &ConnectionConfig) -> Result<PgPool, AppError> {
        if config.db_type != DatabaseType::Postgresql {
            return Err(AppError::DriverNotSupported(
                "Only PostgreSQL is supported".to_string(),
            ));
        }
        let opts = Self::build_options(config)?;
        let max_conns = config.max_connections.unwrap_or(10);
        let pool = PgPoolOptions::new()
            .max_connections(max_conns)
            .connect_with(opts)
            .await
            .map_err(|e| AppError::ConnectionFailed(e.to_string()))?;
        Ok(pool)
    }

    // ── Metadata ──

    /// Schemas of the connected database (the tree's "database" level).
    pub async fn fetch_databases(&self, pool: &PgPool) -> Result<Vec<Database>, AppError> {
        let rows = sqlx::query(
            "SELECT nspname AS name FROM pg_namespace \
             WHERE nspname NOT LIKE 'pg\\_%' ESCAPE '\\' AND nspname <> 'information_schema' \
             ORDER BY 1",
        )
        .fetch_all(pool)
        .await?;
        Ok(rows
            .iter()
            .map(|row| Database {
                name: row.try_get::<String, _>(0).unwrap_or_default(),
                charset: None,
                collation: None,
            })
            .collect())
    }

    pub async fn fetch_tables(&self, pool: &PgPool, schema: &str) -> Result<Vec<Table>, AppError> {
        let rows = sqlx::query(
            "SELECT c.relname AS name, c.reltuples::bigint AS row_count, \
                    pg_total_relation_size(c.oid) AS total_bytes, \
                    obj_description(c.oid, 'pg_class') AS comment \
             FROM pg_class c \
             JOIN pg_namespace n ON n.oid = c.relnamespace \
             WHERE n.nspname = $1 AND c.relkind = 'r' \
             ORDER BY c.relname",
        )
        .bind(schema)
        .fetch_all(pool)
        .await?;

        Ok(rows
            .iter()
            .map(|row| {
                let row_count: Option<i64> = row.try_get::<Option<i64>, _>("row_count").ok().flatten();
                let total_bytes: Option<i64> =
                    row.try_get::<Option<i64>, _>("total_bytes").ok().flatten();
                Table {
                    name: row.try_get::<String, _>("name").unwrap_or_default(),
                    // PostgreSQL has no storage-engine concept.
                    engine: None,
                    // reltuples is -1 when the table was never analyzed.
                    rows: row_count.filter(|n| *n >= 0).map(|n| n as u64),
                    size_mb: total_bytes.map(|b| (b as f64 / 1024.0 / 1024.0 * 100.0).round() / 100.0),
                    comment: row.try_get::<Option<String>, _>("comment").ok().flatten(),
                }
            })
            .collect())
    }

    pub async fn fetch_columns(
        &self,
        pool: &PgPool,
        schema: &str,
        table: &str,
    ) -> Result<Vec<Column>, AppError> {
        let rows = sqlx::query(
            "SELECT column_name, data_type, character_maximum_length, is_nullable, column_default, \
                    COALESCE(column_default LIKE 'nextval%', false) AS is_serial \
             FROM information_schema.columns \
             WHERE table_schema = $1 AND table_name = $2 \
             ORDER BY ordinal_position",
        )
        .bind(schema)
        .bind(table)
        .fetch_all(pool)
        .await?;

        let pk_names = self.primary_key_columns(pool, schema, table).await?;

        let mut columns = Vec::new();
        for (i, row) in rows.iter().enumerate() {
            let name: String = row.try_get("column_name").unwrap_or_default();
            let data_type: String = row.try_get("data_type").unwrap_or_default();
            let max_len: Option<i32> = row.try_get("character_maximum_length").ok().flatten();
            let display_type = match (data_type.as_str(), max_len) {
                ("character varying", Some(n)) => format!("varchar({})", n),
                ("character", Some(n)) => format!("char({})", n),
                (t, _) => t.to_string(),
            };
            let nullable: String = row.try_get("is_nullable").unwrap_or_default();
            let default_value: Option<String> = row.try_get("column_default").ok().flatten();
            let is_serial: bool = row.try_get("is_serial").unwrap_or(false);

            columns.push(Column {
                name: name.clone(),
                ordinal_position: (i + 1) as u32,
                data_type: display_type,
                nullable: nullable == "YES",
                is_primary_key: pk_names.iter().any(|p| p == &name),
                is_auto_increment: is_serial,
                default_value,
                comment: None,
                max_length: max_len.map(|n| n as u32),
                extra: String::new(),
            });
        }
        Ok(columns)
    }

    async fn primary_key_columns(
        &self,
        pool: &PgPool,
        schema: &str,
        table: &str,
    ) -> Result<Vec<String>, AppError> {
        let rows = sqlx::query(
            "SELECT a.attname AS name \
             FROM pg_index ix \
             JOIN pg_class t ON t.oid = ix.indrelid \
             JOIN pg_namespace n ON n.oid = t.relnamespace \
             JOIN pg_attribute a ON a.attrelid = ix.indrelid AND a.attnum = ANY(ix.indkey) \
             WHERE ix.indisprimary AND n.nspname = $1 AND t.relname = $2 \
             ORDER BY a.attnum",
        )
        .bind(schema)
        .bind(table)
        .fetch_all(pool)
        .await?;
        Ok(rows
            .iter()
            .filter_map(|r| r.try_get::<String, _>("name").ok())
            .collect())
    }

    pub async fn fetch_indexes(
        &self,
        pool: &PgPool,
        schema: &str,
        table: &str,
    ) -> Result<Vec<Index>, AppError> {
        let rows = sqlx::query(
            "SELECT i.relname AS index_name, ix.indisunique AS is_unique, ix.indisprimary AS is_primary, \
                    am.amname AS index_type, \
                    array_agg(a.attname ORDER BY array_position(ix.indkey, a.attnum)) AS columns \
             FROM pg_class t \
             JOIN pg_namespace n ON n.oid = t.relnamespace \
             JOIN pg_index ix ON ix.indrelid = t.oid \
             JOIN pg_class i ON i.oid = ix.indexrelid \
             JOIN pg_am am ON am.oid = i.relam \
             JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY(ix.indkey) \
             WHERE n.nspname = $1 AND t.relname = $2 \
             GROUP BY i.relname, ix.indisunique, ix.indisprimary, am.amname \
             ORDER BY i.relname",
        )
        .bind(schema)
        .bind(table)
        .fetch_all(pool)
        .await?;

        Ok(rows
            .iter()
            .map(|row| Index {
                name: row.try_get("index_name").unwrap_or_default(),
                columns: row
                    .try_get::<Vec<String>, _>("columns")
                    .unwrap_or_default(),
                is_unique: row.try_get("is_unique").unwrap_or(false),
                is_primary: row.try_get("is_primary").unwrap_or(false),
                index_type: row.try_get("index_type").unwrap_or_default(),
            })
            .collect())
    }

    pub async fn fetch_foreign_keys(
        &self,
        pool: &PgPool,
        schema: &str,
        table: &str,
    ) -> Result<Vec<ForeignKey>, AppError> {
        let rows = sqlx::query(
            "SELECT tc.constraint_name, kcu.column_name, \
                    ccu.table_name AS referenced_table, ccu.column_name AS referenced_column, \
                    rc.update_rule, rc.delete_rule \
             FROM information_schema.table_constraints tc \
             JOIN information_schema.key_column_usage kcu \
                 ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema \
             JOIN information_schema.constraint_column_usage ccu \
                 ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema \
             JOIN information_schema.referential_constraints rc \
                 ON rc.constraint_name = tc.constraint_name AND rc.constraint_schema = tc.table_schema \
             WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = $1 AND tc.table_name = $2",
        )
        .bind(schema)
        .bind(table)
        .fetch_all(pool)
        .await?;

        Ok(rows
            .iter()
            .map(|row| ForeignKey {
                name: row.try_get("constraint_name").unwrap_or_default(),
                column: row.try_get("column_name").unwrap_or_default(),
                referenced_table: row.try_get("referenced_table").ok(),
                referenced_column: row.try_get("referenced_column").ok(),
                update_rule: row.try_get("update_rule").ok(),
                delete_rule: row.try_get("delete_rule").ok(),
            })
            .collect())
    }

    pub async fn fetch_triggers(
        &self,
        pool: &PgPool,
        schema: &str,
        table: &str,
    ) -> Result<Vec<Trigger>, AppError> {
        let rows = sqlx::query(
            "SELECT trigger_name, event_manipulation, action_timing, action_statement \
             FROM information_schema.triggers \
             WHERE trigger_schema = $1 AND event_object_table = $2",
        )
        .bind(schema)
        .bind(table)
        .fetch_all(pool)
        .await?;

        Ok(rows
            .iter()
            .map(|row| Trigger {
                name: row.try_get("trigger_name").unwrap_or_default(),
                event: row.try_get("event_manipulation").unwrap_or_default(),
                timing: row.try_get("action_timing").unwrap_or_default(),
                statement: row.try_get("action_statement").unwrap_or_default(),
            })
            .collect())
    }

    /// PostgreSQL has no built-in "show create table"; reconstruct a close
    /// approximation from the catalog.
    pub async fn fetch_create_table(
        &self,
        pool: &PgPool,
        schema: &str,
        table: &str,
    ) -> Result<String, AppError> {
        let columns = self.fetch_columns(pool, schema, table).await?;
        let mut lines: Vec<String> = columns
            .iter()
            .map(|c| {
                let mut line = format!("  {} {}", quote_ident(&c.name), c.data_type);
                if !c.nullable {
                    line.push_str(" NOT NULL");
                }
                if let Some(ref def) = c.default_value {
                    line.push_str(&format!(" DEFAULT {}", def));
                }
                line
            })
            .collect();
        let pk = self.primary_key_columns(pool, schema, table).await?;
        if !pk.is_empty() {
            lines.push(format!(
                "  PRIMARY KEY ({})",
                pk.iter().map(|n| quote_ident(n)).collect::<Vec<_>>().join(", ")
            ));
        }
        Ok(format!(
            "-- reconstructed from the catalog (PostgreSQL has no SHOW CREATE TABLE)\nCREATE TABLE {}.{} (\n{}\n);",
            quote_ident(schema),
            quote_ident(table),
            lines.join(",\n")
        ))
    }

    pub async fn fetch_table_details(
        &self,
        pool: &PgPool,
        schema: &str,
        table: &str,
    ) -> Result<TableDetails, AppError> {
        let columns = self.fetch_columns(pool, schema, table).await?;
        let indexes = self.fetch_indexes(pool, schema, table).await?;
        let foreign_keys = self.fetch_foreign_keys(pool, schema, table).await?;
        let triggers = self.fetch_triggers(pool, schema, table).await?;
        let create_table_sql = self.fetch_create_table(pool, schema, table).await?;
        Ok(TableDetails {
            columns,
            indexes,
            foreign_keys,
            triggers,
            create_table_sql,
        })
    }

    pub async fn fetch_completion_schema(
        &self,
        pool: &PgPool,
        schema: Option<&str>,
    ) -> Result<CompletionSchema, AppError> {
        let (sql, bound): (&str, Option<&str>) = match schema {
            Some(s) => (
                "SELECT table_schema, table_name, column_name \
                 FROM information_schema.columns \
                 WHERE table_schema = $1 \
                 ORDER BY table_schema, table_name, ordinal_position",
                Some(s),
            ),
            None => (
                "SELECT table_schema, table_name, column_name \
                 FROM information_schema.columns \
                 WHERE table_schema NOT IN ('pg_catalog', 'information_schema') \
                 ORDER BY table_schema, table_name, ordinal_position",
                None,
            ),
        };
        let query = sqlx::query(sql);
        let query = match bound {
            Some(s) => query.bind(s),
            None => query,
        };
        let rows = query.fetch_all(pool).await?;

        let mut out = CompletionSchema::new();
        for row in rows {
            let schema_name: String = row.try_get("table_schema").unwrap_or_default();
            let table_name: String = row.try_get("table_name").unwrap_or_default();
            let column_name: String = row.try_get("column_name").unwrap_or_default();
            out.entry(schema_name)
                .or_default()
                .entry(table_name)
                .or_default()
                .push(column_name);
        }
        Ok(out)
    }

    pub async fn search_schema(
        &self,
        pool: &PgPool,
        keyword: &str,
    ) -> Result<Vec<SearchResult>, AppError> {
        let pattern = format!(
            "%{}%",
            keyword.replace('\\', "\\\\").replace('%', "\\%").replace('_', "\\_")
        );
        let mut results = Vec::new();

        let table_rows = sqlx::query(
            "SELECT n.nspname AS schema_name, c.relname AS table_name \
             FROM pg_class c \
             JOIN pg_namespace n ON n.oid = c.relnamespace \
             WHERE c.relkind = 'r' AND n.nspname NOT LIKE 'pg\\_%' ESCAPE '\\' \
               AND n.nspname <> 'information_schema' \
               AND c.relname ILIKE $1 \
             LIMIT 100",
        )
        .bind(&pattern)
        .fetch_all(pool)
        .await?;
        for row in table_rows {
            results.push(SearchResult {
                database: row.try_get("schema_name").unwrap_or_default(),
                object_type: "table".to_string(),
                object_name: row.try_get("table_name").unwrap_or_default(),
                column_name: None,
            });
        }

        let column_rows = sqlx::query(
            "SELECT table_schema, table_name, column_name \
             FROM information_schema.columns \
             WHERE table_schema NOT IN ('pg_catalog', 'information_schema') \
               AND column_name ILIKE $1 \
             LIMIT 100",
        )
        .bind(&pattern)
        .fetch_all(pool)
        .await?;
        for row in column_rows {
            results.push(SearchResult {
                database: row.try_get("table_schema").unwrap_or_default(),
                object_type: "column".to_string(),
                object_name: row.try_get("table_name").unwrap_or_default(),
                column_name: row.try_get("column_name").ok(),
            });
        }
        Ok(results)
    }

    // ── Query execution ──

    /// Stream a SELECT; optionally pin the search_path to the tab's schema
    /// first (PostgreSQL's equivalent of the session `USE db`).
    pub async fn execute_query(
        &self,
        pool: &PgPool,
        sql: &str,
        limit: u32,
        schema: Option<&str>,
    ) -> Result<QueryResult, AppError> {
        use futures_util::stream::TryStreamExt;
        let start = Instant::now();

        let mut conn = pool
            .acquire()
            .await
            .map_err(|e| AppError::QueryFailed(e.to_string()))?;
        if let Some(schema) = schema {
            // set_config is preparable, unlike SET search_path TO $1.
            let _ = sqlx::query("SELECT set_config('search_path', $1, false)")
                .bind(schema)
                .execute(&mut *conn)
                .await;
        }

        let mut stream = sqlx::query(sql).fetch(&mut *conn);
        let mut rows: Vec<PgRow> = Vec::new();
        let mut total_count = 0u64;
        while let Some(row) = stream.try_next().await? {
            total_count += 1;
            if rows.len() < limit as usize {
                rows.push(row);
            }
        }
        let truncated = total_count > limit as u64;

        let columns = if let Some(first) = rows.first() {
            first
                .columns()
                .iter()
                .map(|col| crate::query::result::ColumnMeta {
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
                values.push(cell_to_json(&row, i));
            }
            result_rows.push(values);
        }

        Ok(QueryResult {
            columns,
            rows: result_rows,
            total_count,
            truncated,
            elapsed_ms: start.elapsed().as_millis() as u64,
        })
    }

    /// Text protocol (raw_sql) — simple query accepts every statement and
    /// trailing semicolons; PG's extended protocol has its own restrictions.
    pub async fn execute_update(
        &self,
        pool: &PgPool,
        sql: &str,
    ) -> Result<UpdateResult, AppError> {
        let start = Instant::now();
        let result = sqlx::raw_sql(sql)
            .execute(pool)
            .await
            .map_err(AppError::from)?;
        Ok(UpdateResult {
            rows_affected: result.rows_affected(),
            // PostgreSQL has no LAST_INSERT_ID concept.
            last_insert_id: None,
            elapsed_ms: start.elapsed().as_millis() as u64,
        })
    }
}

fn quote_ident(ident: &str) -> String {
    format!("\"{}\"", ident.replace('"', "\"\""))
}

/// Decode one PG cell into JSON. PG type names differ from MySQL's
/// (INT4/INT8/FLOAT8/BPCHAR/…), so this has its own mapping but the same
/// philosophy: exact types decode exactly, everything else degrades through
/// String → bytes instead of failing the query.
fn cell_to_json(row: &PgRow, i: usize) -> Value {
    if row.try_get_raw(i).map_or(true, |v| v.is_null()) {
        return Value::Null;
    }
    let type_name = row.column(i).type_info().name().to_uppercase();

    let try_num = || -> Option<Value> {
        if let Ok(v) = row.try_get_unchecked::<i64, _>(i) {
            return Some(Value::Number(v.into()));
        }
        if let Ok(v) = row.try_get_unchecked::<f64, _>(i) {
            return serde_json::Number::from_f64(v).map(Value::Number);
        }
        None
    };

    match type_name.as_str() {
        "BOOL" => {
            return row
                .try_get_unchecked::<bool, _>(i)
                .map(Value::Bool)
                .unwrap_or(Value::Null);
        }
        "INT2" | "INT4" | "INT8" => {
            return try_num().unwrap_or(Value::Null);
        }
        "FLOAT4" | "FLOAT8" => {
            return try_num().unwrap_or(Value::Null);
        }
        "NUMERIC" => {
            return row
                .try_get_unchecked::<bigdecimal::BigDecimal, _>(i)
                .map(|v| Value::String(v.to_string()))
                .unwrap_or(Value::Null);
        }
        "JSON" | "JSONB" => {
            return row
                .try_get_unchecked::<Value, _>(i)
                .unwrap_or(Value::Null);
        }
        "TIMESTAMP" => {
            return row
                .try_get_unchecked::<chrono::NaiveDateTime, _>(i)
                .map(|v| Value::String(v.to_string()))
                .unwrap_or(Value::Null);
        }
        "TIMESTAMPTZ" => {
            return row
                .try_get_unchecked::<chrono::DateTime<chrono::Utc>, _>(i)
                .map(|v| Value::String(v.to_string()))
                .unwrap_or(Value::Null);
        }
        "DATE" => {
            return row
                .try_get_unchecked::<chrono::NaiveDate, _>(i)
                .map(|v| Value::String(v.to_string()))
                .unwrap_or(Value::Null);
        }
        "TIME" => {
            return row
                .try_get_unchecked::<chrono::NaiveTime, _>(i)
                .map(|v| Value::String(v.to_string()))
                .unwrap_or(Value::Null);
        }
        "BYTEA" => {
            return row
                .try_get_unchecked::<Vec<u8>, _>(i)
                .map(|bytes| match std::str::from_utf8(&bytes) {
                    Ok(text) => Value::String(text.to_owned()),
                    Err(_) => Value::String(base64::Engine::encode(
                        &base64::engine::general_purpose::STANDARD,
                        bytes,
                    )),
                })
                .unwrap_or(Value::Null);
        }
        "UUID" => {
            if let Ok(bytes) = row.try_get_unchecked::<Vec<u8>, _>(i) {
                if bytes.len() == 16 {
                    let hex: Vec<String> = bytes.iter().map(|b| format!("{:02x}", b)).collect();
                    let s = hex.join("");
                    return Value::String(format!(
                        "{}-{}-{}-{}-{}",
                        &s[0..8],
                        &s[8..12],
                        &s[12..16],
                        &s[16..20],
                        &s[20..32]
                    ));
                }
            }
            return Value::Null;
        }
        _ => {}
    }

    if type_name.ends_with(']') {
        // Array columns: decode as text[] when possible, JSON otherwise.
        if let Ok(list) = row.try_get_unchecked::<Vec<String>, _>(i) {
            return Value::Array(list.into_iter().map(Value::String).collect());
        }
    }

    // Text family (TEXT/VARCHAR/BPCHAR/NAME/citext/…) and everything unknown.
    row.try_get_unchecked::<String, _>(i)
        .map(Value::String)
        .unwrap_or_else(|_| {
            row.try_get_unchecked::<Vec<u8>, _>(i)
                .map(|bytes| Value::String(String::from_utf8_lossy(&bytes).into_owned()))
                .unwrap_or(Value::Null)
        })
}

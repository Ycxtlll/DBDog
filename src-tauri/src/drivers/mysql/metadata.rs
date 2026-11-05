use super::decode;
use crate::connection::model::{ConnectionConfig, DatabaseType, SslMode};
use crate::drivers::{DatabaseDriver, DatabaseMetadata};
use crate::error::AppError;

use crate::schema::model::*;
use crate::utils::escape_mysql_identifier;
use async_trait::async_trait;
use sqlx::mysql::{MySqlConnectOptions, MySqlPool, MySqlPoolOptions};

pub struct MySqlDriver;

impl Default for MySqlDriver {
    fn default() -> Self {
        Self::new()
    }
}

impl MySqlDriver {
    pub fn new() -> Self {
        Self
    }

    fn build_options(config: &ConnectionConfig) -> Result<MySqlConnectOptions, AppError> {
        let mut opts = MySqlConnectOptions::new()
            .host(&config.host)
            .port(config.port)
            .username(&config.username);

        if let Some(ref password) = config.password {
            opts = opts.password(password);
        }

        if let Some(ref db) = config.database {
            opts = opts.database(db);
        }

        match config.ssl_mode.unwrap_or(SslMode::Disabled) {
            SslMode::Disabled => {
                opts = opts.ssl_mode(sqlx::mysql::MySqlSslMode::Disabled);
            }
            SslMode::Required => {
                opts = opts.ssl_mode(sqlx::mysql::MySqlSslMode::Required);
            }
            SslMode::VerifyCa => {
                opts = opts.ssl_mode(sqlx::mysql::MySqlSslMode::VerifyCa);
            }
            SslMode::VerifyFull => {
                opts = opts.ssl_mode(sqlx::mysql::MySqlSslMode::VerifyIdentity);
            }
        }

        if let Some(ref cert) = config.ssl_cert_path {
            opts = opts.ssl_ca(cert);
        }

        Ok(opts)
    }
}

#[async_trait]
impl DatabaseDriver for MySqlDriver {
    async fn test(&self, config: &ConnectionConfig) -> Result<String, AppError> {
        if config.db_type != DatabaseType::Mysql {
            return Err(AppError::DriverNotSupported(
                "Only MySQL is supported".to_string(),
            ));
        }
        let opts = Self::build_options(config)?;
        let pool = MySqlPoolOptions::new()
            .max_connections(1)
            .connect_with(opts)
            .await
            .map_err(|e| AppError::ConnectionFailed(e.to_string()))?;

        let row: (String,) = sqlx::query_as("SELECT VERSION()")
            .fetch_one(&pool)
            .await
            .map_err(|e| AppError::QueryFailed(e.to_string()))?;

        pool.close().await;
        Ok(row.0)
    }

    async fn connect(&self, config: &ConnectionConfig) -> Result<MySqlPool, AppError> {
        if config.db_type != DatabaseType::Mysql {
            return Err(AppError::DriverNotSupported(
                "Only MySQL is supported".to_string(),
            ));
        }
        let opts = Self::build_options(config)?;
        let max_conns = config.max_connections.unwrap_or(10);
        let pool = MySqlPoolOptions::new()
            .max_connections(max_conns)
            .connect_with(opts)
            .await
            .map_err(|e| AppError::ConnectionFailed(e.to_string()))?;
        Ok(pool)
    }

    async fn cancel_query(&self, pool: &MySqlPool, thread_id: u64) -> Result<(), AppError> {
        crate::query::cancel::cancel_query(pool, thread_id).await
    }
}

#[async_trait]
impl DatabaseMetadata for MySqlDriver {
    async fn fetch_databases(&self, pool: &MySqlPool) -> Result<Vec<Database>, AppError> {
        let rows = sqlx::query(
            r#"
            SELECT schema_name AS name, default_character_set_name AS charset,
                   default_collation_name AS collation
            FROM information_schema.schemata
            WHERE schema_name NOT IN ('information_schema', 'mysql', 'performance_schema', 'sys')
            ORDER BY schema_name
            "#,
        )
        .fetch_all(pool)
        .await?;

        let mut databases = Vec::new();
        for row in rows {
            databases.push(Database {
                name: decode::sql_string(&row, "name"),
                charset: decode::sql_opt_string(&row, "charset"),
                collation: decode::sql_opt_string(&row, "collation"),
            });
        }
        Ok(databases)
    }

    async fn fetch_tables(&self, pool: &MySqlPool, db: &str) -> Result<Vec<Table>, AppError> {
        let rows = sqlx::query(
            r#"
            SELECT table_name AS name, engine, table_rows AS row_count,
                   CAST(ROUND(data_length / 1024 / 1024, 2) AS CHAR) AS size_mb,
                   table_comment AS comment
            FROM information_schema.tables
            WHERE table_schema = ? AND table_type = 'BASE TABLE'
            ORDER BY table_name
            "#,
        )
        .bind(db)
        .fetch_all(pool)
        .await?;

        let mut tables = Vec::new();
        for row in rows {
            tables.push(Table {
                name: decode::sql_string(&row, "name"),
                engine: decode::sql_opt_string(&row, "engine"),
                // information_schema.tables.TABLE_ROWS is BIGINT UNSIGNED;
                // decoding it as i64 fails under sqlx strict typing and the
                // count silently drops to None.
                rows: decode::sql_opt_u64(&row, "row_count"),
                size_mb: decode::sql_opt_string(&row, "size_mb").and_then(|s| s.parse().ok()),
                comment: decode::sql_opt_string(&row, "comment"),
            });
        }
        Ok(tables)
    }

    async fn fetch_columns(
        &self,
        pool: &MySqlPool,
        db: &str,
        table: &str,
    ) -> Result<Vec<Column>, AppError> {
        let sql = format!(
            "SHOW FULL COLUMNS FROM {}.{}",
            escape_mysql_identifier(db),
            escape_mysql_identifier(table)
        );
        let rows = sqlx::query(&sql).fetch_all(pool).await?;

        let mut columns = Vec::new();
        for (i, row) in rows.iter().enumerate() {
            let key: String = decode::sql_string(row, "Key");
            let extra: String = decode::sql_string(row, "Extra");
            let data_type: String = decode::sql_string(row, "Type");

            // Extract max_length from type like "varchar(255)" or "char(10)"
            let max_length = parse_max_length(&data_type);

            columns.push(Column {
                name: decode::sql_string(row, "Field"),
                ordinal_position: (i + 1) as u32,
                data_type,
                nullable: decode::sql_string(row, "Null") == "YES",
                is_primary_key: key == "PRI",
                is_auto_increment: extra.contains("auto_increment"),
                default_value: decode::sql_opt_string(row, "Default"),
                comment: decode::sql_opt_string(row, "Comment"),
                max_length,
                extra,
            });
        }
        Ok(columns)
    }

    async fn fetch_indexes(
        &self,
        pool: &MySqlPool,
        db: &str,
        table: &str,
    ) -> Result<Vec<Index>, AppError> {
        let sql = format!(
            "SHOW INDEX FROM {}.{}",
            escape_mysql_identifier(db),
            escape_mysql_identifier(table)
        );
        let rows = sqlx::query(&sql).fetch_all(pool).await?;

        use std::collections::HashMap;
        let mut index_map: HashMap<String, (bool, bool, String, Vec<String>)> = HashMap::new();

        for row in rows {
            let name: String = decode::sql_string(&row, "Key_name");
            let column: String = decode::sql_string(&row, "Column_name");
            let non_unique: i64 = decode::sql_opt_u64(&row, "Non_unique")
                .map(|v| v as i64)
                .unwrap_or(1);
            let index_type: String = decode::sql_string(&row, "Index_type");
            let is_primary = name == "PRIMARY";

            index_map
                .entry(name)
                .and_modify(|(_, _, _, cols)| cols.push(column.clone()))
                .or_insert((non_unique == 0, is_primary, index_type, vec![column]));
        }

        let mut indexes = Vec::new();
        for (name, (is_unique, is_primary, index_type, columns)) in index_map {
            indexes.push(Index {
                name,
                columns,
                is_unique,
                is_primary,
                index_type,
            });
        }
        Ok(indexes)
    }

    async fn fetch_foreign_keys(
        &self,
        pool: &MySqlPool,
        db: &str,
        table: &str,
    ) -> Result<Vec<ForeignKey>, AppError> {
        let rows = sqlx::query(
            r#"
            SELECT kcu.constraint_name, kcu.column_name, kcu.referenced_table_name,
                   kcu.referenced_column_name, rc.update_rule, rc.delete_rule
            FROM information_schema.referential_constraints rc
            JOIN information_schema.key_column_usage kcu
                ON rc.constraint_name = kcu.constraint_name
                AND rc.constraint_schema = kcu.constraint_schema
            WHERE rc.constraint_schema = ? AND rc.table_name = ?
            "#,
        )
        .bind(db)
        .bind(table)
        .fetch_all(pool)
        .await?;

        let mut fks = Vec::new();
        for row in rows {
            fks.push(ForeignKey {
                name: decode::sql_string(&row, "constraint_name"),
                column: decode::sql_string(&row, "column_name"),
                referenced_table: decode::sql_opt_string(&row, "referenced_table_name"),
                referenced_column: decode::sql_opt_string(&row, "referenced_column_name"),
                update_rule: decode::sql_opt_string(&row, "update_rule"),
                delete_rule: decode::sql_opt_string(&row, "delete_rule"),
            });
        }
        Ok(fks)
    }

    async fn fetch_triggers(
        &self,
        pool: &MySqlPool,
        db: &str,
        table: &str,
    ) -> Result<Vec<Trigger>, AppError> {
        let rows = sqlx::query(
            r#"
            SELECT trigger_name, event_manipulation, action_timing, action_statement
            FROM information_schema.triggers
            WHERE event_object_schema = ? AND event_object_table = ?
            "#,
        )
        .bind(db)
        .bind(table)
        .fetch_all(pool)
        .await?;

        let mut triggers = Vec::new();
        for row in rows {
            triggers.push(Trigger {
                name: decode::sql_string(&row, "trigger_name"),
                event: decode::sql_string(&row, "event_manipulation"),
                timing: decode::sql_string(&row, "action_timing"),
                statement: decode::sql_string(&row, "action_statement"),
            });
        }
        Ok(triggers)
    }

    async fn fetch_create_table(
        &self,
        pool: &MySqlPool,
        db: &str,
        table: &str,
    ) -> Result<String, AppError> {
        let sql = format!(
            "SHOW CREATE TABLE {}.{}",
            escape_mysql_identifier(db),
            escape_mysql_identifier(table)
        );
        let row = sqlx::query(&sql).fetch_one(pool).await?;
        let create_sql: String = decode::string_at(&row, 1);
        Ok(create_sql)
    }

    async fn fetch_table_details(
        &self,
        pool: &MySqlPool,
        db: &str,
        table: &str,
    ) -> Result<TableDetails, AppError> {
        let columns = self.fetch_columns(pool, db, table).await?;
        let indexes = self.fetch_indexes(pool, db, table).await?;
        let foreign_keys = self.fetch_foreign_keys(pool, db, table).await?;
        let triggers = self.fetch_triggers(pool, db, table).await?;
        let create_table_sql = self.fetch_create_table(pool, db, table).await?;

        Ok(TableDetails {
            columns,
            indexes,
            foreign_keys,
            triggers,
            create_table_sql,
        })
    }

    async fn fetch_completion_schema(
        &self,
        pool: &MySqlPool,
        db: Option<&str>,
    ) -> Result<CompletionSchema, AppError> {
        // One information_schema pass over every column (views included —
        // completing them is useful too). Bound to a single database when
        // one is given, otherwise all user databases.
        let (sql, bound): (&str, Option<&str>) = match db {
            Some(d) => (
                "SELECT table_schema, table_name, column_name \
                 FROM information_schema.columns \
                 WHERE table_schema = ? \
                 ORDER BY table_schema, table_name, ordinal_position",
                Some(d),
            ),
            None => (
                "SELECT table_schema, table_name, column_name \
                 FROM information_schema.columns \
                 WHERE table_schema NOT IN ('information_schema','mysql','performance_schema','sys') \
                 ORDER BY table_schema, table_name, ordinal_position",
                None,
            ),
        };
        let query = sqlx::query(sql);
        let query = match bound {
            Some(d) => query.bind(d),
            None => query,
        };
        let rows = query.fetch_all(pool).await?;

        let mut schema = CompletionSchema::new();
        for row in rows {
            let schema_name: String = decode::sql_string(&row, "table_schema");
            let table_name: String = decode::sql_string(&row, "table_name");
            let column_name: String = decode::sql_string(&row, "column_name");
            schema
                .entry(schema_name)
                .or_default()
                .entry(table_name)
                .or_default()
                .push(column_name);
        }
        Ok(schema)
    }

    async fn search_schema(
        &self,
        pool: &MySqlPool,
        keyword: &str,
    ) -> Result<Vec<SearchResult>, AppError> {
        // Escape LIKE metacharacters so a user keyword containing % or _
        // matches literally instead of acting as a wildcard.
        let escaped_keyword = keyword
            .replace('\\', "\\\\")
            .replace('%', "\\%")
            .replace('_', "\\_");
        let pattern = format!("%{escaped_keyword}%");
        let mut results = Vec::new();

        let table_rows = sqlx::query(
            r#"
            SELECT table_schema, table_name
            FROM information_schema.tables
            WHERE table_schema NOT IN ('information_schema', 'mysql', 'performance_schema', 'sys')
              AND (table_name LIKE ? OR table_comment LIKE ?)
            LIMIT 100
            "#,
        )
        .bind(&pattern)
        .bind(&pattern)
        .fetch_all(pool)
        .await?;

        for row in table_rows {
            results.push(SearchResult {
                database: decode::sql_string(&row, "table_schema"),
                object_type: "table".to_string(),
                object_name: decode::sql_string(&row, "table_name"),
                column_name: None,
            });
        }

        let column_rows = sqlx::query(
            r#"
            SELECT table_schema, table_name, column_name
            FROM information_schema.columns
            WHERE table_schema NOT IN ('information_schema', 'mysql', 'performance_schema', 'sys')
              AND column_name LIKE ?
            LIMIT 100
            "#,
        )
        .bind(&pattern)
        .fetch_all(pool)
        .await?;

        for row in column_rows {
            results.push(SearchResult {
                database: decode::sql_string(&row, "table_schema"),
                object_type: "column".to_string(),
                object_name: decode::sql_string(&row, "table_name"),
                column_name: decode::sql_opt_string(&row, "column_name"),
            });
        }

        Ok(results)
    }
}

/// Extract character maximum length from a MySQL type string like "varchar(255)" or "char(10)".
/// Returns None for types without a length specification (e.g. "text", "int").
fn parse_max_length(data_type: &str) -> Option<u32> {
    let start = data_type.find('(')?;
    let end = data_type.find(')')?;
    if start < end {
        data_type[start + 1..end].parse().ok()
    } else {
        None
    }
}

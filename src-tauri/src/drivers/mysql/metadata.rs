use crate::connection::model::{ConnectionConfig, DatabaseType, SslMode};
use crate::drivers::{DatabaseDriver, DatabaseMetadata};
use crate::error::AppError;
use crate::query::result::{QueryResult, UpdateResult};
use crate::schema::model::*;
use async_trait::async_trait;
use sqlx::mysql::{MySqlConnectOptions, MySqlPool, MySqlPoolOptions};
use sqlx::Row;
// Note: FromStr and Instant imported for future use

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

    async fn execute_query(
        &self,
        pool: &MySqlPool,
        sql: &str,
        limit: u32,
    ) -> Result<QueryResult, AppError> {
        crate::query::engine::execute_query(pool, sql, limit).await
    }

    async fn execute_update(&self, pool: &MySqlPool, sql: &str) -> Result<UpdateResult, AppError> {
        crate::query::engine::execute_update(pool, sql).await
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
                name: row.try_get("name").unwrap_or_default(),
                charset: row.try_get("charset").ok(),
                collation: row.try_get("collation").ok(),
            });
        }
        Ok(databases)
    }

    async fn fetch_tables(&self, pool: &MySqlPool, db: &str) -> Result<Vec<Table>, AppError> {
        let rows = sqlx::query(
            r#"
            SELECT table_name AS name, engine, table_rows AS row_count,
                   ROUND(data_length / 1024 / 1024, 2) AS size_mb, table_comment AS comment
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
            let size_mb: Option<f64> = row
                .try_get::<Option<String>, _>("size_mb")
                .ok()
                .flatten()
                .and_then(|s| s.parse().ok());
            tables.push(Table {
                name: row.try_get("name").unwrap_or_default(),
                engine: row.try_get("engine").ok(),
                rows: row.try_get::<Option<i64>, _>("row_count").ok().flatten().map(|v| v as u64),
                size_mb,
                comment: row.try_get("comment").ok(),
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
        let rows = sqlx::query(
            r#"
            SELECT column_name, ordinal_position, data_type, is_nullable,
                   column_key, extra, column_default, column_comment, character_maximum_length
            FROM information_schema.columns
            WHERE table_schema = ? AND table_name = ?
            ORDER BY ordinal_position
            "#,
        )
        .bind(db)
        .bind(table)
        .fetch_all(pool)
        .await?;

        let mut columns = Vec::new();
        for row in rows {
            let col_key: String = row.try_get("column_key").unwrap_or_default();
            let extra: String = row.try_get("extra").unwrap_or_default();
            columns.push(Column {
                name: row.try_get("column_name").unwrap_or_default(),
                ordinal_position: row.try_get::<i64, _>("ordinal_position").unwrap_or(0) as u32,
                data_type: row.try_get("data_type").unwrap_or_default(),
                nullable: row.try_get::<String, _>("is_nullable").unwrap_or_default() == "YES",
                is_primary_key: col_key == "PRI",
                is_auto_increment: extra.contains("auto_increment"),
                default_value: row.try_get("column_default").ok(),
                comment: row.try_get("column_comment").ok(),
                max_length: row
                    .try_get::<i64, _>("character_maximum_length")
                    .ok()
                    .map(|v| v as u32),
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
        let rows = sqlx::query(
            r#"
            SELECT index_name, column_name, non_unique, index_type
            FROM information_schema.statistics
            WHERE table_schema = ? AND table_name = ?
            ORDER BY index_name, seq_in_index
            "#,
        )
        .bind(db)
        .bind(table)
        .fetch_all(pool)
        .await?;

        use std::collections::HashMap;
        let mut index_map: HashMap<String, (bool, bool, String, Vec<String>)> = HashMap::new();

        for row in rows {
            let name: String = row.try_get("index_name").unwrap_or_default();
            let column: String = row.try_get("column_name").unwrap_or_default();
            let non_unique: i64 = row.try_get("non_unique").unwrap_or(1);
            let index_type: String = row.try_get("index_type").unwrap_or_default();
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
                name: row.try_get("constraint_name").unwrap_or_default(),
                column: row.try_get("column_name").unwrap_or_default(),
                referenced_table: row.try_get("referenced_table_name").unwrap_or_default(),
                referenced_column: row.try_get("referenced_column_name").unwrap_or_default(),
                update_rule: row.try_get("update_rule").unwrap_or_default(),
                delete_rule: row.try_get("delete_rule").unwrap_or_default(),
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
                name: row.try_get("trigger_name").unwrap_or_default(),
                event: row.try_get("event_manipulation").unwrap_or_default(),
                timing: row.try_get("action_timing").unwrap_or_default(),
                statement: row.try_get("action_statement").unwrap_or_default(),
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
        let sql = format!("SHOW CREATE TABLE `{}`.`{}`", db, table);
        let row = sqlx::query(&sql).fetch_one(pool).await?;
        let create_sql: String = row.try_get(1).unwrap_or_default();
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

    async fn search_schema(
        &self,
        pool: &MySqlPool,
        keyword: &str,
    ) -> Result<Vec<SearchResult>, AppError> {
        let pattern = format!("%{}%", keyword);
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
                database: row.try_get("table_schema").unwrap_or_default(),
                object_type: "table".to_string(),
                object_name: row.try_get("table_name").unwrap_or_default(),
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
                database: row.try_get("table_schema").unwrap_or_default(),
                object_type: "column".to_string(),
                object_name: row.try_get("table_name").unwrap_or_default(),
                column_name: row.try_get("column_name").ok(),
            });
        }

        Ok(results)
    }
}

use async_trait::async_trait;
use sqlx::mysql::{MySqlConnectOptions, MySqlPoolOptions, MySqlRow};
use sqlx::{MySql, Row, Column};
use std::time::{Duration, Instant};
use std::collections::HashMap;

use crate::db::driver::*;
use crate::db::types::*;
use crate::error::{AppError, Result};

pub struct MysqlDriver;

#[async_trait]
impl DatabaseDriver for MysqlDriver {
    async fn server_version(&self, pool: &DatabasePool) -> Result<String> {
        let row = sqlx::query("SELECT VERSION() as v")
            .fetch_one(pool)
            .await?;
        Ok(row.try_get::<String, _>("v").unwrap_or_default())
    }

    async fn test_connection(&self, config: &ConnectionConfig) -> Result<()> {
        let pool = self.create_pool(config).await?;
        sqlx::query("SELECT 1").execute(&pool).await?;
        pool.close().await;
        Ok(())
    }

    async fn create_pool(&self, config: &ConnectionConfig) -> Result<DatabasePool> {
        let mut options = MySqlConnectOptions::new()
            .host(&config.host)
            .port(config.port)
            .username(&config.user)
            .password(&config.password);

        if let Some(ref db) = config.database {
            options = options.database(db);
        }

        let pool = MySqlPoolOptions::new()
            .max_connections(config.max_connections.unwrap_or(5))
            .min_connections(1)
            .acquire_timeout(Duration::from_secs(10))
            .idle_timeout(Duration::from_secs(600))
            .connect_lazy_with(options);

        Ok(pool)
    }

    async fn execute_query(
        &self,
        pool: &DatabasePool,
        sql: &str,
        limit: Option<u64>,
    ) -> Result<QueryResult> {
        let effective_limit = limit.unwrap_or(1000);
        let limited_sql = if sql.trim().to_uppercase().starts_with("SELECT")
            && !sql.to_uppercase().contains(" LIMIT ")
        {
            format!("{} LIMIT {}", sql.trim().trim_end_matches(';'), effective_limit)
        } else {
            sql.to_string()
        };

        let start = Instant::now();
        let rows = sqlx::query(&limited_sql).fetch_all(pool).await?;
        let execution_time_ms = start.elapsed().as_millis() as u64;

        if rows.is_empty() {
            return Ok(QueryResult {
                columns: Vec::new(),
                rows: Vec::new(),
                row_count: 0,
                truncated: false,
                execution_time_ms,
            });
        }

        let columns: Vec<ColumnInfo> = if let Some(first_row) = rows.first() {
            first_row
                .columns()
                .iter()
                .enumerate()
                .map(|(i, col)| ColumnInfo {
                    name: col.name().to_string(),
                    ordinal: i,
                    type_name: format!("{:?}", col.type_info()),
                    nullable: true,
                    is_primary_key: false,
                    auto_increment: false,
                    default_value: None,
                    comment: None,
                })
                .collect()
        } else {
            Vec::new()
        };

        let row_count = rows.len();
        let truncated = row_count >= effective_limit as usize;

        let result_rows: Vec<serde_json::Map<String, serde_json::Value>> = rows
            .iter()
            .map(|row| {
                let mut map = serde_json::Map::new();
                for col in &columns {
                    let val: Option<serde_json::Value> = row.try_get(col.name.as_str()).ok();
                    map.insert(
                        col.name.clone(),
                        val.unwrap_or(serde_json::Value::Null),
                    );
                }
                map
            })
            .collect();

        Ok(QueryResult {
            columns,
            rows: result_rows,
            row_count,
            truncated,
            execution_time_ms,
        })
    }

    async fn execute_update(&self, pool: &DatabasePool, sql: &str) -> Result<UpdateResult> {
        let start = Instant::now();
        let result = sqlx::query(sql).execute(pool).await?;
        let execution_time_ms = start.elapsed().as_millis() as u64;

        Ok(UpdateResult {
            rows_affected: result.rows_affected(),
            last_insert_id: Some(result.last_insert_id()),
            execution_time_ms,
        })
    }

    async fn cancel_query(&self, pool: &DatabasePool, connection_id: u64) -> Result<()> {
        sqlx::query(format!("KILL QUERY {}", connection_id).as_str())
            .execute(pool)
            .await?;
        Ok(())
    }
}

#[async_trait]
impl DatabaseMetadata for MysqlDriver {
    async fn list_databases(&self, pool: &DatabasePool) -> Result<Vec<String>> {
        let rows = sqlx::query("SHOW DATABASES").fetch_all(pool).await?;
        Ok(rows
            .iter()
            .filter_map(|r| r.try_get::<String, _>(0).ok())
            .filter(|s| !matches!(s.as_str(), "information_schema" | "performance_schema" | "mysql" | "sys"))
            .collect())
    }

    async fn list_tables(
        &self,
        pool: &DatabasePool,
        database: &str,
        filter: Option<&str>,
    ) -> Result<Vec<TableInfo>> {
        let sql = if let Some(f) = filter {
            format!(
                "SELECT TABLE_NAME, TABLE_TYPE, TABLE_ROWS, TABLE_COMMENT FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = '{}' AND TABLE_NAME LIKE '%{}%' ORDER BY TABLE_NAME",
                database, f
            )
        } else {
            format!(
                "SELECT TABLE_NAME, TABLE_TYPE, TABLE_ROWS, TABLE_COMMENT FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = '{}' ORDER BY TABLE_NAME",
                database
            )
        };

        let rows = sqlx::query(&sql).fetch_all(pool).await?;
        Ok(rows
            .iter()
            .map(|r| TableInfo {
                name: r.try_get::<String, _>(0).unwrap_or_default(),
                schema: database.to_string(),
                table_type: r.try_get::<String, _>(1).unwrap_or_else(|_| "BASE TABLE".to_string()),
                row_count: r.try_get::<i64, _>(2).ok().map(|v| v as u64),
                comment: r.try_get::<String, _>(3).ok(),
            })
            .collect())
    }

    async fn describe_table(
        &self,
        pool: &DatabasePool,
        database: &str,
        table: &str,
    ) -> Result<TableDetail> {
        let columns = self.get_columns(pool, database, table).await?;
        let indexes = self.get_indexes(pool, database, table).await?;
        let foreign_keys = self.get_foreign_keys(pool, database, table).await?;
        let create_sql = self.get_create_table_sql(pool, database, table).await?;

        let table_info = TableInfo {
            name: table.to_string(),
            schema: database.to_string(),
            table_type: "BASE TABLE".to_string(),
            row_count: None,
            comment: None,
        };

        Ok(TableDetail {
            table: table_info,
            columns,
            indexes,
            foreign_keys,
            create_sql,
        })
    }

    async fn get_create_table_sql(
        &self,
        pool: &DatabasePool,
        database: &str,
        table: &str,
    ) -> Result<String> {
        let sql = format!("SHOW CREATE TABLE `{}`.`{}`", database, table);
        let row = sqlx::query(&sql).fetch_one(pool).await?;
        Ok(row.try_get::<String, _>(1).unwrap_or_default())
    }

    async fn get_indexes(
        &self,
        pool: &DatabasePool,
        database: &str,
        table: &str,
    ) -> Result<Vec<IndexInfo>> {
        let sql = format!(
            "SHOW INDEX FROM `{}`.`{}`",
            database, table
        );
        let rows = sqlx::query(&sql).fetch_all(pool).await?;

        let mut index_map: HashMap<String, IndexInfo> = HashMap::new();
        for row in rows.iter() {
            let idx_name = row.try_get::<String, _>("Key_name").unwrap_or_default();
            let col_name = row.try_get::<String, _>("Column_name").unwrap_or_default();
            let is_unique = row.try_get::<i64, _>("Non_unique").unwrap_or(1) == 0;
            let idx_type = row.try_get::<String, _>("Index_type").unwrap_or_default();

            let is_primary = idx_name == "PRIMARY";

            index_map
                .entry(idx_name.clone())
                .or_insert_with(|| IndexInfo {
                    name: idx_name,
                    columns: Vec::new(),
                    is_unique,
                    is_primary,
                    index_type: idx_type,
                })
                .columns
                .push(col_name);
        }

        Ok(index_map.into_values().collect())
    }

    async fn get_foreign_keys(
        &self,
        pool: &DatabasePool,
        database: &str,
        table: &str,
    ) -> Result<Vec<ForeignKeyInfo>> {
        let sql = format!(
            "SELECT kcu.CONSTRAINT_NAME, kcu.COLUMN_NAME, kcu.REFERENCED_TABLE_NAME, kcu.REFERENCED_COLUMN_NAME, rc.DELETE_RULE, rc.UPDATE_RULE FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE kcu JOIN INFORMATION_SCHEMA.REFERENTIAL_CONSTRAINTS rc ON kcu.CONSTRAINT_NAME = rc.CONSTRAINT_NAME AND kcu.CONSTRAINT_SCHEMA = rc.CONSTRAINT_SCHEMA WHERE kcu.TABLE_SCHEMA = '{}' AND kcu.TABLE_NAME = '{}' AND kcu.REFERENCED_TABLE_NAME IS NOT NULL",
            database, table
        );
        let rows = sqlx::query(&sql).fetch_all(pool).await?;
        Ok(rows
            .iter()
            .map(|r| ForeignKeyInfo {
                name: r.try_get::<String, _>(0).unwrap_or_default(),
                column_name: r.try_get::<String, _>(1).unwrap_or_default(),
                referenced_table: r.try_get::<String, _>(2).unwrap_or_default(),
                referenced_column: r.try_get::<String, _>(3).unwrap_or_default(),
                on_delete: r.try_get::<String, _>(4).unwrap_or_else(|_| "RESTRICT".to_string()),
                on_update: r.try_get::<String, _>(5).unwrap_or_else(|_| "RESTRICT".to_string()),
            })
            .collect())
    }

    async fn get_triggers(
        &self,
        pool: &DatabasePool,
        database: &str,
        table: &str,
    ) -> Result<Vec<TriggerInfo>> {
        let sql = format!(
            "SELECT TRIGGER_NAME, EVENT_MANIPULATION, ACTION_TIMING, ACTION_STATEMENT FROM INFORMATION_SCHEMA.TRIGGERS WHERE TRIGGER_SCHEMA = '{}' AND EVENT_OBJECT_TABLE = '{}'",
            database, table
        );
        let rows = sqlx::query(&sql).fetch_all(pool).await?;
        Ok(rows
            .iter()
            .map(|r| TriggerInfo {
                name: r.try_get::<String, _>(0).unwrap_or_default(),
                event: r.try_get::<String, _>(1).unwrap_or_default(),
                timing: r.try_get::<String, _>(2).unwrap_or_default(),
                statement: r.try_get::<String, _>(3).unwrap_or_default(),
            })
            .collect())
    }

    async fn list_views(&self, pool: &DatabasePool, database: &str) -> Result<Vec<String>> {
        let sql = format!(
            "SELECT TABLE_NAME FROM INFORMATION_SCHEMA.VIEWS WHERE TABLE_SCHEMA = '{}' ORDER BY TABLE_NAME",
            database
        );
        let rows = sqlx::query(&sql).fetch_all(pool).await?;
        Ok(rows
            .iter()
            .filter_map(|r| r.try_get::<String, _>(0).ok())
            .collect())
    }

    async fn get_columns(
        &self,
        pool: &DatabasePool,
        database: &str,
        table: &str,
    ) -> Result<Vec<ColumnInfo>> {
        let sql = format!(
            "SELECT COLUMN_NAME, ORDINAL_POSITION, COLUMN_TYPE, IS_NULLABLE, COLUMN_KEY, EXTRA, COLUMN_DEFAULT, COLUMN_COMMENT FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = '{}' AND TABLE_NAME = '{}' ORDER BY ORDINAL_POSITION",
            database, table
        );
        let rows = sqlx::query(&sql).fetch_all(pool).await?;
        Ok(rows
            .iter()
            .map(|r| ColumnInfo {
                name: r.try_get::<String, _>(0).unwrap_or_default(),
                ordinal: r.try_get::<i64, _>(1).unwrap_or(0) as usize,
                type_name: r.try_get::<String, _>(2).unwrap_or_default(),
                nullable: r.try_get::<String, _>(3).unwrap_or_default() == "YES",
                is_primary_key: r.try_get::<String, _>(4).unwrap_or_default() == "PRI",
                auto_increment: r.try_get::<String, _>(5)
                    .unwrap_or_default()
                    .contains("auto_increment"),
                default_value: r.try_get::<String, _>(6).ok(),
                comment: r.try_get::<String, _>(7).ok(),
            })
            .collect())
    }

    async fn search_schema(
        &self,
        pool: &DatabasePool,
        query: &str,
    ) -> Result<Vec<SchemaSearchHit>> {
        let mut hits = Vec::new();
        let like_pattern = format!("%{}%", query);

        // Search databases
        let db_sql = "SELECT SCHEMA_NAME FROM INFORMATION_SCHEMA.SCHEMATA WHERE SCHEMA_NAME LIKE ? AND SCHEMA_NAME NOT IN ('information_schema', 'performance_schema', 'mysql', 'sys')";
        let db_rows = sqlx::query(db_sql)
            .bind(&like_pattern)
            .fetch_all(pool)
            .await?;
        for row in db_rows.iter() {
            if let Ok(db_name) = row.try_get::<String, _>(0) {
                hits.push(SchemaSearchHit {
                    database: db_name.clone(),
                    object_type: "database".to_string(),
                    object_name: db_name,
                    parent: None,
                    match_field: "name".to_string(),
                });
            }
        }

        // Search tables
        let table_sql = "SELECT TABLE_SCHEMA, TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME LIKE ? AND TABLE_SCHEMA NOT IN ('information_schema', 'performance_schema', 'mysql', 'sys')";
        let table_rows = sqlx::query(table_sql)
            .bind(&like_pattern)
            .fetch_all(pool)
            .await?;
        for row in table_rows.iter() {
            if let (Ok(db_name), Ok(table_name)) = (
                row.try_get::<String, _>(0),
                row.try_get::<String, _>(1),
            ) {
                hits.push(SchemaSearchHit {
                    database: db_name,
                    object_type: "table".to_string(),
                    object_name: table_name,
                    parent: None,
                    match_field: "name".to_string(),
                });
            }
        }

        // Search columns
        let col_sql = "SELECT TABLE_SCHEMA, TABLE_NAME, COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE COLUMN_NAME LIKE ? AND TABLE_SCHEMA NOT IN ('information_schema', 'performance_schema', 'mysql', 'sys')";
        let col_rows = sqlx::query(col_sql)
            .bind(&like_pattern)
            .fetch_all(pool)
            .await?;
        for row in col_rows.iter() {
            if let (Ok(db_name), Ok(table_name), Ok(col_name)) = (
                row.try_get::<String, _>(0),
                row.try_get::<String, _>(1),
                row.try_get::<String, _>(2),
            ) {
                hits.push(SchemaSearchHit {
                    database: db_name,
                    object_type: "column".to_string(),
                    object_name: col_name,
                    parent: Some(table_name),
                    match_field: "name".to_string(),
                });
            }
        }

        Ok(hits)
    }
}

#[async_trait]
impl DatabaseHealth for MysqlDriver {
    async fn get_process_list(&self, pool: &DatabasePool) -> Result<Vec<ProcessInfo>> {
        let rows = sqlx::query("SHOW FULL PROCESSLIST").fetch_all(pool).await?;
        Ok(rows
            .iter()
            .map(|r| ProcessInfo {
                id: r.try_get::<u64, _>(0).unwrap_or(0),
                user: r.try_get::<String, _>(1).unwrap_or_default(),
                host: r.try_get::<String, _>(2).unwrap_or_default(),
                db: r.try_get::<String, _>(3).ok(),
                command: r.try_get::<String, _>(4).unwrap_or_default(),
                time: r.try_get::<u64, _>(5).unwrap_or(0),
                state: r.try_get::<String, _>(6).ok(),
                info: r.try_get::<String, _>(7).ok(),
            })
            .collect())
    }

    async fn get_status_variables(&self, pool: &DatabasePool) -> Result<Vec<StatusVariable>> {
        let rows = sqlx::query("SHOW GLOBAL STATUS").fetch_all(pool).await?;
        Ok(rows
            .iter()
            .map(|r| StatusVariable {
                name: r.try_get::<String, _>(0).unwrap_or_default(),
                value: r.try_get::<String, _>(1).unwrap_or_default(),
            })
            .collect())
    }

    async fn get_system_variables(&self, pool: &DatabasePool) -> Result<Vec<SystemVariable>> {
        let rows = sqlx::query("SHOW GLOBAL VARIABLES").fetch_all(pool).await?;
        Ok(rows
            .iter()
            .map(|r| SystemVariable {
                name: r.try_get::<String, _>(0).unwrap_or_default(),
                value: r.try_get::<String, _>(1).unwrap_or_default(),
                is_global: true,
                is_session: true,
            })
            .collect())
    }

    async fn get_innodb_status(&self, pool: &DatabasePool) -> Result<InnodbStatus> {
        let row = sqlx::query("SHOW ENGINE INNODB STATUS")
            .fetch_one(pool)
            .await?;
        let raw_text = row.try_get::<String, _>(2).unwrap_or_default();
        Ok(InnodbStatus {
            raw_text: raw_text.clone(),
            active_transactions: None,
            lock_waits: None,
            buffer_pool_hits: None,
            buffer_pool_reads: None,
        })
    }

    async fn kill_process(&self, pool: &DatabasePool, process_id: u64) -> Result<()> {
        sqlx::query(format!("KILL {}", process_id).as_str())
            .execute(pool)
            .await?;
        Ok(())
    }
}

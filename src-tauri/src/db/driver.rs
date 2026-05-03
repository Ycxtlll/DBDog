use async_trait::async_trait;
use crate::db::types::*;
use crate::error::Result;
use sqlx::MySqlPool;

pub type DatabasePool = MySqlPool;

#[async_trait]
pub trait DatabaseDriver: Send + Sync + 'static {
    async fn server_version(&self, pool: &DatabasePool) -> Result<String>;
    async fn test_connection(&self, config: &ConnectionConfig) -> Result<()>;
    async fn create_pool(&self, config: &ConnectionConfig) -> Result<DatabasePool>;
    async fn execute_query(
        &self,
        pool: &DatabasePool,
        sql: &str,
        limit: Option<u64>,
    ) -> Result<QueryResult>;
    async fn execute_update(&self, pool: &DatabasePool, sql: &str) -> Result<UpdateResult>;
    async fn cancel_query(&self, pool: &DatabasePool) -> Result<()>;
}

#[async_trait]
pub trait DatabaseMetadata: Send + Sync + 'static {
    async fn list_databases(&self, pool: &DatabasePool) -> Result<Vec<String>>;
    async fn list_tables(
        &self,
        pool: &DatabasePool,
        database: &str,
        filter: Option<&str>,
    ) -> Result<Vec<TableInfo>>;
    async fn describe_table(
        &self,
        pool: &DatabasePool,
        database: &str,
        table: &str,
    ) -> Result<TableDetail>;
    async fn get_create_table_sql(
        &self,
        pool: &DatabasePool,
        database: &str,
        table: &str,
    ) -> Result<String>;
    async fn get_indexes(
        &self,
        pool: &DatabasePool,
        database: &str,
        table: &str,
    ) -> Result<Vec<IndexInfo>>;
    async fn get_foreign_keys(
        &self,
        pool: &DatabasePool,
        database: &str,
        table: &str,
    ) -> Result<Vec<ForeignKeyInfo>>;
    async fn get_triggers(
        &self,
        pool: &DatabasePool,
        database: &str,
        table: &str,
    ) -> Result<Vec<TriggerInfo>>;
    async fn list_views(&self, pool: &DatabasePool, database: &str) -> Result<Vec<String>>;
    async fn get_columns(
        &self,
        pool: &DatabasePool,
        database: &str,
        table: &str,
    ) -> Result<Vec<ColumnInfo>>;
    async fn search_schema(
        &self,
        pool: &DatabasePool,
        query: &str,
    ) -> Result<Vec<SchemaSearchHit>>;
    async fn capture_snapshot(
        &self,
        pool: &DatabasePool,
        database: &str,
    ) -> Result<DatabaseSnapshot>;
}

#[async_trait]
pub trait DatabaseHealth: Send + Sync + 'static {
    async fn get_process_list(&self, pool: &DatabasePool) -> Result<Vec<ProcessInfo>>;
    async fn get_status_variables(&self, pool: &DatabasePool) -> Result<Vec<StatusVariable>>;
    async fn get_system_variables(&self, pool: &DatabasePool) -> Result<Vec<SystemVariable>>;
    async fn get_innodb_status(&self, pool: &DatabasePool) -> Result<InnodbStatus>;
    async fn kill_process(&self, pool: &DatabasePool, process_id: u64) -> Result<()>;
}

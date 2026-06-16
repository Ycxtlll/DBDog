use crate::connection::model::ConnectionConfig;
use crate::error::AppError;

use crate::schema::model::*;
pub mod mysql;
pub mod memcached;

use async_trait::async_trait;
use sqlx::mysql::MySqlPool;

#[async_trait]
pub trait DatabaseDriver: Send + Sync {
    async fn test(&self, config: &ConnectionConfig) -> Result<String, AppError>;
    async fn connect(&self, config: &ConnectionConfig) -> Result<MySqlPool, AppError>;
    async fn cancel_query(&self, pool: &MySqlPool, thread_id: u64) -> Result<(), AppError>;
}

#[async_trait]
pub trait DatabaseMetadata: Send + Sync {
    async fn fetch_databases(&self, pool: &MySqlPool) -> Result<Vec<Database>, AppError>;
    async fn fetch_tables(&self, pool: &MySqlPool, db: &str) -> Result<Vec<Table>, AppError>;
    async fn fetch_columns(
        &self,
        pool: &MySqlPool,
        db: &str,
        table: &str,
    ) -> Result<Vec<Column>, AppError>;
    async fn fetch_indexes(
        &self,
        pool: &MySqlPool,
        db: &str,
        table: &str,
    ) -> Result<Vec<Index>, AppError>;
    async fn fetch_foreign_keys(
        &self,
        pool: &MySqlPool,
        db: &str,
        table: &str,
    ) -> Result<Vec<ForeignKey>, AppError>;
    async fn fetch_triggers(
        &self,
        pool: &MySqlPool,
        db: &str,
        table: &str,
    ) -> Result<Vec<Trigger>, AppError>;
    async fn fetch_create_table(
        &self,
        pool: &MySqlPool,
        db: &str,
        table: &str,
    ) -> Result<String, AppError>;
    async fn fetch_table_details(
        &self,
        pool: &MySqlPool,
        db: &str,
        table: &str,
    ) -> Result<TableDetails, AppError>;
    async fn search_schema(
        &self,
        pool: &MySqlPool,
        keyword: &str,
    ) -> Result<Vec<SearchResult>, AppError>;
}

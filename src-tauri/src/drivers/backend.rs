//! Uniform dispatch over the SQL backends (MySQL / PostgreSQL). Commands
//! resolve a connection ID to a `SqlBackend` and call methods on it —
//! which driver sits underneath is not their business.

use crate::connection::model::DatabaseType;
use crate::drivers::mysql::metadata::MySqlDriver;
use crate::drivers::postgres::PgDriver;
use crate::drivers::DatabaseMetadata;
use crate::error::AppError;
use crate::schema::model::*;
use crate::state::AppState;
use sqlx::mysql::MySqlPool;
use sqlx::postgres::PgPool;
use uuid::Uuid;

pub enum SqlBackend {
    MySql(MySqlPool),
    Postgres(PgPool),
}

/// Load the connection config and hand back its live pool, typed.
pub async fn resolve(state: &AppState, connection_id: Uuid) -> Result<SqlBackend, AppError> {
    let config = state.get_config(&connection_id).await?;
    match config.db_type {
        DatabaseType::Mysql => state
            .pool_manager
            .get(&connection_id)
            .map(SqlBackend::MySql)
            .ok_or_else(|| AppError::ConnectionNotFound(connection_id.to_string())),
        DatabaseType::Postgresql => state
            .pg_pool_manager
            .get(&connection_id)
            .map(SqlBackend::Postgres)
            .ok_or_else(|| AppError::ConnectionNotFound(connection_id.to_string())),
        DatabaseType::Memcached | DatabaseType::Zookeeper => Err(AppError::DriverNotSupported(
            "not a SQL connection".to_string(),
        )),
    }
}

impl SqlBackend {
    pub async fn fetch_databases(&self) -> Result<Vec<Database>, AppError> {
        match self {
            SqlBackend::MySql(p) => MySqlDriver::new().fetch_databases(p).await,
            SqlBackend::Postgres(p) => PgDriver::new().fetch_databases(p).await,
        }
    }

    pub async fn fetch_tables(&self, db: &str) -> Result<Vec<Table>, AppError> {
        match self {
            SqlBackend::MySql(p) => MySqlDriver::new().fetch_tables(p, db).await,
            SqlBackend::Postgres(p) => PgDriver::new().fetch_tables(p, db).await,
        }
    }

    pub async fn fetch_table_details(&self, db: &str, table: &str) -> Result<TableDetails, AppError> {
        match self {
            SqlBackend::MySql(p) => MySqlDriver::new().fetch_table_details(p, db, table).await,
            SqlBackend::Postgres(p) => PgDriver::new().fetch_table_details(p, db, table).await,
        }
    }

    pub async fn search_schema(&self, keyword: &str) -> Result<Vec<SearchResult>, AppError> {
        match self {
            SqlBackend::MySql(p) => MySqlDriver::new().search_schema(p, keyword).await,
            SqlBackend::Postgres(p) => PgDriver::new().search_schema(p, keyword).await,
        }
    }

    pub async fn fetch_completion_schema(
        &self,
        db: Option<&str>,
    ) -> Result<CompletionSchema, AppError> {
        match self {
            SqlBackend::MySql(p) => MySqlDriver::new().fetch_completion_schema(p, db).await,
            SqlBackend::Postgres(p) => PgDriver::new().fetch_completion_schema(p, db).await,
        }
    }
}

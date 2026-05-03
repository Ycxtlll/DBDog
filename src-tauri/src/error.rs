use serde::Serialize;

#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("Database error: {0}")]
    Database(String),

    #[error("Connection error: {0}")]
    Connection(String),

    #[error("Configuration error: {0}")]
    Config(String),

    #[error("Cache error: {0}")]
    Cache(String),

    #[error("Keychain error: {0}")]
    Keychain(String),

    #[error("Not found: {0}")]
    NotFound(String),

    #[error("Query cancelled")]
    #[allow(dead_code)]
    Cancelled,
}

impl Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

impl From<sqlx::Error> for AppError {
    fn from(e: sqlx::Error) -> Self {
        let msg = match &e {
            sqlx::Error::PoolTimedOut => "Connection timed out. The database server may be unreachable or overloaded.".to_string(),
            sqlx::Error::PoolClosed => "Connection pool is closed. Please reconnect.".to_string(),
            sqlx::Error::RowNotFound => "No rows returned.".to_string(),
            sqlx::Error::Database(db_err) => {
                let code = db_err.code().map(|c| c.to_string()).unwrap_or_default();
                match code.as_str() {
                    "1045" => "Access denied: wrong username or password.".to_string(),
                    "1049" => "Unknown database.".to_string(),
                    "2003" | "2005" => "Cannot connect to database server. Check host and port.".to_string(),
                    "1205" => "Lock wait timeout exceeded. Another transaction may be holding the lock.".to_string(),
                    _ => format!("Database error ({}): {}", code, db_err.message()),
                }
            }
            _ => e.to_string(),
        };
        AppError::Database(msg)
    }
}

impl From<serde_json::Error> for AppError {
    fn from(e: serde_json::Error) -> Self {
        AppError::Cache(e.to_string())
    }
}

impl From<std::io::Error> for AppError {
    fn from(e: std::io::Error) -> Self {
        AppError::Cache(e.to_string())
    }
}

impl From<rusqlite::Error> for AppError {
    fn from(e: rusqlite::Error) -> Self {
        AppError::Cache(e.to_string())
    }
}

pub type Result<T> = std::result::Result<T, AppError>;

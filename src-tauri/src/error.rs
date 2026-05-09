use serde::Serialize;
use thiserror::Error;

#[derive(Debug, Error, Serialize, Clone)]
#[serde(tag = "code", content = "message")]
#[allow(dead_code)]
pub enum AppError {
    #[error("数据库连接失败: {0}")]
    ConnectionFailed(String),
    #[error("SQL 执行错误: {0}")]
    QueryFailed(String),
    #[error("查询已取消")]
    QueryCancelled,
    #[error("Schema 缓存未命中")]
    SchemaCacheMiss,
    #[error("密钥链操作失败: {0}")]
    KeyringError(String),
    #[error("配置读写失败: {0}")]
    ConfigError(String),
    #[error("无效的 SQL 类型: {0}")]
    InvalidSqlType(String),
    #[error("连接未找到: {0}")]
    ConnectionNotFound(String),
    #[error("驱动不支持: {0}")]
    DriverNotSupported(String),
    #[error("未知错误: {0}")]
    Unknown(String),
}

impl From<sqlx::Error> for AppError {
    fn from(err: sqlx::Error) -> Self {
        AppError::QueryFailed(err.to_string())
    }
}

impl From<serde_json::Error> for AppError {
    fn from(err: serde_json::Error) -> Self {
        AppError::ConfigError(err.to_string())
    }
}

impl From<std::io::Error> for AppError {
    fn from(err: std::io::Error) -> Self {
        AppError::ConfigError(err.to_string())
    }
}

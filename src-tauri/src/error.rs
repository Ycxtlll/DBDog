use serde::Serialize;
use thiserror::Error;

#[derive(Debug, Error, Serialize, Clone)]
#[serde(tag = "code", content = "message")]
pub enum AppError {
    #[error("数据库连接失败: {0}")]
    ConnectionFailed(String),
    #[error("SQL 执行错误: {0}")]
    QueryFailed(String),
    #[error("配置读写失败: {0}")]
    ConfigError(String),
    #[error("连接未找到: {0}")]
    ConnectionNotFound(String),
    #[error("驱动不支持: {0}")]
    DriverNotSupported(String),

    #[error("键未找到: {0}")]
    KeyNotFound(String),
    #[error("Memcached 协议错误: {0}")]
    MemcachedProtocolError(String),
    #[error("ZooKeeper 操作失败: {0}")]
    ZookeeperError(String),
    #[error("需要密码")]
    PasswordRequired,
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

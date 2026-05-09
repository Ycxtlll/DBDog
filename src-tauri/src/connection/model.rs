use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConnectionConfig {
    pub id: Uuid,
    pub name: String,
    #[serde(rename = "type")]
    pub db_type: DatabaseType,
    pub host: String,
    pub port: u16,
    pub username: String,
    #[serde(skip_serializing)]
    pub password: Option<String>,
    pub database: Option<String>,
    pub max_connections: Option<u32>,
    pub ssl_mode: Option<SslMode>,
    pub ssl_cert_path: Option<String>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum DatabaseType {
    Mysql,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub enum SslMode {
    Disabled,
    Required,
    VerifyCa,
    VerifyFull,
}

#[derive(Debug, Clone, Serialize)]
pub struct ServerInfo {
    pub version: String,
    pub connection_id: String,
}

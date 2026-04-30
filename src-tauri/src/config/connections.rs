use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::RwLock;

use crate::db::types::{ConnectionConfig, ConnectionSummary};
use crate::error::{AppError, Result};

const KEYRING_SERVICE: &str = "DBDog";

pub struct ConnectionManager {
    configs: RwLock<Vec<ConnectionConfig>>,
    config_path: PathBuf,
}

impl ConnectionManager {
    pub fn new(app_data_dir: PathBuf) -> Result<Self> {
        let config_path = app_data_dir.join("connections.json");
        let configs = if config_path.exists() {
            let content = std::fs::read_to_string(&config_path).map_err(|e| {
                AppError::Config(format!("Failed to read connections: {}", e))
            })?;
            serde_json::from_str(&content).unwrap_or_default()
        } else {
            Vec::new()
        };

        Ok(Self {
            configs: RwLock::new(configs),
            config_path,
        })
    }

    pub async fn list(&self) -> Vec<ConnectionSummary> {
        let configs = self.configs.read().await;
        configs.iter().map(|c| ConnectionSummary::from(c)).collect()
    }

    pub async fn get(&self, id: &str) -> Option<ConnectionConfig> {
        let configs = self.configs.read().await;
        configs.iter().find(|c| c.id == id).cloned()
    }

    pub async fn save(&self, config: ConnectionConfig) -> Result<String> {
        // Store password in OS keychain
        if !config.password.is_empty() {
            let entry = keyring::Entry::new(KEYRING_SERVICE, &config.id)
                .map_err(|e| AppError::Keychain(e.to_string()))?;
            entry
                .set_password(&config.password)
                .map_err(|e| AppError::Keychain(e.to_string()))?;
        }

        let id = config.id.clone();
        let mut configs = self.configs.write().await;

        if let Some(existing) = configs.iter_mut().find(|c| c.id == config.id) {
            // Update existing - don't overwrite password with empty if keychain had one
            let password = if config.password.is_empty() {
                std::mem::take(&mut existing.password)
            } else {
                config.password.clone()
            };
            *existing = config;
            existing.password = password;
        } else {
            configs.push(config);
        }

        self.persist(&configs).await?;
        Ok(id)
    }

    pub async fn delete(&self, id: &str) -> Result<()> {
        let mut configs = self.configs.write().await;
        configs.retain(|c| c.id != id);

        // Remove from keychain
        if let Ok(entry) = keyring::Entry::new(KEYRING_SERVICE, id) {
            let _ = entry.delete_credential();
        }

        self.persist(&configs).await?;
        Ok(())
    }

    pub async fn load_password(&self, id: &str) -> Result<String> {
        let entry = keyring::Entry::new(KEYRING_SERVICE, id)
            .map_err(|e| AppError::Keychain(e.to_string()))?;
        entry
            .get_password()
            .map_err(|e| AppError::Keychain(e.to_string()))
    }

    async fn persist(&self, configs: &[ConnectionConfig]) -> Result<()> {
        // Serialize without passwords
        let serializable: Vec<serde_json::Value> = configs
            .iter()
            .map(|c| {
                let mut val = serde_json::to_value(c).unwrap();
                if let Some(obj) = val.as_object_mut() {
                    obj.remove("password");
                }
                val
            })
            .collect();

        let content = serde_json::to_string_pretty(&serializable)
            .map_err(|e| AppError::Config(e.to_string()))?;

        if let Some(parent) = self.config_path.parent() {
            tokio::fs::create_dir_all(parent).await.map_err(|e| {
                AppError::Config(format!("Failed to create config dir: {}", e))
            })?;
        }

        tokio::fs::write(&self.config_path, content)
            .await
            .map_err(|e| AppError::Config(format!("Failed to write connections: {}", e)))
    }
}

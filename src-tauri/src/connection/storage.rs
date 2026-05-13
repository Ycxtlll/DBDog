use super::model::ConnectionConfig;
use crate::error::AppError;
use std::path::PathBuf;
use tauri::Manager;
use tracing::{error, warn};

pub struct ConnectionStorage {
    app_handle: tauri::AppHandle,
}

impl ConnectionStorage {
    pub fn new(app_handle: tauri::AppHandle) -> Self {
        Self { app_handle }
    }

    fn config_path(&self) -> Result<PathBuf, AppError> {
        let path = self
            .app_handle
            .path()
            .app_data_dir()
            .map_err(|e| AppError::ConfigError(e.to_string()))?
            .join("connections.json");
        Ok(path)
    }

    pub async fn load_all(&self) -> Result<Vec<ConnectionConfig>, AppError> {
        let path = self.config_path()?;
        if !path.exists() {
            return Ok(vec![]);
        }
        let content = tokio::fs::read_to_string(&path)
            .await
            .map_err(|e| AppError::ConfigError(e.to_string()))?;
        let mut configs: Vec<ConnectionConfig> =
            serde_json::from_str(&content).map_err(|e| AppError::ConfigError(e.to_string()))?;

        for config in &mut configs {
            match keyring::Entry::new("dbdog", &config.id.to_string())
                .and_then(|e| e.get_password())
            {
                Ok(password) if !password.is_empty() => {
                    config.password = Some(password);
                }
                Ok(_) => {
                    config.password = None;
                }
                Err(e) => {
                    warn!("Failed to load password from keyring for {}: {}", config.id, e);
                    config.password = None;
                }
            }
        }

        Ok(configs)
    }

    pub async fn save(&self, config: &ConnectionConfig) -> Result<(), AppError> {
        let mut configs = self.load_all().await?;
        let pos = configs.iter().position(|c| c.id == config.id);
        if let Some(idx) = pos {
            configs[idx] = config.clone();
        } else {
            configs.push(config.clone());
        }

        if let Some(ref password) = config.password {
            if !password.is_empty() {
                match keyring::Entry::new("dbdog", &config.id.to_string())
                    .and_then(|e| e.set_password(password))
                {
                    Ok(()) => {}
                    Err(e) => {
                        error!("Failed to save password to keyring for {}: {}", config.id, e);
                        return Err(AppError::ConfigError(format!(
                            "Failed to save password to system keyring: {}. \
                             Please ensure your system credential manager is available.",
                            e
                        )));
                    }
                }
            }
        }

        let mut to_save = configs.clone();
        for c in &mut to_save {
            c.password = None;
        }

        let path = self.config_path()?;
        if let Some(parent) = path.parent() {
            tokio::fs::create_dir_all(parent)
                .await
                .map_err(|e| AppError::ConfigError(e.to_string()))?;
        }
        let content = serde_json::to_string_pretty(&to_save)
            .map_err(|e| AppError::ConfigError(e.to_string()))?;
        tokio::fs::write(&path, content)
            .await
            .map_err(|e| AppError::ConfigError(e.to_string()))?;

        Ok(())
    }

    pub async fn delete(&self, id: uuid::Uuid) -> Result<(), AppError> {
        let mut configs = self.load_all().await?;
        configs.retain(|c| c.id != id);

        let _ = keyring::Entry::new("dbdog", &id.to_string()).and_then(|e| e.delete_credential());

        let mut to_save = configs.clone();
        for c in &mut to_save {
            c.password = None;
        }

        let path = self.config_path()?;
        let content = serde_json::to_string_pretty(&to_save)
            .map_err(|e| AppError::ConfigError(e.to_string()))?;
        tokio::fs::write(&path, content)
            .await
            .map_err(|e| AppError::ConfigError(e.to_string()))?;

        Ok(())
    }
}

use super::model::ConnectionConfig;
use crate::error::AppError;
use std::path::PathBuf;
use tauri::Manager;
use tracing::warn;

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
            // Try keyring first
            match keyring::Entry::new("dbdog", &config.id.to_string())
                .and_then(|e| e.get_password())
            {
                Ok(password) if !password.is_empty() => {
                    config.password = Some(password);
                }
                Ok(_) => {
                    config.password = None;
                }
                Err(_) => {
                    // Fall back to encrypted field in config
                    if let Some(ref encrypted) = config.password_hash {
                        if !encrypted.is_empty() {
                            config.password = Some(xor_decrypt(encrypted, &config.id.to_string()));
                        }
                    }
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

        // Persist password: try keyring, fall back to XOR-encrypted in config
        if let Some(ref password) = config.password {
            if !password.is_empty() {
                let mut stored = false;
                match keyring::Entry::new("dbdog", &config.id.to_string())
                    .and_then(|e| e.set_password(password))
                {
                    Ok(()) => stored = true,
                    Err(e) => {
                        warn!(
                            "Keyring unavailable for {}: {}. Falling back to config storage.",
                            config.id, e
                        );
                    }
                }
                // Fallback: XOR-encrypt into password_hash field
                if !stored {
                    let pos2 = configs.iter().position(|c| c.id == config.id);
                    if let Some(idx) = pos2 {
                        configs[idx].password_hash =
                            Some(xor_encrypt(password, &config.id.to_string()));
                    }
                } else {
                    // Clear any previous fallback
                    let pos2 = configs.iter().position(|c| c.id == config.id);
                    if let Some(idx) = pos2 {
                        configs[idx].password_hash = None;
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

        let _ = keyring::Entry::new("dbdog", &id.to_string())
            .and_then(|e| e.delete_credential());

        let mut to_save = configs.clone();
        for c in &mut to_save {
            c.password = None;
            c.password_hash = None;
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

/// Simple XOR "encryption" — NOT cryptographically secure.
/// Protects against casual inspection of the config file only.
/// XOR + hex encode for config file storage.
fn xor_encrypt(input: &str, key: &str) -> String {
    let key_bytes = key.as_bytes();
    if key_bytes.is_empty() {
        return input.to_string();
    }
    let result: Vec<u8> = input
        .as_bytes()
        .iter()
        .enumerate()
        .map(|(i, b)| b ^ key_bytes[i % key_bytes.len()])
        .collect();
    result.iter().map(|b| format!("{b:02x}")).collect::<String>()
}

fn xor_decrypt(hex_input: &str, key: &str) -> String {
    let key_bytes = key.as_bytes();
    if key_bytes.is_empty() {
        return hex_input.to_string();
    }
    // Hex decode
    let bytes: Vec<u8> = hex_input
        .as_bytes()
        .chunks(2)
        .filter_map(|chunk| {
            if chunk.len() == 2 {
                let hi = hex_val(chunk[0])?;
                let lo = hex_val(chunk[1])?;
                Some(hi << 4 | lo)
            } else {
                None
            }
        })
        .collect();
    let result: Vec<u8> = bytes
        .iter()
        .enumerate()
        .map(|(i, b)| b ^ key_bytes[i % key_bytes.len()])
        .collect();
    String::from_utf8_lossy(&result).into_owned()
}

fn hex_val(b: u8) -> Option<u8> {
    match b {
        b'0'..=b'9' => Some(b - b'0'),
        b'A'..=b'F' => Some(b - b'A' + 10),
        b'a'..=b'f' => Some(b - b'a' + 10),
        _ => None,
    }
}

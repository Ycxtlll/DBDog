use super::crypto;
use super::model::ConnectionConfig;
use crate::error::AppError;
use std::path::PathBuf;
use tauri::Manager;

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
            if let Some(ref encrypted) = config.password_hash {
                if !encrypted.is_empty() {
                    config.password =
                        Some(crypto::decrypt_secret(
                            "dbdog",
                            &config.id.to_string(),
                            encrypted,
                        )?);
                }
            }
        }

        Ok(configs)
    }

    pub async fn save(&self, config: &ConnectionConfig) -> Result<(), AppError> {
        let mut configs = self.load_all().await?;
        let existing_hash = configs
            .iter()
            .find(|c| c.id == config.id)
            .and_then(|c| c.password_hash.clone());
        let pos = configs.iter().position(|c| c.id == config.id);
        if let Some(idx) = pos {
            // Password semantics:
            //   Some(non-empty) → replace the stored credential
            //   Some("")        → explicitly clear the stored credential
            //   None            → keep the previously stored credential
            let mut merged = config.clone();
            merged.password_hash = existing_hash;
            merged.password = None;
            match config.password.as_deref() {
                Some(p) if !p.is_empty() => {
                    let encrypted =
                        crypto::encrypt_secret("dbdog", &config.id.to_string(), p)?;
                    merged.password_hash = Some(encrypted);
                }
                Some(_) => {
                    merged.password_hash = None;
                    #[cfg(not(target_os = "windows"))]
                    {
                        let _ = ::keyring::Entry::new("dbdog", &config.id.to_string())
                            .and_then(|e| e.delete_credential());
                    }
                }
                None => {}
            }
            configs[idx] = merged;
        } else {
            let mut new_config = config.clone();
            new_config.password_hash = None;
            if let Some(p) = config.password.as_deref() {
                if !p.is_empty() {
                    new_config.password_hash =
                        Some(crypto::encrypt_secret("dbdog", &config.id.to_string(), p)?);
                }
            }
            new_config.password = None;
            configs.push(new_config);
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


        #[cfg(not(target_os = "windows"))]
        {
            let _ = ::keyring::Entry::new("dbdog", &id.to_string())
                .and_then(|e| e.delete_credential());
        }
        let mut to_save = configs.clone();
        for c in &mut to_save {
            // Only the in-memory plaintext must be stripped; password_hash is
            // the persisted credential for surviving connections and must stay.
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


#[cfg(test)]
mod tests {
    use super::*;
    use uuid::Uuid;

    #[test]
    fn crypto_roundtrip_through_password_hash() {
        // Simulate the save → load flow
        let id = Uuid::new_v4();
        let password = "my_db_password";

        // Save step: encrypt
        let encrypted = crypto::encrypt_secret("dbdog", &id.to_string(), password)
            .expect("encrypt should work on this platform");
        assert!(!encrypted.is_empty());

        // Load step: decrypt
        let decrypted = crypto::decrypt_secret("dbdog", &id.to_string(), &encrypted)
            .expect("decrypt should work");
        assert_eq!(decrypted, password);
    }

    #[test]
    fn different_ids_produce_independent_encryption() {
        let id_a = Uuid::new_v4();
        let id_b = Uuid::new_v4();

        let enc_a = crypto::encrypt_secret("dbdog", &id_a.to_string(), "pwd").unwrap();
        let enc_b = crypto::encrypt_secret("dbdog", &id_b.to_string(), "pwd").unwrap();

        // Both should decrypt correctly with their own keys
        let dec_a = crypto::decrypt_secret("dbdog", &id_a.to_string(), &enc_a).unwrap();
        let dec_b = crypto::decrypt_secret("dbdog", &id_b.to_string(), &enc_b).unwrap();
        assert_eq!(dec_a, "pwd");
        assert_eq!(dec_b, "pwd");
    }
}

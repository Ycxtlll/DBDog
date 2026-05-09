use crate::error::AppError;
use serde_json::Value;
use std::path::PathBuf;
use uuid::Uuid;

#[allow(dead_code)]
pub struct DiskCache {
    base_path: PathBuf,
}

impl DiskCache {
    pub fn new(base_path: PathBuf) -> Self {
        Self { base_path }
    }

    fn path_for(&self, conn_id: Uuid, db: &str, obj_type: &str, obj_name: &str) -> PathBuf {
        self.base_path
            .join(conn_id.to_string())
            .join(format!("{}_{}_{}.json", db, obj_type, obj_name))
    }

    pub async fn read(
        &self,
        conn_id: Uuid,
        db: &str,
        obj_type: &str,
        obj_name: &str,
    ) -> Option<Value> {
        let path = self.path_for(conn_id, db, obj_type, obj_name);
        if !path.exists() {
            return None;
        }
        let content = tokio::fs::read_to_string(&path).await.ok()?;
        serde_json::from_str(&content).ok()
    }

    pub async fn write(
        &self,
        conn_id: Uuid,
        db: &str,
        obj_type: &str,
        obj_name: &str,
        value: &Value,
    ) -> Result<(), AppError> {
        let path = self.path_for(conn_id, db, obj_type, obj_name);
        if let Some(parent) = path.parent() {
            tokio::fs::create_dir_all(parent)
                .await
                .map_err(|e| AppError::ConfigError(e.to_string()))?;
        }
        let content = serde_json::to_string_pretty(value)
            .map_err(|e| AppError::ConfigError(e.to_string()))?;
        tokio::fs::write(&path, content)
            .await
            .map_err(|e| AppError::ConfigError(e.to_string()))?;
        Ok(())
    }

    pub async fn remove_all(&self, conn_id: &Uuid) -> Result<(), AppError> {
        let path = self.base_path.join(conn_id.to_string());
        if path.exists() {
            tokio::fs::remove_dir_all(&path)
                .await
                .map_err(|e| AppError::ConfigError(e.to_string()))?;
        }
        Ok(())
    }
}

//! Per-connection persistence for imported lists and user adjudications.
//! One JSON file per connection: app_data_dir/relationships/<id>.json.

use super::model::{RelationshipStoreData, StoredRelationship};
use crate::error::AppError;
use std::path::PathBuf;
use tauri::Manager;
use uuid::Uuid;

pub struct RelationshipStore {
    app_handle: tauri::AppHandle,
}

impl RelationshipStore {
    pub fn new(app_handle: tauri::AppHandle) -> Self {
        Self { app_handle }
    }

    fn path(&self, connection_id: Uuid) -> Result<PathBuf, AppError> {
        Ok(self
            .app_handle
            .path()
            .app_data_dir()
            .map_err(|e| AppError::ConfigError(e.to_string()))?
            .join("relationships")
            .join(format!("{connection_id}.json")))
    }

    /// Load stored data; missing file = empty store (first run).
    pub async fn load(&self, connection_id: Uuid) -> Result<RelationshipStoreData, AppError> {
        let path = self.path(connection_id)?;
        if !path.exists() {
            return Ok(RelationshipStoreData::default());
        }
        let content = tokio::fs::read_to_string(&path)
            .await
            .map_err(|e| AppError::ConfigError(e.to_string()))?;
        serde_json::from_str(&content).map_err(|e| AppError::ConfigError(e.to_string()))
    }

    async fn save(
        &self,
        connection_id: Uuid,
        data: &RelationshipStoreData,
    ) -> Result<(), AppError> {
        let path = self.path(connection_id)?;
        if let Some(parent) = path.parent() {
            tokio::fs::create_dir_all(parent)
                .await
                .map_err(|e| AppError::ConfigError(e.to_string()))?;
        }
        let content = serde_json::to_string_pretty(data)
            .map_err(|e| AppError::ConfigError(e.to_string()))?;
        tokio::fs::write(&path, content)
            .await
            .map_err(|e| AppError::ConfigError(e.to_string()))
    }

    /// Merge imported entries into `confirmed`, deduped case-insensitively.
    /// Returns how many new entries were added.
    pub async fn import(
        &self,
        connection_id: Uuid,
        entries: Vec<StoredRelationship>,
    ) -> Result<usize, AppError> {
        let mut data = self.load(connection_id).await?;
        let mut added = 0usize;
        for entry in entries {
            let exists = data.confirmed.iter().any(|c| c.same_link(&entry));
            if !exists {
                data.confirmed.push(entry);
                added += 1;
            }
        }
        if added > 0 {
            self.save(connection_id, &data).await?;
        }
        Ok(added)
    }

    /// Record a user verdict. `confirm` upserts into `confirmed` (retarget =
    /// confirm with a different parent); `veto` removes any confirmed twin
    /// and records the veto so inference never suggests it again.
    pub async fn adjudicate(
        &self,
        connection_id: Uuid,
        link: StoredRelationship,
        confirm: bool,
    ) -> Result<(), AppError> {
        let mut data = self.load(connection_id).await?;
        data.vetoed.retain(|v| !v.same_link(&link));
        data.confirmed.retain(|c| !c.same_link(&link));
        if confirm {
            data.confirmed.push(link);
        } else {
            data.vetoed.push(link);
        }
        self.save(connection_id, &data).await
    }
}

use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::Mutex;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QueryHistoryEntry {
    pub id: i64,
    pub connection_id: String,
    pub connection_name: String,
    pub database_name: Option<String>,
    pub sql: String,
    pub duration_ms: Option<i64>,
    pub row_count: Option<i64>,
    pub success: bool,
    pub error_message: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Bookmark {
    pub id: i64,
    pub name: String,
    pub folder: Option<String>,
    pub tags: Option<Vec<String>>,
    pub sql: String,
    pub placeholders: Option<Vec<String>>,
    pub created_at: String,
    pub updated_at: String,
}

pub struct LocalDb {
    conn: Arc<Mutex<Connection>>,
}

impl LocalDb {
    pub fn new(path: PathBuf) -> Result<Self, rusqlite::Error> {
        let conn = Connection::open(path)?;
        Self::run_migrations(&conn)?;
        Ok(Self {
            conn: Arc::new(Mutex::new(conn)),
        })
    }

    fn run_migrations(conn: &Connection) -> Result<(), rusqlite::Error> {
        conn.execute_batch(include_str!("../../migrations/001_init.sql"))?;
        Ok(())
    }

    pub async fn insert_history(
        &self,
        entry: &QueryHistoryEntry,
    ) -> Result<i64, rusqlite::Error> {
        let conn = self.conn.lock().await;
        conn.execute(
            "INSERT INTO query_history (connection_id, connection_name, database_name, sql, duration_ms, row_count, success, error_message, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            params![
                entry.connection_id,
                entry.connection_name,
                entry.database_name,
                entry.sql,
                entry.duration_ms,
                entry.row_count,
                entry.success as i32,
                entry.error_message,
                entry.created_at,
            ],
        )?;
        Ok(conn.last_insert_rowid())
    }

    pub async fn get_history(
        &self,
        connection_id: Option<&str>,
        limit: Option<i64>,
        offset: Option<i64>,
    ) -> Result<Vec<QueryHistoryEntry>, rusqlite::Error> {
        let conn = self.conn.lock().await;
        let limit_val = limit.unwrap_or(100);
        let offset_val = offset.unwrap_or(0);

        if let Some(cid) = connection_id {
            let mut stmt = conn.prepare(
                "SELECT id, connection_id, connection_name, database_name, sql, duration_ms, row_count, success, error_message, created_at FROM query_history WHERE connection_id = ?1 ORDER BY created_at DESC LIMIT ?2 OFFSET ?3"
            )?;
            let entries = stmt.query_map(params![cid, limit_val, offset_val], |row| {
                Ok(QueryHistoryEntry {
                    id: row.get(0)?,
                    connection_id: row.get(1)?,
                    connection_name: row.get(2)?,
                    database_name: row.get(3)?,
                    sql: row.get(4)?,
                    duration_ms: row.get(5)?,
                    row_count: row.get(6)?,
                    success: row.get::<_, i32>(7)? != 0,
                    error_message: row.get(8)?,
                    created_at: row.get(9)?,
                })
            })?;

            let mut result = Vec::new();
            for entry in entries {
                result.push(entry?);
            }
            Ok(result)
        } else {
            let mut stmt = conn.prepare(
                "SELECT id, connection_id, connection_name, database_name, sql, duration_ms, row_count, success, error_message, created_at FROM query_history ORDER BY created_at DESC LIMIT ?1 OFFSET ?2"
            )?;
            let entries = stmt.query_map(params![limit_val, offset_val], |row| {
                Ok(QueryHistoryEntry {
                    id: row.get(0)?,
                    connection_id: row.get(1)?,
                    connection_name: row.get(2)?,
                    database_name: row.get(3)?,
                    sql: row.get(4)?,
                    duration_ms: row.get(5)?,
                    row_count: row.get(6)?,
                    success: row.get::<_, i32>(7)? != 0,
                    error_message: row.get(8)?,
                    created_at: row.get(9)?,
                })
            })?;

            let mut result = Vec::new();
            for entry in entries {
                result.push(entry?);
            }
            Ok(result)
        }
    }

    pub async fn search_history(
        &self,
        query: &str,
        limit: Option<i64>,
    ) -> Result<Vec<QueryHistoryEntry>, rusqlite::Error> {
        let conn = self.conn.lock().await;
        let pattern = format!("%{}%", query);
        let mut stmt = conn.prepare(
            "SELECT id, connection_id, connection_name, database_name, sql, duration_ms, row_count, success, error_message, created_at FROM query_history WHERE sql LIKE ?1 OR connection_name LIKE ?1 ORDER BY created_at DESC LIMIT ?2"
        )?;
        let entries = stmt.query_map(params![pattern, limit.unwrap_or(50)], |row| {
            Ok(QueryHistoryEntry {
                id: row.get(0)?,
                connection_id: row.get(1)?,
                connection_name: row.get(2)?,
                database_name: row.get(3)?,
                sql: row.get(4)?,
                duration_ms: row.get(5)?,
                row_count: row.get(6)?,
                success: row.get::<_, i32>(7)? != 0,
                error_message: row.get(8)?,
                created_at: row.get(9)?,
            })
        })?;

        let mut result = Vec::new();
        for entry in entries {
            result.push(entry?);
        }
        Ok(result)
    }

    pub async fn insert_bookmark(&self, bookmark: &Bookmark) -> Result<i64, rusqlite::Error> {
        let conn = self.conn.lock().await;
        let tags_json = bookmark.tags.as_ref().and_then(|t| serde_json::to_string(t).ok());
        let placeholders_json = bookmark.placeholders.as_ref().and_then(|p| serde_json::to_string(p).ok());

        conn.execute(
            "INSERT INTO bookmarks (name, folder, tags, sql, placeholders, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![
                bookmark.name,
                bookmark.folder,
                tags_json,
                bookmark.sql,
                placeholders_json,
                bookmark.created_at,
                bookmark.updated_at,
            ],
        )?;
        Ok(conn.last_insert_rowid())
    }

    pub async fn update_bookmark(&self, bookmark: &Bookmark) -> Result<(), rusqlite::Error> {
        let conn = self.conn.lock().await;
        let tags_json = bookmark.tags.as_ref().and_then(|t| serde_json::to_string(t).ok());
        let placeholders_json = bookmark.placeholders.as_ref().and_then(|p| serde_json::to_string(p).ok());

        conn.execute(
            "UPDATE bookmarks SET name = ?1, folder = ?2, tags = ?3, sql = ?4, placeholders = ?5, updated_at = ?6 WHERE id = ?7",
            params![
                bookmark.name,
                bookmark.folder,
                tags_json,
                bookmark.sql,
                placeholders_json,
                bookmark.updated_at,
                bookmark.id,
            ],
        )?;
        Ok(())
    }

    pub async fn get_bookmarks(&self, folder: Option<&str>) -> Result<Vec<Bookmark>, rusqlite::Error> {
        let conn = self.conn.lock().await;

        if let Some(f) = folder {
            let mut stmt = conn.prepare(
                "SELECT id, name, folder, tags, sql, placeholders, created_at, updated_at FROM bookmarks WHERE folder = ?1 ORDER BY name"
            )?;
            let bookmarks = stmt.query_map(params![f], |row| {
                let tags_str: Option<String> = row.get(3)?;
                let placeholders_str: Option<String> = row.get(5)?;

                Ok(Bookmark {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    folder: row.get(2)?,
                    tags: tags_str.and_then(|s| serde_json::from_str(&s).ok()),
                    sql: row.get(4)?,
                    placeholders: placeholders_str.and_then(|s| serde_json::from_str(&s).ok()),
                    created_at: row.get(6)?,
                    updated_at: row.get(7)?,
                })
            })?;

            let mut result = Vec::new();
            for bookmark in bookmarks {
                result.push(bookmark?);
            }
            Ok(result)
        } else {
            let mut stmt = conn.prepare(
                "SELECT id, name, folder, tags, sql, placeholders, created_at, updated_at FROM bookmarks ORDER BY folder, name"
            )?;
            let bookmarks = stmt.query_map([], |row| {
                let tags_str: Option<String> = row.get(3)?;
                let placeholders_str: Option<String> = row.get(5)?;

                Ok(Bookmark {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    folder: row.get(2)?,
                    tags: tags_str.and_then(|s| serde_json::from_str(&s).ok()),
                    sql: row.get(4)?,
                    placeholders: placeholders_str.and_then(|s| serde_json::from_str(&s).ok()),
                    created_at: row.get(6)?,
                    updated_at: row.get(7)?,
                })
            })?;

            let mut result = Vec::new();
            for bookmark in bookmarks {
                result.push(bookmark?);
            }
            Ok(result)
        }
    }

    pub async fn delete_bookmark(&self, id: i64) -> Result<(), rusqlite::Error> {
        let conn = self.conn.lock().await;
        conn.execute("DELETE FROM bookmarks WHERE id = ?1", params![id])?;
        Ok(())
    }

    pub async fn get_folders(&self) -> Result<Vec<String>, rusqlite::Error> {
        let conn = self.conn.lock().await;
        let mut stmt = conn.prepare("SELECT DISTINCT folder FROM bookmarks WHERE folder IS NOT NULL ORDER BY folder")?;
        let folders = stmt.query_map([], |row| row.get(0))?;

        let mut result = Vec::new();
        for folder in folders {
            result.push(folder?);
        }
        Ok(result)
    }
}

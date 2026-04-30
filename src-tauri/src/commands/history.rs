use tauri::State;

use crate::db::local::{Bookmark, QueryHistoryEntry};
use crate::error::Result;
use crate::state::AppState;

#[tauri::command]
pub async fn add_history_entry(
    entry: QueryHistoryEntry,
    state: State<'_, AppState>,
) -> Result<i64> {
    let id = state.local_db.insert_history(&entry).await?;
    Ok(id)
}

#[tauri::command]
pub async fn get_history(
    connection_id: Option<String>,
    limit: Option<i64>,
    offset: Option<i64>,
    state: State<'_, AppState>,
) -> Result<Vec<QueryHistoryEntry>> {
    let entries = state
        .local_db
        .get_history(connection_id.as_deref(), limit, offset)
        .await?;
    Ok(entries)
}

#[tauri::command]
pub async fn search_history(
    query: String,
    limit: Option<i64>,
    state: State<'_, AppState>,
) -> Result<Vec<QueryHistoryEntry>> {
    let entries = state.local_db.search_history(&query, limit).await?;
    Ok(entries)
}

#[tauri::command]
pub async fn create_bookmark(
    mut bookmark: Bookmark,
    state: State<'_, AppState>,
) -> Result<i64> {
    let now = chrono::Utc::now().to_rfc3339();
    bookmark.created_at = now.clone();
    bookmark.updated_at = now;
    let id = state.local_db.insert_bookmark(&bookmark).await?;
    Ok(id)
}

#[tauri::command]
pub async fn update_bookmark(
    mut bookmark: Bookmark,
    state: State<'_, AppState>,
) -> Result<()> {
    bookmark.updated_at = chrono::Utc::now().to_rfc3339();
    state.local_db.update_bookmark(&bookmark).await?;
    Ok(())
}

#[tauri::command]
pub async fn get_bookmarks(
    folder: Option<String>,
    state: State<'_, AppState>,
) -> Result<Vec<Bookmark>> {
    let bookmarks = state.local_db.get_bookmarks(folder.as_deref()).await?;
    Ok(bookmarks)
}

#[tauri::command]
pub async fn delete_bookmark(id: i64, state: State<'_, AppState>) -> Result<()> {
    state.local_db.delete_bookmark(id).await?;
    Ok(())
}

#[tauri::command]
pub async fn get_bookmark_folders(state: State<'_, AppState>) -> Result<Vec<String>> {
    let folders = state.local_db.get_folders().await?;
    Ok(folders)
}

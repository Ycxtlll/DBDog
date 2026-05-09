use crate::error::AppError;
use sqlx::mysql::MySqlPool;

pub async fn cancel_query(pool: &MySqlPool, target_thread_id: u64) -> Result<(), AppError> {
    let kill_sql = format!("KILL QUERY {}", target_thread_id);
    sqlx::query(&kill_sql)
        .execute(pool)
        .await
        .map_err(|e| AppError::QueryFailed(format!("KILL QUERY failed: {}", e)))?;
    Ok(())
}

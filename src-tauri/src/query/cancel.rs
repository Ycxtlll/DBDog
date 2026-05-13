use crate::error::AppError;
use crate::utils::validate_thread_id;
use sqlx::mysql::MySqlPool;

pub async fn cancel_query(pool: &MySqlPool, target_thread_id: u64) -> Result<(), AppError> {
    let validated_id = validate_thread_id(target_thread_id)
        .map_err(|e| AppError::QueryFailed(e))?;
    // SAFETY: KILL QUERY does not support prepared statement placeholders.
    // The thread ID is validated to be a non-zero u64 above, ensuring
    // it can only contain numeric digits.
    let kill_sql = format!("KILL QUERY {}", validated_id);
    sqlx::query(&kill_sql)
        .execute(pool)
        .await
        .map_err(|e| AppError::QueryFailed(format!("KILL QUERY failed: {}", e)))?;
    Ok(())
}

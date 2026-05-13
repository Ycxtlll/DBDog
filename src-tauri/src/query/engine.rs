use super::result::{ColumnMeta, QueryResult, UpdateResult};
use crate::error::AppError;
use futures_util::stream::TryStreamExt;
use serde_json::Value;
use sqlx::mysql::MySqlConnection;
use sqlx::Column;
use sqlx::Row;
use sqlx::TypeInfo;
use sqlx::ValueRef;
use std::time::Instant;

pub async fn execute_query(
    conn: &mut MySqlConnection,
    sql: &str,
    limit: u32,
) -> Result<QueryResult, AppError> {
    let start = Instant::now();

    let mut stream = sqlx::query(sql).fetch(&mut *conn);
    let mut rows: Vec<sqlx::mysql::MySqlRow> = Vec::new();
    let mut total_count = 0u64;

    while let Some(row) = stream.try_next().await? {
        total_count += 1;
        if rows.len() < limit as usize {
            rows.push(row);
        }
    }

    let truncated = total_count > limit as u64;

    let columns = if let Some(first_row) = rows.first() {
        first_row
            .columns()
            .iter()
            .map(|col| ColumnMeta {
                name: col.name().to_string(),
                data_type: col.type_info().name().to_string(),
                nullable: true,
            })
            .collect()
    } else {
        vec![]
    };

    let mut result_rows = Vec::new();
    for row in rows.into_iter().take(limit as usize) {
        let mut values = Vec::new();
        for i in 0..row.columns().len() {
            let val = decode_cell(&row, i)?;
            values.push(val);
        }
        result_rows.push(values);
    }

    let elapsed_ms = start.elapsed().as_millis() as u64;

    Ok(QueryResult {
        columns,
        rows: result_rows,
        total_count,
        truncated,
        elapsed_ms,
    })
}

/// Decode a single MySQL cell into `serde_json::Value` using sqlx's official type mappings.
///
/// We use `try_get_unchecked` to bypass sqlx's `Type::compatible()` check, which is
/// overly strict for dynamic queries (flag mismatches on BINARY/UNSIGNED), but we still
/// leverage sqlx's built-in `Decode` implementations rather than hand-rolling string parsing.
fn decode_cell(row: &sqlx::mysql::MySqlRow, i: usize) -> Result<Value, AppError> {
    if row.try_get_raw(i).map_or(true, |v| v.is_null()) {
        return Ok(Value::Null);
    }

    let type_name = row.column(i).type_info().name().to_uppercase();
    Ok(decode_by_type(row, i, &type_name))
}

fn decode_by_type<'r>(row: &'r sqlx::mysql::MySqlRow, i: usize, type_name: &str) -> Value {
    if type_name.starts_with("TINYINT") {
        return decode_integer::<i8, u8>(row, i, type_name, |v| Value::Number(v.into()), |v| {
            Value::Number(v.into())
        });
    }
    if type_name.starts_with("SMALLINT") {
        return decode_integer::<i16, u16>(row, i, type_name, |v| Value::Number(v.into()), |v| {
            Value::Number(v.into())
        });
    }
    if type_name.starts_with("MEDIUMINT")
        || type_name.starts_with("INT")
        || type_name.starts_with("INTEGER")
    {
        return decode_integer::<i32, u32>(row, i, type_name, |v| Value::Number(v.into()), |v| {
            Value::Number(v.into())
        });
    }
    if type_name.starts_with("BIGINT") {
        return decode_integer::<i64, u64>(row, i, type_name, |v| Value::Number(v.into()), |v| {
            Value::Number(v.into())
        });
    }
    if type_name.starts_with("FLOAT") {
        return decode_or_fallback::<f32>(row, i, |v| {
            serde_json::Number::from_f64(f64::from(v))
                .map(Value::Number)
                .unwrap_or_else(|| Value::String(v.to_string()))
        });
    }
    if type_name.starts_with("DOUBLE") || type_name.starts_with("REAL") {
        return decode_or_fallback::<f64>(row, i, |v| {
            serde_json::Number::from_f64(v)
                .map(Value::Number)
                .unwrap_or_else(|| Value::String(v.to_string()))
        });
    }
    if type_name.starts_with("DECIMAL") || type_name.starts_with("NUMERIC") {
        return decode_or_fallback::<bigdecimal::BigDecimal>(row, i, |v| {
            Value::String(v.to_string())
        });
    }
    if type_name.starts_with("BIT") {
        return decode_bit(row, i);
    }
    if type_name.starts_with("JSON") {
        return decode_or_fallback::<serde_json::Value>(row, i, |v| v);
    }
    if type_name == "DATE" {
        return decode_or_fallback::<chrono::NaiveDate>(row, i, |v| {
            Value::String(v.to_string())
        });
    }
    if type_name == "DATETIME" || type_name == "TIMESTAMP" {
        return decode_or_fallback::<chrono::NaiveDateTime>(row, i, |v| {
            Value::String(v.to_string())
        });
    }
    if type_name == "TIME" {
        return decode_or_fallback::<chrono::NaiveTime>(row, i, |v| {
            Value::String(v.to_string())
        });
    }
    if type_name == "YEAR" {
        return decode_or_fallback::<i16>(row, i, |v| Value::Number(v.into()));
    }
    if type_name.starts_with("BINARY")
        || type_name.starts_with("VARBINARY")
        || type_name.contains("BLOB")
    {
        return decode_or_fallback::<Vec<u8>>(row, i, |v| {
            Value::String(base64::Engine::encode(
                &base64::engine::general_purpose::STANDARD,
                v,
            ))
        });
    }
    // VARCHAR, CHAR, TEXT, ENUM, SET, GEOMETRY, etc.
    fallback_string(row, i)
}

fn decode_or_fallback<'r, T>(
    row: &'r sqlx::mysql::MySqlRow,
    i: usize,
    convert: impl FnOnce(T) -> Value,
) -> Value
where
    T: sqlx::Decode<'r, sqlx::MySql> + sqlx::Type<sqlx::MySql>,
{
    row.try_get_unchecked::<T, _>(i)
        .map(convert)
        .unwrap_or_else(|_| fallback_string(row, i))
}

fn decode_integer<'r, S, U>(
    row: &'r sqlx::mysql::MySqlRow,
    i: usize,
    type_name: &str,
    signed: impl FnOnce(S) -> Value,
    unsigned: impl FnOnce(U) -> Value,
) -> Value
where
    S: sqlx::Decode<'r, sqlx::MySql> + sqlx::Type<sqlx::MySql>,
    U: sqlx::Decode<'r, sqlx::MySql> + sqlx::Type<sqlx::MySql>,
{
    if type_name.contains("UNSIGNED") {
        decode_or_fallback(row, i, unsigned)
    } else {
        decode_or_fallback(row, i, signed)
    }
}

fn decode_bit(row: &sqlx::mysql::MySqlRow, i: usize) -> Value {
    decode_or_fallback::<Vec<u8>>(row, i, |bytes| {
        if bytes.is_empty() {
            Value::Null
        } else if bytes.len() == 1 {
            match bytes[0] {
                0 => Value::Bool(false),
                1 => Value::Bool(true),
                n => Value::Number(n.into()),
            }
        } else {
            let mut val: u64 = 0;
            for b in bytes {
                val = (val << 8) | u64::from(b);
            }
            Value::Number(val.into())
        }
    })
}

fn fallback_string(row: &sqlx::mysql::MySqlRow, i: usize) -> Value {
    row.try_get_unchecked::<String, _>(i)
        .map(Value::String)
        .unwrap_or(Value::Null)
}

pub async fn execute_update(
    conn: &mut MySqlConnection,
    sql: &str,
) -> Result<UpdateResult, AppError> {
    let start = Instant::now();
    let result = sqlx::query(sql).execute(&mut *conn).await?;
    let elapsed_ms = start.elapsed().as_millis() as u64;

    Ok(UpdateResult {
        rows_affected: result.rows_affected(),
        last_insert_id: Some(result.last_insert_id()),
        elapsed_ms,
    })
}

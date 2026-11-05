//! MySQL value interpretation — the single module that knows how MySQL
//! reports values over the wire and how a cell maps to Rust scalars, JSON
//! or CSV text.
//!
//! Layers, by consumer:
//! - catalog scalar readers (`sql_string`, `sql_opt_u64`, …) for
//!   information_schema / SHOW rows → `metadata.rs`
//! - `cell_to_json` for user-data cells → query grid (`query/engine.rs`)
//! - `cell_to_csv_string` for user-data cells → export (`commands/export.rs`)
//!
//! MySQL servers disagree about wire details across versions and variants:
//! identifier strings can arrive with the BINARY flag (typed VARBINARY),
//! unaliased information_schema column names can arrive uppercased
//! (TABLE_SCHEMA vs table_schema), catalog counters flip between signed and
//! unsigned. sqlx's default decoding is strict about all of that, so every
//! read here degrades in order and logs at the `dbdog::compat` target —
//! server quirks surface in logs instead of failing the query or silently
//! emptying the UI.

use serde_json::Value;
use sqlx::mysql::MySqlRow;
use sqlx::{Column as _, Row, TypeInfo, ValueRef};

// ── Catalog scalar readers (information_schema / SHOW rows) ─────────────

/// Resolve a column index by name, case-insensitively.
pub fn column_index_ci(row: &MySqlRow, name: &str) -> Option<usize> {
    row.columns()
        .iter()
        .position(|c| c.name().eq_ignore_ascii_case(name))
}

/// Decode a string cell by position.
pub fn string_at(row: &MySqlRow, index: usize) -> String {
    match row.try_get::<String, _>(index) {
        Ok(s) => s,
        Err(string_err) => match row.try_get::<Vec<u8>, _>(index) {
            Ok(bytes) => {
                tracing::debug!(
                    target: "dbdog::compat",
                    index,
                    error = %string_err,
                    "string decode fell back to raw bytes"
                );
                String::from_utf8_lossy(&bytes).into_owned()
            }
            Err(_) => {
                tracing::warn!(
                    target: "dbdog::compat",
                    index,
                    error = %string_err,
                    "string decode failed on every fallback, returning empty"
                );
                String::new()
            }
        },
    }
}

/// Decode a nullable string cell by position. NULL stays None; a non-null
/// value that cannot be decoded degrades to `Some("")` via [string_at].
pub fn opt_string_at(row: &MySqlRow, index: usize) -> Option<String> {
    if row.try_get_raw(index).map_or(true, |v| v.is_null()) {
        return None;
    }
    Some(string_at(row, index))
}

/// Decode a string cell by column name (case-insensitive lookup).
pub fn sql_string(row: &MySqlRow, column: &str) -> String {
    match column_index_ci(row, column) {
        Some(i) => string_at(row, i),
        None => {
            tracing::warn!(
                target: "dbdog::compat",
                column,
                "column not found in result set, returning empty string"
            );
            String::new()
        }
    }
}

/// Decode a nullable string cell by column name (case-insensitive lookup).
pub fn sql_opt_string(row: &MySqlRow, column: &str) -> Option<String> {
    column_index_ci(row, column).and_then(|i| opt_string_at(row, i))
}

/// Decode an unsigned integer cell by position, tolerating a signed column
/// (catalog counters are reported inconsistently across server versions).
/// NULL or undecodable values return None.
pub fn opt_u64_at(row: &MySqlRow, index: usize) -> Option<u64> {
    if row.try_get_raw(index).map_or(true, |v| v.is_null()) {
        return None;
    }
    if let Ok(v) = row.try_get::<u64, _>(index) {
        return Some(v);
    }
    match row.try_get::<i64, _>(index) {
        Ok(v) => Some(v.max(0) as u64),
        Err(e) => {
            tracing::warn!(
                target: "dbdog::compat",
                index,
                error = %e,
                "integer decode failed on every fallback, returning None"
            );
            None
        }
    }
}

/// Decode an unsigned integer cell by column name (case-insensitive lookup).
pub fn sql_opt_u64(row: &MySqlRow, column: &str) -> Option<u64> {
    column_index_ci(row, column).and_then(|i| opt_u64_at(row, i))
}

// ── User-data cell → JSON (query grid) ──────────────────────────────────

/// Decode one cell into a `serde_json::Value` using sqlx's type mappings.
///
/// Uses `try_get_unchecked` to bypass sqlx's `Type::compatible()` check,
/// which is overly strict for dynamic queries (flag mismatches on
/// BINARY/UNSIGNED), while still relying on sqlx's `Decode` implementations
/// rather than hand-rolled parsing.
pub fn cell_to_json(row: &MySqlRow, i: usize) -> Value {
    if row.try_get_raw(i).map_or(true, |v| v.is_null()) {
        return Value::Null;
    }

    let type_name = row.column(i).type_info().name().to_uppercase();
    json_by_type(row, i, &type_name)
}

fn json_by_type<'r>(row: &'r MySqlRow, i: usize, type_name: &str) -> Value {
    if type_name.starts_with("TINYINT") {
        return json_integer::<i8, u8>(row, i, type_name, |v| Value::Number(v.into()), |v| {
            Value::Number(v.into())
        });
    }
    if type_name.starts_with("SMALLINT") {
        return json_integer::<i16, u16>(row, i, type_name, |v| Value::Number(v.into()), |v| {
            Value::Number(v.into())
        });
    }
    if type_name.starts_with("MEDIUMINT")
        || type_name.starts_with("INT")
        || type_name.starts_with("INTEGER")
    {
        return json_integer::<i32, u32>(row, i, type_name, |v| Value::Number(v.into()), |v| {
            Value::Number(v.into())
        });
    }
    if type_name.starts_with("BIGINT") {
        return json_integer::<i64, u64>(row, i, type_name, |v| Value::Number(v.into()), |v| {
            Value::Number(v.into())
        });
    }
    if type_name.starts_with("FLOAT") {
        return json_or_fallback::<f32>(row, i, |v| {
            serde_json::Number::from_f64(f64::from(v))
                .map(Value::Number)
                .unwrap_or_else(|| Value::String(v.to_string()))
        });
    }
    if type_name.starts_with("DOUBLE") || type_name.starts_with("REAL") {
        return json_or_fallback::<f64>(row, i, |v| {
            serde_json::Number::from_f64(v)
                .map(Value::Number)
                .unwrap_or_else(|| Value::String(v.to_string()))
        });
    }
    if type_name.starts_with("DECIMAL") || type_name.starts_with("NUMERIC") {
        return json_or_fallback::<bigdecimal::BigDecimal>(row, i, |v| {
            Value::String(v.to_string())
        });
    }
    if type_name.starts_with("BIT") {
        return json_bit(row, i);
    }
    if type_name.starts_with("JSON") {
        return json_or_fallback::<Value>(row, i, |v| v);
    }
    if type_name == "DATE" {
        return json_or_fallback::<chrono::NaiveDate>(row, i, |v| {
            Value::String(v.to_string())
        });
    }
    if type_name == "DATETIME" || type_name == "TIMESTAMP" {
        return json_or_fallback::<chrono::NaiveDateTime>(row, i, |v| {
            Value::String(v.to_string())
        });
    }
    if type_name == "TIME" {
        return json_or_fallback::<chrono::NaiveTime>(row, i, |v| {
            Value::String(v.to_string())
        });
    }
    if type_name == "YEAR" {
        return json_or_fallback::<i16>(row, i, |v| Value::Number(v.into()));
    }
    if type_name.starts_with("BINARY")
        || type_name.starts_with("VARBINARY")
        || type_name.contains("BLOB")
    {
        return json_or_fallback::<Vec<u8>>(row, i, |bytes| {
            Value::String(bytes_to_text_or_base64(bytes))
        });
    }
    // VARCHAR, CHAR, TEXT, ENUM, SET, GEOMETRY, etc.
    json_string_cell(row, i)
}

fn json_or_fallback<'r, T>(
    row: &'r MySqlRow,
    i: usize,
    convert: impl FnOnce(T) -> Value,
) -> Value
where
    T: sqlx::Decode<'r, sqlx::MySql> + sqlx::Type<sqlx::MySql>,
{
    row.try_get_unchecked::<T, _>(i)
        .map(convert)
        .unwrap_or_else(|_| json_string_cell(row, i))
}

fn json_integer<'r, S, U>(
    row: &'r MySqlRow,
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
        json_or_fallback(row, i, unsigned)
    } else {
        json_or_fallback(row, i, signed)
    }
}

fn json_bit(row: &MySqlRow, i: usize) -> Value {
    json_or_fallback::<Vec<u8>>(row, i, |bytes| {
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

/// BINARY/VARBINARY/BLOB family. These columns frequently hold text or JSON
/// payloads, so valid UTF-8 content renders as-is; base64 is only the
/// fallback for bytes that are not valid UTF-8.
fn bytes_to_text_or_base64(bytes: Vec<u8>) -> String {
    match std::str::from_utf8(&bytes) {
        Ok(text) => text.to_owned(),
        Err(_) => base64::Engine::encode(
            &base64::engine::general_purpose::STANDARD,
            bytes,
        ),
    }
}

fn json_string_cell(row: &MySqlRow, i: usize) -> Value {
    row.try_get_unchecked::<String, _>(i)
        .map(Value::String)
        .unwrap_or_else(|_| {
            // Non-UTF-8 text columns (e.g. latin1) fail String decoding;
            // degrade visibly instead of silently rendering NULL.
            match row.try_get_unchecked::<Vec<u8>, _>(i) {
                Ok(bytes) => Value::String(String::from_utf8_lossy(&bytes).into_owned()),
                Err(_) => Value::Null,
            }
        })
}

// ── User-data cell → CSV text (export) ──────────────────────────────────

/// Decode one cell to its CSV text form. Rendering intentionally differs
/// from [cell_to_json] where the grid and CSV need different shapes
/// (e.g. numbers stay native JSON numbers but become plain text here).
pub fn cell_to_csv_string(row: &MySqlRow, i: usize) -> String {
    if row.try_get_raw(i).map_or(true, |v| v.is_null()) {
        return String::new();
    }
    let type_name = row.column(i).type_info().name().to_uppercase();
    csv_by_type(row, i, &type_name)
}

fn csv_by_type(row: &MySqlRow, i: usize, type_name: &str) -> String {
    macro_rules! try_get {
        ($t:ty) => {
            row.try_get_unchecked::<$t, _>(i)
                .map(|v| v.to_string())
                .unwrap_or_default()
        };
    }

    if type_name.starts_with("TINYINT") {
        if type_name.contains("UNSIGNED") { try_get!(u8) } else { try_get!(i8) }
    } else if type_name.starts_with("SMALLINT") {
        if type_name.contains("UNSIGNED") { try_get!(u16) } else { try_get!(i16) }
    } else if type_name.starts_with("MEDIUMINT") || type_name.starts_with("INT") || type_name.starts_with("INTEGER") {
        if type_name.contains("UNSIGNED") { try_get!(u32) } else { try_get!(i32) }
    } else if type_name.starts_with("BIGINT") {
        if type_name.contains("UNSIGNED") { try_get!(u64) } else { try_get!(i64) }
    } else if type_name.starts_with("FLOAT") {
        try_get!(f32)
    } else if type_name.starts_with("DOUBLE") || type_name.starts_with("REAL") {
        try_get!(f64)
    } else if type_name.starts_with("DECIMAL") || type_name.starts_with("NUMERIC") {
        row.try_get_unchecked::<bigdecimal::BigDecimal, _>(i)
            .map(|v| v.to_string()).unwrap_or_default()
    } else if type_name.starts_with("BIT") {
        row.try_get_unchecked::<Vec<u8>, _>(i)
            .map(|bytes| {
                if bytes.is_empty() { return String::new(); }
                let mut val: u64 = 0;
                for b in bytes { val = (val << 8) | u64::from(b); }
                val.to_string()
            }).unwrap_or_default()
    } else if type_name.starts_with("BINARY")
        || type_name.starts_with("VARBINARY")
        || type_name.contains("BLOB")
    {
        // Blob columns frequently hold text/JSON payloads: valid UTF-8 is
        // exported as-is, base64 is the fallback for non-UTF-8 bytes
        // (matching the query grid's rendering of binary values).
        row.try_get_unchecked::<Vec<u8>, _>(i)
            .map(bytes_to_text_or_base64)
            .unwrap_or_default()
    } else if type_name == "DATE" {
        row.try_get_unchecked::<chrono::NaiveDate, _>(i).map(|v| v.to_string()).unwrap_or_default()
    } else if type_name == "DATETIME" || type_name == "TIMESTAMP" {
        row.try_get_unchecked::<chrono::NaiveDateTime, _>(i).map(|v| v.to_string()).unwrap_or_default()
    } else if type_name == "TIME" {
        row.try_get_unchecked::<chrono::NaiveTime, _>(i).map(|v| v.to_string()).unwrap_or_default()
    } else if type_name == "YEAR" {
        try_get!(i16)
    } else {
        // VARCHAR/CHAR/TEXT/ENUM/SET and anything unrecognized: decode as
        // text, falling back to lossy bytes (e.g. latin1 or binary-flagged
        // columns) instead of exporting a silently-empty cell.
        string_at(row, i)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // The helpers are exercised against live servers by
    // tests/mysql_compat.rs; here we only pin the pure behaviors.

    #[test]
    fn ascii_case_insensitive_match() {
        assert!("TABLE_SCHEMA".eq_ignore_ascii_case("table_schema"));
        assert!(!"TABLE_SCHEMA".eq_ignore_ascii_case("table_name"));
    }

    #[test]
    fn bytes_render_as_text_or_base64() {
        assert_eq!(bytes_to_text_or_base64(b"plain".to_vec()), "plain");
        assert_eq!(bytes_to_text_or_base64(vec![0xC3, 0x28]), "wyg=");
    }
}

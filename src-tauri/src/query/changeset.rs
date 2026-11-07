//! Changeset statement generation: the forward UPDATE/DELETE for a staged
//! grid modification and its rollback. The rollback statements are the
//! changeset's safety net — a generation bug here means silent data loss,
//! so they live in Rust with unit tests (ported from src/lib/sql.ts).

use crate::error::AppError;
use crate::utils::escape_mysql_identifier;
use serde_json::Value;

/// Format a JSON value as a SQL literal. Port of `formatSqlValue`:
/// NULL, booleans as 1/0, numbers bare, objects/arrays serialized as JSON
/// strings, everything else as an escaped string literal.
pub fn format_sql_value(val: &Value) -> String {
    match val {
        Value::Null => "NULL".to_string(),
        Value::Bool(b) => if *b { "1" } else { "0" }.to_string(),
        Value::Number(n) => n.to_string(),
        Value::String(s) => escape_string_literal(s),
        other => escape_string_literal(&other.to_string()),
    }
}

/// Quote a MySQL string literal: backslash and single-quote doubled;
/// LIKE wildcards (% _) deliberately left alone (frontend parity).
pub fn escape_string_literal(s: &str) -> String {
    format!("'{}'", s.replace('\\', "\\\\").replace('\'', "\\'"))
}

/// WHERE clause keyed by the row's primary-key columns; missing/NULL values
/// degrade to `col IS NULL` (frontend parity).
fn pk_where_clause(pk_columns: &[String], row: &serde_json::Map<String, Value>) -> String {
    let parts: Vec<String> = pk_columns
        .iter()
        .map(|col| match row.get(col) {
            None | Some(Value::Null) => {
                format!("{} IS NULL", escape_mysql_identifier(col))
            }
            Some(v) => format!("{} = {}", escape_mysql_identifier(col), format_sql_value(v)),
        })
        .collect();
    parts.join(" AND ")
}

/// Reverse statement for a cell edit: restore the pre-edit value.
pub fn rollback_for_update(
    database: &str,
    table: &str,
    pk_columns: &[String],
    row_before: &serde_json::Map<String, Value>,
    column: &str,
) -> String {
    let old = row_before.get(column).cloned().unwrap_or(Value::Null);
    let set = format!(
        "{} = {}",
        escape_mysql_identifier(column),
        format_sql_value(&old)
    );
    format!(
        "UPDATE {}.{} SET {} WHERE {} LIMIT 1;",
        escape_mysql_identifier(database),
        escape_mysql_identifier(table),
        set,
        pk_where_clause(pk_columns, row_before)
    )
}

/// Forward statement for a cell edit. `new_value == None` means NULL;
/// a JSON string (including "") is stored literally.
pub fn update_statement(
    database: &str,
    table: &str,
    pk_columns: &[String],
    row_before: &serde_json::Map<String, Value>,
    column: &str,
    new_value: Option<&Value>,
) -> String {
    let set = format!(
        "{} = {}",
        escape_mysql_identifier(column),
        match new_value {
            None | Some(Value::Null) => "NULL".to_string(),
            Some(v) => format_sql_value(v),
        }
    );
    format!(
        "UPDATE {}.{} SET {} WHERE {} LIMIT 1;",
        escape_mysql_identifier(database),
        escape_mysql_identifier(table),
        set,
        pk_where_clause(pk_columns, row_before)
    )
}

/// Forward statement for a row delete.
pub fn delete_statement(
    database: &str,
    table: &str,
    pk_columns: &[String],
    row_before: &serde_json::Map<String, Value>,
) -> String {
    format!(
        "DELETE FROM {}.{} WHERE {} LIMIT 1;",
        escape_mysql_identifier(database),
        escape_mysql_identifier(table),
        pk_where_clause(pk_columns, row_before)
    )
}

/// Forward statement for a newly filled row: only the non-null columns are
/// listed (auto-increment PKs stay absent so the server assigns them).
/// `row` keys are columns; JSON null values are skipped entirely.
pub fn insert_statement(
    database: &str,
    table: &str,
    row: &serde_json::Map<String, Value>,
) -> String {
    let mut cols: Vec<String> = Vec::new();
    let mut values: Vec<String> = Vec::new();
    for (col, v) in row {
        if v.is_null() {
            continue;
        }
        cols.push(escape_mysql_identifier(col));
        values.push(format_sql_value(v));
    }
    if cols.is_empty() {
        // A fully-null row is meaningless but must not generate broken SQL.
        return String::new();
    }
    format!(
        "INSERT INTO {}.{} ({}) VALUES ({});",
        escape_mysql_identifier(database),
        escape_mysql_identifier(table),
        cols.join(", "),
        values.join(", ")
    )
}

/// Reverse statement for an inserted row: delete by its full non-null
/// content, LIMIT 1. The auto-generated PK is unknown at staging time, so
/// the match is content-based — visible SQL review is part of the contract.
pub fn rollback_for_insert(
    database: &str,
    table: &str,
    row: &serde_json::Map<String, Value>,
) -> String {
    let conds: Vec<String> = row
        .iter()
        .filter(|(_, v)| !v.is_null())
        .map(|(col, v)| {
            format!(
                "{} = {}",
                escape_mysql_identifier(col),
                format_sql_value(v)
            )
        })
        .collect();
    if conds.is_empty() {
        return String::new();
    }
    format!(
        "DELETE FROM {}.{} WHERE {} LIMIT 1;",
        escape_mysql_identifier(database),
        escape_mysql_identifier(table),
        conds.join(" AND ")
    )
}

/// Reverse statement for a row delete: re-insert the full row (primary key
/// included) with the values as they were BEFORE the delete.
pub fn rollback_for_delete(
    database: &str,
    table: &str,
    columns: &[String],
    row_before: &serde_json::Map<String, Value>,
) -> String {
    let cols: Vec<String> = columns.iter().map(|c| escape_mysql_identifier(c)).collect();
    let values: Vec<String> = columns
        .iter()
        .map(|c| format_sql_value(row_before.get(c).unwrap_or(&Value::Null)))
        .collect();
    format!(
        "INSERT INTO {}.{} ({}) VALUES ({});",
        escape_mysql_identifier(database),
        escape_mysql_identifier(table),
        cols.join(", "),
        values.join(", ")
    )
}

/// Request payload for `changeset_prepare`.
#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChangesetPrepareRequest {
    pub database: String,
    pub table: String,
    #[serde(default)]
    pub pk_columns: Vec<String>,
    /// "update" | "delete"
    pub kind: String,
    /// Pre-edit row snapshot (all columns → value).
    #[serde(default)]
    pub row: serde_json::Map<String, Value>,
    /// Update target column.
    #[serde(default)]
    pub column: Option<String>,
    /// Update value: `null` stores NULL, a string stores literally.
    #[serde(default)]
    pub new_value: Option<Value>,
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreparedChange {
    pub sql: String,
    pub rollback_sql: String,
}

/// Build forward + rollback SQL for one staged change.
pub fn prepare(request: ChangesetPrepareRequest) -> Result<PreparedChange, AppError> {
    if request.pk_columns.is_empty() {
        return Err(AppError::QueryFailed(
            "无法生成变更 SQL：没有可用主键列".to_string(),
        ));
    }
    match request.kind.as_str() {
        "update" => {
            let column = request.column.as_deref().ok_or_else(|| {
                AppError::QueryFailed("变更缺少目标列".to_string())
            })?;
            Ok(PreparedChange {
                sql: update_statement(
                    &request.database,
                    &request.table,
                    &request.pk_columns,
                    &request.row,
                    column,
                    request.new_value.as_ref(),
                ),
                rollback_sql: rollback_for_update(
                    &request.database,
                    &request.table,
                    &request.pk_columns,
                    &request.row,
                    column,
                ),
            })
        }
        "delete" => {
            let columns: Vec<String> = request.row.keys().cloned().collect();
            Ok(PreparedChange {
                sql: delete_statement(
                    &request.database,
                    &request.table,
                    &request.pk_columns,
                    &request.row,
                ),
                rollback_sql: rollback_for_delete(
                    &request.database,
                    &request.table,
                    &columns,
                    &request.row,
                ),
            })
        }
        "insert" => {
            let sql = insert_statement(&request.database, &request.table, &request.row);
            if sql.is_empty() {
                return Err(AppError::QueryFailed(
                    "新增行没有任何非空列，无法生成 INSERT".to_string(),
                ));
            }
            let rollback_sql =
                rollback_for_insert(&request.database, &request.table, &request.row);
            if rollback_sql.is_empty() {
                return Err(AppError::QueryFailed(
                    "新增行没有任何非空列，无法生成回滚".to_string(),
                ));
            }
            Ok(PreparedChange { sql, rollback_sql })
        }
        other => Err(AppError::QueryFailed(format!(
            "未知变更类型: {other}"
        ))),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn row() -> serde_json::Map<String, Value> {
        json!({
            "id": 3,
            "name": "it's O'Brien\\path",
            "note": Value::Null,
            "flags": json!({"a": 1}),
        })
        .as_object()
        .unwrap()
        .clone()
    }

    #[test]
    fn literals_match_frontend_semantics() {
        assert_eq!(format_sql_value(&Value::Null), "NULL");
        assert_eq!(format_sql_value(&json!(true)), "1");
        assert_eq!(format_sql_value(&json!(false)), "0");
        assert_eq!(format_sql_value(&json!(42)), "42");
        assert_eq!(format_sql_value(&json!("it's")), "'it\\'s'");
        assert_eq!(
            format_sql_value(&json!("back\\slash")),
            "'back\\\\slash'"
        );
        assert_eq!(format_sql_value(&json!({"a": 1})), "'{\"a\":1}'");
    }

    #[test]
    fn update_sql_and_rollback() {
        let r = row();
        let sql = update_statement(
            "db",
            "t_user",
            &["id".to_string()],
            &r,
            "name",
            Some(&json!("new name")),
        );
        assert_eq!(
            sql,
            "UPDATE `db`.`t_user` SET `name` = 'new name' WHERE `id` = 3 LIMIT 1;"
        );
        let rollback = rollback_for_update("db", "t_user", &["id".to_string()], &r, "name");
        assert_eq!(
            rollback,
            "UPDATE `db`.`t_user` SET `name` = 'it\\'s O\\'Brien\\\\path' WHERE `id` = 3 LIMIT 1;"
        );
    }

    #[test]
    fn delete_sql_and_insert_rollback() {
        let r = row();
        let cols = vec!["id", "name", "note", "flags"];
        let sql = delete_statement("db", "t_user", &["id".to_string()], &r);
        assert_eq!(
            sql,
            "DELETE FROM `db`.`t_user` WHERE `id` = 3 LIMIT 1;"
        );
        let rollback = rollback_for_delete("db", "t_user", &cols.iter().map(|s| s.to_string()).collect::<Vec<_>>(), &r);
        assert_eq!(
            rollback,
            "INSERT INTO `db`.`t_user` (`id`, `name`, `note`, `flags`) VALUES (3, 'it\\'s O\\'Brien\\\\path', NULL, '{\"a\":1}');"
        );
    }

    #[test]
    fn null_pk_degrades_to_is_null() {
        let mut r = row();
        r.insert("id".to_string(), Value::Null);
        let sql = delete_statement("db", "t", &["id".to_string()], &r);
        assert_eq!(sql, "DELETE FROM `db`.`t` WHERE `id` IS NULL LIMIT 1;");
    }

    #[test]
    fn update_to_null_literal() {
        let r = row();
        let sql = update_statement("db", "t", &["id".to_string()], &r, "name", None);
        assert!(sql.contains("SET `name` = NULL WHERE"));
    }
}

#[cfg(test)]
mod insert_tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn insert_skips_nulls_and_rollback_matches_content() {
        let mut r = json!({"id": 3, "name": "ann", "note": Value::Null});
        let obj = r.as_object_mut().unwrap();
        let sql = insert_statement("db", "t_user", obj);
        assert_eq!(
            sql,
            "INSERT INTO `db`.`t_user` (`id`, `name`) VALUES (3, 'ann');"
        );
        let rollback = rollback_for_insert("db", "t_user", obj);
        assert_eq!(
            rollback,
            "DELETE FROM `db`.`t_user` WHERE `id` = 3 AND `name` = 'ann' LIMIT 1;"
        );
    }

    #[test]
    fn insert_prepare_rejects_fully_null_row() {
        let req = ChangesetPrepareRequest {
            database: "db".to_string(),
            table: "t".to_string(),
            pk_columns: vec![],
            kind: "insert".to_string(),
            row: serde_json::Map::new(),
            column: None,
            new_value: None,
        };
        assert!(prepare(req).is_err());
    }
}

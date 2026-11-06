//! Filter model → full-table search SQL translation. Port of the frontend
//! `buildTableSearchSql` / `buildFilterColumnCondition` /
//! `buildFilterSimpleCondition` — the generated SQL is executed against the
//! whole table, so it lives in Rust with unit tests.

use crate::utils::escape_mysql_identifier;
use serde_json::Value;

use super::changeset::escape_string_literal;

/// JS `Number()` semantics for JSON filter values: null/"" → 0, unparseable
/// strings → NaN (mapped to None).
fn js_number(v: &Value) -> Option<f64> {
    match v {
        Value::Null => Some(0.0),
        Value::Bool(b) => Some(if *b { 1.0 } else { 0.0 }),
        Value::Number(n) => n.as_f64(),
        Value::String(s) => {
            let t = s.trim();
            if t.is_empty() {
                Some(0.0)
            } else {
                t.parse::<f64>().ok()
            }
        }
        _ => None,
    }
}

fn like(col: &str, pattern: &str) -> String {
    format!("{} LIKE {}", col, escape_string_literal(pattern))
}

/// Translate one column's filter entry to a SQL condition.
fn filter_column_condition(col: &str, entry: &Value) -> Option<String> {
    let obj = entry.as_object()?;
    let operator = obj
        .get("operator")
        .and_then(Value::as_str)
        .map(|s| s.to_ascii_uppercase());
    let c1 = obj.get("condition1");
    let c2 = obj.get("condition2");
    if let (Some(op), Some(a), Some(b)) = (operator.as_deref(), c1, c2) {
        let join = if op == "OR" { "OR" } else { "AND" };
        let ca = filter_simple_condition(col, a);
        let cb = filter_simple_condition(col, b);
        return match (ca, cb) {
            (Some(a), Some(b)) => Some(format!("({a} {join} {b})")),
            (a, b) => a.or(b),
        };
    }
    filter_simple_condition(col, entry)
}

fn filter_simple_condition(col: &str, entry: &Value) -> Option<String> {
    let obj = entry.as_object()?;
    let filter_type = obj.get("filterType").and_then(Value::as_str)?;
    let r#type = obj.get("type").and_then(Value::as_str)?;
    match filter_type {
        "text" => {
            let v = match obj.get("filter") {
                None | Some(Value::Null) => String::new(),
                Some(Value::String(s)) => s.clone(),
                Some(other) => other.to_string(),
            };
            match r#type {
                "contains" => Some(like(col, &format!("%{v}%"))),
                "notContains" => Some(format!(
                    "{} NOT LIKE {}",
                    col,
                    escape_string_literal(&format!("%{v}%"))
                )),
                "equals" => Some(format!("{} = {}", col, escape_string_literal(&v))),
                "notEqual" => Some(format!("{} <> {}", col, escape_string_literal(&v))),
                "startsWith" => Some(like(col, &format!("{v}%"))),
                "endsWith" => Some(like(col, &format!("%{v}"))),
                "blank" => Some(format!("({col} IS NULL OR {col} = '')")),
                "notBlank" => Some(format!("({col} IS NOT NULL AND {col} <> '')")),
                _ => None,
            }
        }
        "number" => {
            let v = js_number(obj.get("filter").unwrap_or(&Value::Null));
            let v_to = js_number(obj.get("filterTo").unwrap_or(&Value::Null));
            match r#type {
                "equals" => v.map(|v| format!("{col} = {v}")),
                "notEqual" => v.map(|v| format!("{col} <> {v}")),
                "lessThan" => v.map(|v| format!("{col} < {v}")),
                "lessThanOrEqual" => v.map(|v| format!("{col} <= {v}")),
                "greaterThan" => v.map(|v| format!("{col} > {v}")),
                "greaterThanOrEqual" => v.map(|v| format!("{col} >= {v}")),
                "inRange" => match (v, v_to) {
                    (Some(a), Some(b)) => Some(format!("{col} BETWEEN {a} AND {b}")),
                    _ => None,
                },
                "blank" => Some(format!("{col} IS NULL")),
                "notBlank" => Some(format!("{col} IS NOT NULL")),
                _ => None,
            }
        }
        "date" => {
            // Day-granular: [d 00:00:00, d+1 00:00:00) matches DATE and
            // DATETIME columns alike.
            let as_date = |v: Option<&Value>| -> String {
                match v {
                    Some(Value::String(s)) => s.clone(),
                    Some(Value::Null) | None => String::new(),
                    Some(other) => other.to_string(),
                }
            };
            let from = as_date(obj.get("dateFrom"));
            let day_after = |d: &str| {
                format!("DATE_ADD({}, INTERVAL 1 DAY)", escape_string_literal(d))
            };
            match r#type {
                "equals" => (!from.is_empty()).then(|| {
                    format!(
                        "({col} >= {} AND {col} < {})",
                        escape_string_literal(&from),
                        day_after(&from)
                    )
                }),
                "notEqual" => (!from.is_empty()).then(|| {
                    format!(
                        "NOT ({col} >= {} AND {col} < {})",
                        escape_string_literal(&from),
                        day_after(&from)
                    )
                }),
                "lessThan" => (!from.is_empty())
                    .then(|| format!("{col} < {}", escape_string_literal(&from))),
                "lessThanOrEqual" => (!from.is_empty())
                    .then(|| format!("{col} < {}", day_after(&from))),
                "greaterThan" => (!from.is_empty())
                    .then(|| format!("{col} >= {}", day_after(&from))),
                "greaterThanOrEqual" => (!from.is_empty())
                    .then(|| format!("{col} >= {}", escape_string_literal(&from))),
                "inRange" => {
                    let to = as_date(obj.get("dateTo"));
                    (!from.is_empty() && !to.is_empty()).then(|| {
                        format!(
                            "({col} >= {} AND {col} < {})",
                            escape_string_literal(&from),
                            day_after(&to)
                        )
                    })
                }
                "blank" => Some(format!("{col} IS NULL")),
                "notBlank" => Some(format!("{col} IS NOT NULL")),
                _ => None,
            }
        }
        _ => None,
    }
}

/// Translate the grid's AG Grid filter model into a full-table search
/// SELECT. `None` = no usable conditions (caller falls back to plain
/// browsing).
pub fn filter_search_sql(database: &str, table: &str, model: &Value) -> Option<String> {
    let obj = model.as_object()?;
    let mut conds: Vec<String> = Vec::new();
    for (field, entry) in obj {
        let col = escape_mysql_identifier(field);
        if let Some(cond) = filter_column_condition(&col, entry) {
            conds.push(cond);
        }
    }
    if conds.is_empty() {
        return None;
    }
    Some(format!(
        "SELECT * FROM {}.{} WHERE {};",
        escape_mysql_identifier(database),
        escape_mysql_identifier(table),
        conds.join(" AND ")
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn text_number_date_conditions() {
        let model = json!({
            "name": {"filterType": "text", "type": "contains", "filter": "o'brien"},
            "age": {"filterType": "number", "type": "equals", "filter": 30},
            "created": {"filterType": "date", "type": "equals", "dateFrom": "2026-01-02"}
        });
        let sql = filter_search_sql("db", "t", &model).unwrap();
        assert!(sql.starts_with("SELECT * FROM `db`.`t` WHERE "));
        assert!(sql.contains("`name` LIKE '%o\\'brien%'"));
        assert!(sql.contains("`age` = 30"));
        assert!(sql.contains(
            "`created` >= '2026-01-02' AND `created` < DATE_ADD('2026-01-02', INTERVAL 1 DAY)"
        ));
    }

    #[test]
    fn combined_operator_and_range() {
        let model = json!({
            "a": {
                "filterType": "text", "type": "contains", "filter": "x",
                "operator": "OR",
                "condition1": {"filterType": "text", "type": "contains", "filter": "x"},
                "condition2": {"filterType": "text", "type": "notBlank"}
            },
            "b": {"filterType": "number", "type": "inRange", "filter": 1, "filterTo": 9}
        });
        let sql = filter_search_sql("db", "t", &model).unwrap();
        // notBlank carries its own parens — TS output nests them the same way.
        assert!(sql.contains("(`a` LIKE '%x%' OR (`a` IS NOT NULL AND `a` <> ''))"));
        assert!(sql.contains("`b` BETWEEN 1 AND 9"));
    }

    #[test]
    fn blank_variants_and_unknown_types() {
        let model = json!({
            "t1": {"filterType": "text", "type": "blank"},
            "n1": {"filterType": "number", "type": "notBlank"},
            "x1": {"filterType": "text", "type": "unknown"}
        });
        let sql = filter_search_sql("db", "t", &model).unwrap();
        assert!(sql.contains("(`t1` IS NULL OR `t1` = '')"));
        assert!(sql.contains("`n1` IS NOT NULL"));
        assert!(!sql.contains("x1"));
    }

    #[test]
    fn empty_or_invalid_model_is_none() {
        assert!(filter_search_sql("db", "t", &json!({})).is_none());
        assert!(filter_search_sql("db", "t", &Value::Null).is_none());
    }
}

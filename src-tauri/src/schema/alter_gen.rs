//! ALTER TABLE generation for the two structure-editing surfaces:
//! 1. structure compare (target reshaped to match source) — port of the
//!    frontend `buildAlterStatements`;
//! 2. the visual table designer (working columns/indexes diffed against
//!    server snapshots) — port of `tableDesign.ts` `buildAlterStatement`
//!    + `validateDesign`. Clause ORDER is load-bearing (see tests): new
//!    columns → column redefinitions → PK → indexes → column drops.

use crate::error::AppError;
use crate::utils::escape_mysql_identifier;
use serde::Serialize;
use serde_json::Value;

fn escape_string_literal(s: &str) -> String {
    format!("'{}'", s.replace('\\', "\\\\").replace('\'', "\\'"))
}

// ── 1. Structure compare ─────────────────────────────────────────────────

/// One column's fragment for ADD/MODIFY COLUMN (frontend `columnDefinition`).
fn compare_column_definition(
    r#type: Option<&str>,
    nullable: Option<bool>,
    def: Option<&str>,
    extra: Option<&str>,
) -> String {
    let mut s = r#type.unwrap_or("").to_string();
    if nullable == Some(false) {
        s += " NOT NULL";
    }
    if let Some(def) = def {
        if !def.is_empty() {
            let upper = def.to_ascii_uppercase();
            s += if upper == "CURRENT_TIMESTAMP" || upper == "NULL" {
                format!(" DEFAULT {upper}")
            } else {
                format!(" DEFAULT {}", escape_string_literal(def))
            }
            .as_str();
        }
    }
    if extra.is_some_and(|e| e.contains("auto_increment")) {
        s += " AUTO_INCREMENT";
    }
    s
}

/// Alter statements reshaping the TARGET table to match the SOURCE side.
/// Input: `diff` as the frontend CompareTableDiff JSON. Empty vec = nothing to do.
pub fn compare_alter_statements(database: &str, diff: &Value) -> Result<Vec<String>, AppError> {
    let table_name = diff
        .get("table")
        .and_then(Value::as_str)
        .ok_or_else(|| AppError::QueryFailed("diff 缺少表名".to_string()))?;
    let table = format!(
        "{}.{}",
        escape_mysql_identifier(database),
        escape_mysql_identifier(table_name)
    );
    let mut out: Vec<String> = Vec::new();

    let mut col_clauses: Vec<String> = Vec::new();
    if let Some(cols) = diff.get("columnDiffs").and_then(Value::as_array) {
        for c in cols {
            let name = escape_mysql_identifier(
                c.get("name").and_then(Value::as_str).unwrap_or(""),
            );
            let kind = c.get("kind").and_then(Value::as_str).unwrap_or("");
            match kind {
                "added" => col_clauses.push(format!(
                    "ADD COLUMN {name} {}",
                    compare_column_definition(
                        c.get("sourceType").and_then(Value::as_str),
                        c.get("sourceNullable").and_then(Value::as_bool),
                        c.get("sourceDefault").and_then(Value::as_str),
                        c.get("sourceExtra").and_then(Value::as_str),
                    )
                )),
                "removed" => col_clauses.push(format!("DROP COLUMN {name}")),
                "changed" => col_clauses.push(format!(
                    "MODIFY COLUMN {name} {}",
                    compare_column_definition(
                        c.get("sourceType").and_then(Value::as_str),
                        c.get("sourceNullable").and_then(Value::as_bool),
                        c.get("sourceDefault").and_then(Value::as_str),
                        c.get("sourceExtra").and_then(Value::as_str),
                    )
                )),
                _ => {}
            }
        }
    }
    if !col_clauses.is_empty() {
        out.push(format!("ALTER TABLE {table} {}", col_clauses.join(", ")));
    }

    if let Some(indexes) = diff.get("indexDiffs").and_then(Value::as_array) {
        for ix in indexes {
            let raw_name = ix.get("name").and_then(Value::as_str).unwrap_or("");
            let ix_name = escape_mysql_identifier(raw_name);
            let kind = ix.get("kind").and_then(Value::as_str).unwrap_or("");
            let src_cols = |v: &Value| -> Vec<String> {
                v.get("sourceColumns")
                    .and_then(Value::as_array)
                    .map(|a| a.iter().map(|c| escape_mysql_identifier(c.as_str().unwrap_or("")).to_string()).collect())
                    .unwrap_or_default()
            };
            if raw_name == "PRIMARY" {
                if kind == "removed" {
                    out.push(format!("ALTER TABLE {table} DROP PRIMARY KEY;"));
                } else {
                    out.push(format!(
                        "ALTER TABLE {table} DROP PRIMARY KEY, ADD PRIMARY KEY ({});",
                        src_cols(ix).join(", ")
                    ));
                }
                continue;
            }
            let unique = ix.get("sourceUnique").and_then(Value::as_bool) == Some(true);
            let add_clause = format!(
                "ADD {}INDEX {} ({})",
                if unique { "UNIQUE " } else { "" },
                ix_name,
                src_cols(ix).join(", ")
            );
            match kind {
                "added" => out.push(format!("ALTER TABLE {table} {add_clause};")),
                "removed" => out.push(format!("ALTER TABLE {table} DROP INDEX {ix_name};")),
                _ => out.push(format!(
                    "ALTER TABLE {table} DROP INDEX {ix_name}, {add_clause};"
                )),
            }
        }
    }
    Ok(out)
}

// ── 2. Visual table designer ─────────────────────────────────────────────

use serde::Deserialize;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DesignerColumn {
    #[serde(default)]
    pub orig_name: Option<String>,
    /// Server snapshot fields used by the default clause. `None` for new columns.
    #[serde(default)]
    pub orig: Option<DesignerColumnOrig>,
    pub name: String,
    #[serde(default)]
    pub base_type: String,
    #[serde(default)]
    pub length: String,
    #[serde(default)]
    pub unsigned: bool,
    #[serde(default)]
    pub not_null: bool,
    #[serde(default)]
    pub default_value: String,
    #[serde(default)]
    pub auto_increment: bool,
    #[serde(default)]
    pub pk: bool,
    #[serde(default)]
    pub comment: String,
    #[serde(default)]
    pub on_update: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DesignerColumnOrig {
    #[serde(default)]
    pub extra: Option<String>,
    #[serde(default)]
    pub default_value: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DesignerIndex {
    #[serde(default)]
    pub orig_name: Option<String>,
    pub name: String,
    #[serde(default)]
    pub columns_text: String,
    #[serde(default)]
    pub unique: bool,
    /// Original server columns — the parsed columnsText round-trips to the
    /// same list, so uniqueness/compare can use the working text directly.
    #[serde(default)]
    pub orig: Option<DesignerIndexOrig>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DesignerIndexOrig {
    #[serde(default)]
    pub columns: Vec<String>,
}

fn designer_type_text(c: &DesignerColumn) -> String {
    let mut t = c.base_type.trim().to_ascii_lowercase();
    let len = c.length.trim();
    if !len.is_empty() {
        t += &format!("({len})");
    }
    if c.unsigned {
        t += " unsigned";
    }
    t
}

fn designer_default_clause(c: &DesignerColumn) -> String {
    let dv = c.default_value.trim();
    if dv.is_empty() {
        return String::new();
    }
    if dv.to_ascii_uppercase() == "NULL" {
        return "DEFAULT NULL".to_string();
    }
    // Function-call-looking defaults (now(), current_timestamp(), ...) stay raw.
    let fn_like = dv.len() > 2
        && dv.as_bytes()[dv.len() - 1] == b')'
        && {
            let inner = &dv[..dv.len() - 1];
            match inner.find('(') {
                Some(pos) => {
                    let head = &inner[..pos];
                    !head.is_empty()
                        && head.chars().all(|ch| {
                            ch.is_ascii_lowercase() || ch.is_ascii_uppercase() || ch.is_ascii_digit() || ch == '_'
                        })
                }
                None => false,
            }
        };
    if fn_like {
        return format!("DEFAULT {dv}");
    }
    let numeric = !dv.is_empty()
        && dv.strip_prefix('-').unwrap_or(dv).chars().all(|ch| ch.is_ascii_digit() || ch == '.')
        && dv.matches('.').count() <= 1;
    if numeric {
        return format!("DEFAULT {dv}");
    }
    // Expression defaults reported by MySQL 8 keep their original raw form.
    if let Some(orig) = &c.orig {
        if orig
            .extra
            .as_deref()
            .is_some_and(|e| e.contains("DEFAULT_GENERATED"))
            && orig.default_value.as_deref().map(str::trim) == Some(dv)
        {
            return format!("DEFAULT {dv}");
        }
    }
    format!("DEFAULT {}", escape_string_literal(dv))
}

/// Full column definition (everything after the column name). `force_not_null`
/// marks PK columns — MySQL requires them NOT NULL, and an explicit NULL in
/// the same ALTER as ADD PRIMARY KEY is unreliable.
pub fn designer_column_definition(c: &DesignerColumn, force_not_null: bool) -> String {
    let mut parts = vec![designer_type_text(c)];
    parts.push(
        if force_not_null || c.not_null {
            "NOT NULL"
        } else {
            "NULL"
        }
        .to_string(),
    );
    let dv = designer_default_clause(c);
    if !dv.is_empty() {
        parts.push(dv);
    }
    let on_update = c.on_update.trim();
    if !on_update.is_empty() {
        parts.push(format!("ON UPDATE {on_update}"));
    }
    if c.auto_increment {
        parts.push("AUTO_INCREMENT".to_string());
    }
    let comment = c.comment.trim();
    if !comment.is_empty() {
        parts.push(format!("COMMENT {}", escape_string_literal(comment)));
    }
    parts.join(" ")
}

fn designer_pk_set(columns: &[DesignerColumn]) -> Vec<String> {
    columns
        .iter()
        .filter(|c| c.pk)
        .map(|c| c.orig_name.clone().unwrap_or_else(|| c.name.clone()))
        .collect()
}

fn parse_index_columns(columns_text: &str) -> Vec<String> {
    columns_text
        .split(',')
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect()
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AlterBuildResult {
    pub sql: Option<String>,
    /// True when the final PK differs from the original one.
    pub pk_changed: bool,
}

/// Diff the working column/index lists against the server snapshots and
/// build a single multi-clause ALTER TABLE. Faithful port of
/// `buildAlterStatement` — including the survivor-order position tracking.
pub fn designer_alter_statement(
    database: &str,
    table: &str,
    orig_columns: &[DesignerColumn],
    columns: &[DesignerColumn],
    orig_indexes: &[DesignerIndex],
    indexes: &[DesignerIndex],
) -> AlterBuildResult {
    let target = format!(
        "{}.{}",
        escape_mysql_identifier(database),
        escape_mysql_identifier(table)
    );
    let mut add_clauses: Vec<String> = Vec::new();
    let mut change_clauses: Vec<String> = Vec::new();
    let mut pk_clauses: Vec<String> = Vec::new();
    let mut index_clauses: Vec<String> = Vec::new();
    let mut drop_column_clauses: Vec<String> = Vec::new();

    let orig_pk = designer_pk_set(orig_columns);
    let final_pk = designer_pk_set(columns);
    let pk_changed = {
        let mut a = orig_pk.clone();
        let mut b = final_pk.clone();
        a.sort();
        b.sort();
        a != b
    };
    let final_pk_names: std::collections::HashSet<&str> =
        final_pk.iter().map(|s| s.as_str()).collect();

    let identity = |c: &DesignerColumn| -> String {
        c.orig_name.clone().unwrap_or_else(|| c.name.clone())
    };
    let def_of = |c: &DesignerColumn| -> String {
        designer_column_definition(c, final_pk_names.contains(identity(c).as_str()))
    };

    let kept_orig_names: std::collections::HashSet<&str> = columns
        .iter()
        .filter_map(|c| c.orig_name.as_deref())
        .collect();

    // 1. New columns (in final order, positioned after the preceding row).
    for (i, c) in columns.iter().enumerate() {
        if c.orig_name.is_some() {
            continue;
        }
        let position = if i > 0 {
            let prev = &columns[i - 1];
            format!(
                "AFTER {}",
                escape_mysql_identifier(prev.orig_name.as_ref().unwrap_or(&prev.name))
            )
        } else {
            "FIRST".to_string()
        };
        add_clauses.push(format!(
            "ADD COLUMN {} {} {}",
            escape_mysql_identifier(&c.name),
            def_of(c),
            position
        ));
    }

    // 2. Changed / renamed / moved existing columns. Position changes are
    // detected on the relative order of *surviving original columns* only.
    let final_survivor_seq: Vec<&str> = columns
        .iter()
        .filter_map(|c| c.orig_name.as_deref())
        .collect();
    let surviving_set: std::collections::HashSet<&str> =
        final_survivor_seq.iter().copied().collect();
    let orig_survivor_seq: Vec<&str> = orig_columns
        .iter()
        .filter(|o| surviving_set.contains(o.orig_name.as_deref().unwrap_or("")))
        .filter_map(|o| o.orig_name.as_deref())
        .collect();
    let order_changed = final_survivor_seq != orig_survivor_seq;

    let prev_survivor_of = |columns: &[DesignerColumn], target: &DesignerColumn| -> Option<String> {
        for row in columns {
            if std::ptr::eq(row, target) {
                break;
            }
            if let Some(n) = &row.orig_name {
                return Some(n.clone());
            }
        }
        None
    };

    for c in columns {
        let Some(orig_name) = &c.orig_name else { continue };
        let Some(orig) = orig_columns
            .iter()
            .find(|o| o.orig_name.as_deref() == Some(orig_name.as_str()))
        else {
            continue;
        };
        let name_changed = c.name != *orig_name;
        let def_changed = def_of(c)
            != designer_column_definition(
                orig,
                orig_pk.iter().any(|p| p == orig_name),
            );
        let mut position_changed = false;
        if order_changed {
            let prev_survivor = prev_survivor_of(columns, c);
            let mut orig_prev_survivor: Option<String> = None;
            if let Some(orig_idx) = orig_columns.iter().position(|o| {
                o.orig_name.as_deref() == Some(orig_name.as_str())
            }) {
                for o in orig_columns[..orig_idx].iter().rev() {
                    if surviving_set.contains(o.orig_name.as_deref().unwrap_or("")) {
                        orig_prev_survivor = o.orig_name.clone();
                        break;
                    }
                }
            }
            position_changed = prev_survivor != orig_prev_survivor;
        }
        if !name_changed && !def_changed && !position_changed {
            continue;
        }
        let mut position = String::new();
        if position_changed {
            position = match prev_survivor_of(columns, c) {
                Some(prev) => format!(
                    " AFTER {}",
                    escape_mysql_identifier(&prev)
                ),
                None => " FIRST".to_string(),
            };
        }
        change_clauses.push(format!(
            "CHANGE COLUMN {} {} {}{}",
            escape_mysql_identifier(orig_name),
            escape_mysql_identifier(&c.name),
            def_of(c),
            position
        ));
    }

    // 3./4. Primary key changes (before column drops).
    if pk_changed {
        if !orig_pk.is_empty() {
            pk_clauses.push("DROP PRIMARY KEY".to_string());
        }
        if !final_pk.is_empty() {
            pk_clauses.push(format!(
                "ADD PRIMARY KEY ({})",
                final_pk
                    .iter()
                    .map(|c| escape_mysql_identifier(c))
                    .collect::<Vec<_>>()
                    .join(", ")
            ));
        }
    }

    // 5./6. Index changes (drops before column drops, adds after).
    let final_by_orig: std::collections::HashMap<&str, &DesignerIndex> = indexes
        .iter()
        .filter_map(|idx| idx.orig_name.as_deref().map(|n| (n, idx)))
        .collect();
    let index_changed = |idx: &DesignerIndex, orig: Option<&DesignerIndex>| -> bool {
        let Some(orig) = orig else { return true };
        let cols = parse_index_columns(&idx.columns_text);
        let orig_cols = orig
            .orig
            .as_ref()
            .map(|o| o.columns.clone())
            .unwrap_or_else(|| parse_index_columns(&orig.columns_text));
        cols != orig_cols || idx.unique != orig.unique || idx.name != idx.orig_name.clone().unwrap_or_default()
    };
    for orig in orig_indexes {
        let Some(orig_name) = &orig.orig_name else { continue };
        if orig_name == "PRIMARY" {
            continue;
        }
        let cur = final_by_orig.get(orig_name.as_str());
        match cur {
            None => index_clauses
                .push(format!("DROP INDEX {}", escape_mysql_identifier(orig_name))),
            Some(cur) if index_changed(cur, Some(orig)) => index_clauses
                .push(format!("DROP INDEX {}", escape_mysql_identifier(orig_name))),
            _ => {}
        }
    }
    for idx in indexes {
        let cols = parse_index_columns(&idx.columns_text);
        let add = |name: &str| -> String {
            format!(
                "{} {} ({})",
                if idx.unique { "ADD UNIQUE INDEX" } else { "ADD INDEX" },
                escape_mysql_identifier(name),
                cols.iter()
                    .map(|c| escape_mysql_identifier(c))
                    .collect::<Vec<_>>()
                    .join(", ")
            )
        };
        match &idx.orig_name {
            Some(orig_name) => {
                let orig = orig_indexes
                    .iter()
                    .find(|o| o.orig_name.as_deref() == Some(orig_name.as_str()));
                if orig.is_some_and(|orig| index_changed(idx, Some(orig))) {
                    index_clauses.push(add(&idx.name));
                }
            }
            None => index_clauses.push(add(&idx.name)),
        }
    }

    // 7. Dropped columns, last.
    for orig in orig_columns {
        if let Some(orig_name) = &orig.orig_name {
            if !kept_orig_names.contains(orig_name.as_str()) {
                drop_column_clauses
                    .push(format!("DROP COLUMN {}", escape_mysql_identifier(orig_name)));
            }
        }
    }

    let clauses: Vec<String> = [
        add_clauses,
        change_clauses,
        pk_clauses,
        index_clauses,
        drop_column_clauses,
    ]
    .concat();
    if clauses.is_empty() {
        return AlterBuildResult {
            sql: None,
            pk_changed,
        };
    }
    AlterBuildResult {
        sql: Some(format!(
            "ALTER TABLE {}\n  {};",
            target,
            clauses.join(",\n  ")
        )),
        pk_changed,
    }
}

/// Frontend sanity checks; returns an i18n key + params for the first
/// problem found. Port of `validateDesign`.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesignError {
    pub key: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub params: Option<std::collections::HashMap<String, String>>,
}

pub fn designer_validate(
    columns: &[DesignerColumn],
    indexes: &[DesignerIndex],
) -> Option<DesignError> {
    let mut names = std::collections::HashSet::new();
    for c in columns {
        let name = c.name.trim().to_string();
        if name.is_empty() {
            return Some(DesignError {
                key: "errNameRequired".to_string(),
                params: None,
            });
        }
        if name.contains('`') {
            return Some(DesignError {
                key: "errNameInvalid".to_string(),
                params: Some(
                    [("name".to_string(), name.clone())].into_iter().collect(),
                ),
            });
        }
        if names.contains(&name) {
            return Some(DesignError {
                key: "errNameDuplicate".to_string(),
                params: Some(
                    [("name".to_string(), name.clone())].into_iter().collect(),
                ),
            });
        }
        names.insert(name);
        if c.base_type.trim().is_empty() {
            return Some(DesignError {
                key: "errTypeRequired".to_string(),
                params: Some(
                    [("name".to_string(), c.name.trim().to_string())].into_iter().collect(),
                ),
            });
        }
    }
    let ai_cols: Vec<&DesignerColumn> =
        columns.iter().filter(|c| c.auto_increment).collect();
    if ai_cols.len() > 1 {
        return Some(DesignError {
            key: "errMultiAutoInc".to_string(),
            params: None,
        });
    }
    for c in &ai_cols {
        if !c.pk {
            return Some(DesignError {
                key: "errAutoIncPk".to_string(),
                params: Some(
                    [("name".to_string(), c.name.clone())].into_iter().collect(),
                ),
            });
        }
    }
    let mut idx_names = std::collections::HashSet::new();
    idx_names.insert("PRIMARY".to_string());
    for idx in indexes {
        let name = idx.name.trim().to_string();
        if name.is_empty() {
            return Some(DesignError {
                key: "errIdxNameRequired".to_string(),
                params: None,
            });
        }
        if idx_names.contains(&name) {
            return Some(DesignError {
                key: "errIdxDuplicate".to_string(),
                params: Some(
                    [("name".to_string(), name.clone())].into_iter().collect(),
                ),
            });
        }
        idx_names.insert(name.clone());
        if parse_index_columns(&idx.columns_text).is_empty() {
            return Some(DesignError {
                key: "errIdxColumnsRequired".to_string(),
                params: Some(
                    [("name".to_string(), name)].into_iter().collect(),
                ),
            });
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn compare_alter_generates_column_and_index_statements() {
        let diff = json!({
            "table": "t_user",
            "columnDiffs": [
                {"kind": "added", "name": "age", "sourceType": "int", "sourceNullable": false,
                 "sourceDefault": "0", "sourceExtra": null},
                {"kind": "removed", "name": "legacy"},
                {"kind": "changed", "name": "name", "sourceType": "varchar(200)",
                 "sourceNullable": true, "sourceDefault": null, "sourceExtra": null}
            ],
            "indexDiffs": [
                {"kind": "added", "name": "idx_age", "sourceColumns": ["age"], "sourceUnique": false},
                {"kind": "changed", "name": "idx_name", "sourceColumns": ["name"], "sourceUnique": true}
            ]
        });
        let out = compare_alter_statements("db", &diff).unwrap();
        assert_eq!(out.len(), 3);
        assert!(out[0].starts_with("ALTER TABLE `db`.`t_user` ADD COLUMN `age` int NOT NULL DEFAULT '0', DROP COLUMN `legacy`, MODIFY COLUMN `name` varchar(200)"));
        assert_eq!(out[1], "ALTER TABLE `db`.`t_user` ADD INDEX `idx_age` (`age`);");
        assert_eq!(
            out[2],
            "ALTER TABLE `db`.`t_user` DROP INDEX `idx_name`, ADD UNIQUE INDEX `idx_name` (`name`);"
        );
    }

    #[test]
    fn compare_alter_primary_key_special_case() {
        let diff = json!({
            "table": "t",
            "columnDiffs": [],
            "indexDiffs": [
                {"kind": "changed", "name": "PRIMARY", "sourceColumns": ["a", "b"]}
            ]
        });
        let out = compare_alter_statements("db", &diff).unwrap();
        assert_eq!(out.len(), 1);
        assert_eq!(out[0], "ALTER TABLE `db`.`t` DROP PRIMARY KEY, ADD PRIMARY KEY (`a`, `b`);");
    }

    #[test]
    fn compare_alter_empty_diff_is_empty() {
        let diff = json!({"table": "t", "columnDiffs": [], "indexDiffs": []});
        assert!(compare_alter_statements("db", &diff).unwrap().is_empty());
    }

    fn col(name: &str, orig: Option<&str>) -> DesignerColumn {
        serde_json::from_value(json!({
            "origName": orig, "name": name, "baseType": "int", "length": "",
            "notNull": true, "defaultValue": "", "pk": name == "id"
        }))
        .unwrap()
    }

    #[test]
    fn designer_new_column_position_and_defaults() {
        let orig = vec![col("id", Some("id"))];
        let new_col: DesignerColumn = serde_json::from_value(json!({
            "name": "remark", "baseType": "varchar", "length": "255",
            "notNull": false, "defaultValue": "abc"
        }))
        .unwrap();
        let result = designer_alter_statement("db", "t", &orig, &[orig[0].clone(), new_col], &[], &[]);
        let sql = result.sql.unwrap();
        assert!(sql.contains("ADD COLUMN `remark` varchar(255) NULL DEFAULT 'abc' AFTER `id`"));
    }

    #[test]
    fn designer_pk_change_order_and_force_not_null() {
        // A new column joins the PK: new-column clause comes first, then
        // DROP/ADD PRIMARY KEY, and the PK column is forced NOT NULL.
        let orig = vec![col("id", Some("id"))];
        let mut new_col: DesignerColumn = serde_json::from_value(json!({
            "name": "code", "baseType": "varchar", "length": "32",
            "notNull": false, "defaultValue": ""
        }))
        .unwrap();
        new_col.pk = true;
        let result = designer_alter_statement("db", "t", &orig, &[orig[0].clone(), new_col], &[], &[]);
        let sql = result.sql.unwrap();
        assert!(result.pk_changed);
        let add_pos = sql.find("ADD COLUMN").unwrap();
        let pk_pos = sql.find("DROP PRIMARY KEY").unwrap();
        let add_pk_pos = sql.find("ADD PRIMARY KEY").unwrap();
        assert!(add_pos < pk_pos && pk_pos < add_pk_pos);
        // The new PK column is forced NOT NULL despite notNull=false.
        assert!(sql.contains("`code` varchar(32) NOT NULL"));
    }

    #[test]
    fn designer_no_changes_is_none() {
        let orig = vec![col("id", Some("id"))];
        let result = designer_alter_statement("db", "t", &orig, &orig.clone(), &[], &[]);
        assert!(result.sql.is_none());
        assert!(!result.pk_changed);
    }

    #[test]
    fn designer_drop_column_comes_last() {
        let mut orig = vec![col("id", Some("id")), col("junk", Some("junk"))];
        orig[1].pk = false;
        let final_cols = vec![col("id", Some("id"))];
        let result = designer_alter_statement("db", "t", &orig, &final_cols, &[], &[]);
        let sql = result.sql.unwrap();
        assert_eq!(sql.trim_end_matches(';').trim_end(), format!("ALTER TABLE `db`.`t`\n  DROP COLUMN `junk`").trim_end());
    }

    #[test]
    fn designer_validate_catches_duplicates_and_autoinc() {
        let cols = vec![
            serde_json::from_value::<DesignerColumn>(json!({"name": "id", "baseType": "int", "pk": true})).unwrap(),
            serde_json::from_value::<DesignerColumn>(json!({"name": "id", "baseType": "int"})).unwrap(),
        ];
        let err = designer_validate(&cols, &[]).unwrap();
        assert_eq!(err.key, "errNameDuplicate");

        let cols2 = vec![
            serde_json::from_value::<DesignerColumn>(json!({"name": "id", "baseType": "int", "pk": true})).unwrap(),
            serde_json::from_value::<DesignerColumn>(json!({"name": "a", "baseType": "int", "autoIncrement": true})).unwrap(),
        ];
        let err = designer_validate(&cols2, &[]).unwrap();
        assert_eq!(err.key, "errAutoIncPk");
    }
}

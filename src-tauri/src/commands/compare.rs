use crate::drivers::mysql::metadata::MySqlDriver;
use crate::drivers::DatabaseMetadata;
use crate::error::AppError;
use crate::state::AppState;
use serde::Serialize;
use std::collections::HashMap;
use uuid::Uuid;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ColumnDiff {
    pub name: String,
    /// "added" = exists only in source, "removed" = only in target,
    /// "changed" = both sides differ.
    pub kind: String,
    pub source_type: Option<String>,
    pub target_type: Option<String>,
    pub source_nullable: Option<bool>,
    pub target_nullable: Option<bool>,
    pub source_default: Option<String>,
    pub target_default: Option<String>,
    pub source_extra: Option<String>,
    pub target_extra: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexDiff {
    pub name: String,
    pub kind: String,
    pub source_columns: Vec<String>,
    pub target_columns: Vec<String>,
    pub source_unique: Option<bool>,
    pub target_unique: Option<bool>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TableDiff {
    pub table: String,
    pub source_rows: Option<u64>,
    pub target_rows: Option<u64>,
    pub column_diffs: Vec<ColumnDiff>,
    pub index_diffs: Vec<IndexDiff>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StructureDiffReport {
    pub source_database: String,
    pub target_database: String,
    pub tables_only_in_source: Vec<String>,
    pub tables_only_in_target: Vec<String>,
    pub changed_tables: Vec<TableDiff>,
    pub identical_tables: Vec<String>,
}

/// Compare the structure of two databases across two (possibly different)
/// connections: table existence, columns (type/nullable/default/extra),
/// indexes (columns/uniqueness) and estimated row counts. Pure diff —
/// ALTER generation lives in the frontend so either side can be the base.
#[tauri::command]
pub async fn compare_table_structure(
    state: tauri::State<'_, AppState>,
    source_connection_id: Uuid,
    source_database: String,
    target_connection_id: Uuid,
    target_database: String,
) -> Result<StructureDiffReport, AppError> {
    let pool_a = state
        .pool_manager
        .get(&source_connection_id)
        .ok_or_else(|| AppError::ConnectionNotFound(source_connection_id.to_string()))?;
    let pool_b = state
        .pool_manager
        .get(&target_connection_id)
        .ok_or_else(|| AppError::ConnectionNotFound(target_connection_id.to_string()))?;

    let driver = MySqlDriver::new();
    let tables_a = driver.fetch_tables(&pool_a, &source_database).await?;
    let tables_b = driver.fetch_tables(&pool_b, &target_database).await?;

    let names_a: Vec<String> = tables_a.iter().map(|t| t.name.clone()).collect();
    let names_b: Vec<String> = tables_b.iter().map(|t| t.name.clone()).collect();

    let tables_only_in_source: Vec<String> = names_a
        .iter()
        .filter(|n| !names_b.contains(n))
        .cloned()
        .collect();
    let tables_only_in_target: Vec<String> = names_b
        .iter()
        .filter(|n| !names_a.contains(n))
        .cloned()
        .collect();

    let rows_a: HashMap<&str, Option<u64>> = tables_a
        .iter()
        .map(|t| (t.name.as_str(), t.rows))
        .collect();
    let rows_b: HashMap<&str, Option<u64>> = tables_b
        .iter()
        .map(|t| (t.name.as_str(), t.rows))
        .collect();

    let mut changed_tables = Vec::new();
    let mut identical_tables = Vec::new();

    for name in &names_a {
        if !names_b.contains(name) {
            continue;
        }
        let cols_a = driver.fetch_columns(&pool_a, &source_database, name).await?;
        let cols_b = driver.fetch_columns(&pool_b, &target_database, name).await?;
        let idx_a = driver.fetch_indexes(&pool_a, &source_database, name).await?;
        let idx_b = driver.fetch_indexes(&pool_b, &target_database, name).await?;

        let column_diffs = diff_columns(&cols_a, &cols_b);
        let index_diffs = diff_indexes(&idx_a, &idx_b);

        if column_diffs.is_empty() && index_diffs.is_empty() {
            identical_tables.push(name.clone());
        } else {
            changed_tables.push(TableDiff {
                table: name.clone(),
                source_rows: rows_a.get(name.as_str()).cloned().flatten(),
                target_rows: rows_b.get(name.as_str()).cloned().flatten(),
                column_diffs,
                index_diffs,
            });
        }
    }

    Ok(StructureDiffReport {
        source_database,
        target_database,
        tables_only_in_source,
        tables_only_in_target,
        changed_tables,
        identical_tables,
    })
}

fn diff_columns(
    cols_a: &[crate::schema::model::Column],
    cols_b: &[crate::schema::model::Column],
) -> Vec<ColumnDiff> {
    use crate::schema::model::Column;
    let map_b: HashMap<&str, &Column> = cols_b.iter().map(|c| (c.name.as_str(), c)).collect();
    let mut diffs = Vec::new();

    for a in cols_a {
        match map_b.get(a.name.as_str()) {
            None => diffs.push(ColumnDiff {
                name: a.name.clone(),
                kind: "added".into(),
                source_type: Some(a.data_type.clone()),
                target_type: None,
                source_nullable: Some(a.nullable),
                target_nullable: None,
                source_default: a.default_value.clone(),
                target_default: None,
                source_extra: Some(a.extra.clone()),
                target_extra: None,
            }),
            Some(b) => {
                if a.data_type != b.data_type
                    || a.nullable != b.nullable
                    || a.default_value != b.default_value
                    || a.extra != b.extra
                {
                    diffs.push(ColumnDiff {
                        name: a.name.clone(),
                        kind: "changed".into(),
                        source_type: Some(a.data_type.clone()),
                        target_type: Some(b.data_type.clone()),
                        source_nullable: Some(a.nullable),
                        target_nullable: Some(b.nullable),
                        source_default: a.default_value.clone(),
                        target_default: b.default_value.clone(),
                        source_extra: Some(a.extra.clone()),
                        target_extra: Some(b.extra.clone()),
                    });
                }
            }
        }
    }
    for b in cols_b {
        if !cols_a.iter().any(|a| a.name == b.name) {
            diffs.push(ColumnDiff {
                name: b.name.clone(),
                kind: "removed".into(),
                source_type: None,
                target_type: Some(b.data_type.clone()),
                source_nullable: None,
                target_nullable: Some(b.nullable),
                source_default: None,
                target_default: b.default_value.clone(),
                source_extra: None,
                target_extra: Some(b.extra.clone()),
            });
        }
    }
    diffs
}

fn diff_indexes(
    idx_a: &[crate::schema::model::Index],
    idx_b: &[crate::schema::model::Index],
) -> Vec<IndexDiff> {
    use crate::schema::model::Index;
    let map_b: HashMap<&str, &Index> = idx_b.iter().map(|i| (i.name.as_str(), i)).collect();
    let mut diffs = Vec::new();

    for a in idx_a {
        match map_b.get(a.name.as_str()) {
            None => diffs.push(IndexDiff {
                name: a.name.clone(),
                kind: "added".into(),
                source_columns: a.columns.clone(),
                target_columns: vec![],
                source_unique: Some(a.is_unique),
                target_unique: None,
            }),
            Some(b) => {
                let same_cols = a.columns == b.columns;
                let same_unique = a.is_unique == b.is_unique;
                if !same_cols || !same_unique {
                    diffs.push(IndexDiff {
                        name: a.name.clone(),
                        kind: "changed".into(),
                        source_columns: a.columns.clone(),
                        target_columns: b.columns.clone(),
                        source_unique: Some(a.is_unique),
                        target_unique: Some(b.is_unique),
                    });
                }
            }
        }
    }
    for b in idx_b {
        if !idx_a.iter().any(|a| a.name == b.name) {
            diffs.push(IndexDiff {
                name: b.name.clone(),
                kind: "removed".into(),
                source_columns: vec![],
                target_columns: b.columns.clone(),
                source_unique: None,
                target_unique: Some(b.is_unique),
            });
        }
    }
    diffs
}

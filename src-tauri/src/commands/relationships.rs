//! Tauri commands for the logical foreign key relationship analyzer.
//! All algorithms live in `crate::relationships` — these handlers only
//! fetch the pool, run the schema queries and persist verdicts.

use crate::connection::model::DatabaseType;
use crate::drivers::mysql::decode;
use crate::error::AppError;
use crate::relationships::infer::{
    generate_candidates, infer_relationships, infer_reverse_references, looks_like_fk_column,
    validate_candidate, ColumnSchema, TableSchema,
};
use crate::relationships::model::{
    Relationship, RelationshipSource, ReverseReference, StoredRelationship,
};
use crate::relationships::parse::parse_relationship_list;
use crate::state::AppState;
use serde::Serialize;
use sqlx::MySqlPool;
use std::collections::HashMap;
use uuid::Uuid;

async fn require_mysql_pool(
    state: &tauri::State<'_, AppState>,
    connection_id: &Uuid,
) -> Result<MySqlPool, AppError> {
    if state
        .get_config(connection_id)
        .await?
        .db_type
        != DatabaseType::Mysql
    {
        return Err(AppError::DriverNotSupported(
            "关系分析器暂仅支持 MySQL 连接".to_string(),
        ));
    }
    state
        .pool_manager
        .get(connection_id)
        .ok_or_else(|| AppError::ConnectionNotFound(connection_id.to_string()))
}

fn group_schema_rows(
    rows: &[sqlx::mysql::MySqlRow],
) -> Vec<TableSchema> {
    let mut tables: Vec<TableSchema> = Vec::new();
    for row in rows {
        let table_name = decode::sql_string(row, "TABLE_NAME");
        let column = ColumnSchema {
            name: decode::sql_string(row, "COLUMN_NAME"),
            data_type: decode::sql_string(row, "DATA_TYPE"),
            column_key: decode::sql_string(row, "COLUMN_KEY"),
        };
        match tables.last_mut() {
            Some(t) if t.name == table_name => t.columns.push(column),
            _ => tables.push(TableSchema {
                name: table_name,
                columns: vec![column],
            }),
        }
    }
    tables
}

/// Declared + adjudicated relationships for one table (no probing — cheap),
/// plus declared reverse references ("which tables point at me").
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RelationshipsOverview {
    pub relationships: Vec<Relationship>,
    pub referenced_by: Vec<ReverseReference>,
}

#[tauri::command]
pub async fn relationships_get(
    state: tauri::State<'_, AppState>,
    connection_id: Uuid,
    database: String,
    table: String,
) -> Result<RelationshipsOverview, AppError> {
    let pool = require_mysql_pool(&state, &connection_id).await?;

    let mut relationships: Vec<Relationship> = Vec::new();
    let push_unique = |rel: Relationship, out: &mut Vec<Relationship>| {
        let dup = out.iter().any(|r| {
            r.child_column.eq_ignore_ascii_case(&rel.child_column)
                && r.parent_table.eq_ignore_ascii_case(&rel.parent_table)
                && r.parent_column.eq_ignore_ascii_case(&rel.parent_column)
        });
        if !dup {
            out.push(rel);
        }
    };

    // Declared physical foreign keys.
    let declared = sqlx::query(
        "SELECT COLUMN_NAME, REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME \
         FROM information_schema.KEY_COLUMN_USAGE \
         WHERE REFERENCED_TABLE_SCHEMA = ? AND TABLE_NAME = ? \
           AND REFERENCED_TABLE_NAME IS NOT NULL",
    )
    .bind(&database)
    .bind(&table)
    .fetch_all(&pool)
    .await?;
    for row in &declared {
        push_unique(
            Relationship {
                child_table: table.clone(),
                child_column: decode::sql_string(row, "COLUMN_NAME"),
                parent_table: decode::sql_string(row, "REFERENCED_TABLE_NAME"),
                parent_column: decode::sql_string(row, "REFERENCED_COLUMN_NAME"),
                source: RelationshipSource::Declared,
                confidence: 1.0,
                join_hint: None,
            },
            &mut relationships,
        );
    }

    // Stored verdicts (imported lists + user adjudications).
    let stored = state.relationships_store.load(connection_id).await?;
    for entry in &stored.confirmed {
        if !entry
            .child_table
            .eq_ignore_ascii_case(&table)
            || stored
                .vetoed
                .iter()
                .any(|v| v.same_link(entry))
        {
            continue;
        }
        push_unique(
            Relationship {
                child_table: entry.child_table.clone(),
                child_column: entry.child_column.clone(),
                parent_table: entry.parent_table.clone(),
                parent_column: entry.parent_column.clone(),
                source: RelationshipSource::Adjudicated,
                confidence: 1.0,
                join_hint: entry.join_hint,
            },
            &mut relationships,
        );
    }

    // Declared reverse references, minus user vetoes.
    let rev_rows = sqlx::query(
        "SELECT TABLE_NAME, COLUMN_NAME, REFERENCED_COLUMN_NAME \
         FROM information_schema.KEY_COLUMN_USAGE \
         WHERE REFERENCED_TABLE_SCHEMA = ? AND REFERENCED_TABLE_NAME = ?",
    )
    .bind(&database)
    .bind(&table)
    .fetch_all(&pool)
    .await?;
    let referenced_by = rev_rows
        .iter()
        .map(|row| ReverseReference {
            child_table: decode::sql_string(row, "TABLE_NAME"),
            child_column: decode::sql_string(row, "COLUMN_NAME"),
            parent_column: decode::sql_string(row, "REFERENCED_COLUMN_NAME"),
            source: RelationshipSource::Declared,
            confidence: 1.0,
        })
        .collect();

    Ok(RelationshipsOverview {
        relationships,
        referenced_by,
    })
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportError {
    pub line: usize,
    pub reason: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportResult {
    pub imported: usize,
    /// Duplicate entries already in the store.
    pub skipped: usize,
    pub errors: Vec<ImportError>,
}

#[tauri::command]
pub async fn relationships_import(
    state: tauri::State<'_, AppState>,
    connection_id: Uuid,
    text: String,
) -> Result<ImportResult, AppError> {
    require_mysql_pool(&state, &connection_id).await?;
    let parsed = parse_relationship_list(&text);
    let result = state
        .relationships_store
        .import(connection_id, parsed.entries.clone())
        .await?;
    Ok(ImportResult {
        imported: result,
        skipped: parsed.entries.len() - result,
        errors: parsed
            .errors
            .into_iter()
            .map(|(line, reason)| ImportError { line, reason })
            .collect(),
    })
}

#[tauri::command]
pub async fn relationships_adjudicate(
    state: tauri::State<'_, AppState>,
    connection_id: Uuid,
    child_table: String,
    child_column: String,
    parent_table: String,
    parent_column: String,
    confirm: bool,
) -> Result<(), AppError> {
    require_mysql_pool(&state, &connection_id).await?;
    state
        .relationships_store
        .adjudicate(
            connection_id,
            StoredRelationship {
                child_table,
                child_column,
                parent_table,
                parent_column,
                join_hint: None,
            },
            confirm,
        )
        .await
}

/// Value-validate name-heuristic candidates for the browsed table.
/// `samples` = child column → distinct non-null values from the loaded page.
#[tauri::command]
pub async fn relationships_infer(
    state: tauri::State<'_, AppState>,
    connection_id: Uuid,
    database: String,
    table: String,
    samples: HashMap<String, Vec<serde_json::Value>>,
) -> Result<Vec<Relationship>, AppError> {
    let pool = require_mysql_pool(&state, &connection_id).await?;

    let rows = sqlx::query(
        "SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE, COLUMN_KEY \
         FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? \
         ORDER BY TABLE_NAME, ORDINAL_POSITION",
    )
    .bind(&database)
    .fetch_all(&pool)
    .await?;
    let tables = group_schema_rows(&rows);

    // Keep FK-ish columns only; dedupe and cap each sample list at 50.
    let mut prepared: HashMap<String, Vec<serde_json::Value>> = HashMap::new();
    for (col, values) in samples {
        if !looks_like_fk_column(&col, &tables) {
            continue;
        }
        let mut cleaned: Vec<serde_json::Value> = Vec::new();
        for v in values {
            let usable = !v.is_null()
                && !matches!(&v, serde_json::Value::String(s) if s.trim().is_empty());
            if usable && !cleaned.contains(&v) {
                cleaned.push(v);
            }
            if cleaned.len() >= 50 {
                break;
            }
        }
        if !cleaned.is_empty() {
            prepared.insert(col, cleaned);
        }
    }
    if prepared.is_empty() {
        return Ok(vec![]);
    }

    let stored = state.relationships_store.load(connection_id).await?;
    Ok(infer_relationships(
        &pool,
        &database,
        &table,
        &tables,
        &prepared,
        &stored.vetoed,
    )
    .await)
}

/// Live hit-rate probe for the manual relationship editor: share of the
/// sampled child values found in the chosen parent column. `None` = the
/// probe could not run (parent not readable, no samples).
#[tauri::command]
pub async fn relationships_probe(
    state: tauri::State<'_, AppState>,
    connection_id: Uuid,
    database: String,
    parent_table: String,
    parent_column: String,
    samples: Vec<serde_json::Value>,
) -> Result<Option<f64>, AppError> {
    let pool = require_mysql_pool(&state, &connection_id).await?;
    Ok(validate_candidate(&pool, &database, &parent_table, &parent_column, &samples).await)
}

/// Reverse inference for the safety net: scan the schema for indexed child
/// columns that name-match `table` and value-validate them against sampled
/// primary keys. Runs once per browsed table from the frontend.
#[tauri::command]
pub async fn relationships_reverse_infer(
    state: tauri::State<'_, AppState>,
    connection_id: Uuid,
    database: String,
    table: String,
    pk_column: String,
    samples: Vec<serde_json::Value>,
) -> Result<Vec<ReverseReference>, AppError> {
    let pool = require_mysql_pool(&state, &connection_id).await?;

    let rows = sqlx::query(
        "SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE, COLUMN_KEY \
         FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? \
         ORDER BY TABLE_NAME, ORDINAL_POSITION",
    )
    .bind(&database)
    .fetch_all(&pool)
    .await?;
    let tables = group_schema_rows(&rows);

    let mut cleaned: Vec<serde_json::Value> = Vec::new();
    for v in samples {
        let usable =
            !v.is_null() && !matches!(&v, serde_json::Value::String(s) if s.trim().is_empty());
        if usable && !cleaned.contains(&v) {
            cleaned.push(v);
        }
        if cleaned.len() >= 50 {
            break;
        }
    }

    let candidates =
        infer_reverse_references(&pool, &database, &table, &pk_column, &tables, &cleaned).await;
    let sample_count = cleaned.len().max(1);
    Ok(candidates
        .into_iter()
        .map(|c| ReverseReference {
            child_table: c.child_table,
            child_column: c.child_column,
            parent_column: pk_column.clone(),
            source: RelationshipSource::Inferred,
            confidence: (c.matched as f64 / sample_count as f64 * 100.0).round() / 100.0,
        })
        .collect())
}

// ---------------------------------------------------------------------------
// ER relationship map (M-ER): whole-database link graph for the canvas view.
// ---------------------------------------------------------------------------

/// Hard cap on heuristic candidate edges — pathological schemas (hundreds of
/// `_id`-suffixed columns) must not flood the map; real links rank first.
const MAX_CANDIDATE_EDGES: usize = 300;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ErMapColumn {
    pub name: String,
    pub data_type: String,
    pub primary_key: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ErMapTable {
    pub name: String,
    pub columns: Vec<ErMapColumn>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RelationshipsMap {
    pub tables: Vec<ErMapTable>,
    pub edges: Vec<Relationship>,
}

/// Whole-database relationship graph in one shot: base tables + columns
/// (primary-key flag included), physical foreign keys, stored adjudications
/// (vetoes removed), and unvalidated name-heuristic candidates. Candidates
/// carry `confidence: 0.0` — the canvas renders them dashed "?" until the
/// user probes / confirms / vetoes them.
#[tauri::command]
pub async fn relationships_map(
    state: tauri::State<'_, AppState>,
    connection_id: Uuid,
    database: String,
) -> Result<RelationshipsMap, AppError> {
    let pool = require_mysql_pool(&state, &connection_id).await?;

    // Base tables + columns (views never appear in information_schema.COLUMNS).
    let rows = sqlx::query(
        "SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE, COLUMN_KEY \
         FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? \
         ORDER BY TABLE_NAME, ORDINAL_POSITION",
    )
    .bind(&database)
    .fetch_all(&pool)
    .await?;
    let schemas = group_schema_rows(&rows);
    let tables: Vec<ErMapTable> = schemas
        .iter()
        .map(|t| ErMapTable {
            name: t.name.clone(),
            columns: t
                .columns
                .iter()
                .map(|c| ErMapColumn {
                    name: c.name.clone(),
                    data_type: c.data_type.clone(),
                    primary_key: c.column_key.eq_ignore_ascii_case("PRI"),
                })
                .collect(),
        })
        .collect();
    let known = |name: &str| {
        schemas
            .iter()
            .any(|t| t.name.eq_ignore_ascii_case(name))
    };

    let mut edges: Vec<Relationship> = Vec::new();
    let push_edge = |rel: Relationship, out: &mut Vec<Relationship>| {
        // Both endpoints must exist (stored verdicts can outlive a dropped table).
        if !known(&rel.child_table) || !known(&rel.parent_table) {
            return;
        }
        let dup = out.iter().any(|e| {
            e.child_table.eq_ignore_ascii_case(&rel.child_table)
                && e.child_column.eq_ignore_ascii_case(&rel.child_column)
                && e.parent_table.eq_ignore_ascii_case(&rel.parent_table)
                && e.parent_column.eq_ignore_ascii_case(&rel.parent_column)
        });
        if !dup {
            out.push(rel);
        }
    };

    // Physical foreign keys of the whole database.
    let fk_rows = sqlx::query(
        "SELECT TABLE_NAME, COLUMN_NAME, REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME \
         FROM information_schema.KEY_COLUMN_USAGE \
         WHERE REFERENCED_TABLE_SCHEMA = ? AND REFERENCED_TABLE_NAME IS NOT NULL",
    )
    .bind(&database)
    .fetch_all(&pool)
    .await?;
    for row in &fk_rows {
        push_edge(
            Relationship {
                child_table: decode::sql_string(row, "TABLE_NAME"),
                child_column: decode::sql_string(row, "COLUMN_NAME"),
                parent_table: decode::sql_string(row, "REFERENCED_TABLE_NAME"),
                parent_column: decode::sql_string(row, "REFERENCED_COLUMN_NAME"),
                source: RelationshipSource::Declared,
                confidence: 1.0,
                join_hint: None,
            },
            &mut edges,
        );
    }

    // Stored verdicts (imported lists + user adjudications), vetoes removed.
    let stored = state.relationships_store.load(connection_id).await?;
    for entry in &stored.confirmed {
        if stored.vetoed.iter().any(|v| v.same_link(entry)) {
            continue;
        }
        push_edge(
            Relationship {
                child_table: entry.child_table.clone(),
                child_column: entry.child_column.clone(),
                parent_table: entry.parent_table.clone(),
                parent_column: entry.parent_column.clone(),
                source: RelationshipSource::Adjudicated,
                confidence: 1.0,
                join_hint: entry.join_hint,
            },
            &mut edges,
        );
    }

    // Name-heuristic candidates, NOT value-validated (confidence 0 = "?").
    // A column that already carries a real link is not re-suggested, and a
    // vetoed link never comes back.
    let mut candidates: Vec<Relationship> = Vec::new();
    'tables: for t in &schemas {
        for col in &t.columns {
            if !looks_like_fk_column(&col.name, &schemas) {
                continue;
            }
            let linked = edges.iter().any(|e| {
                e.child_table.eq_ignore_ascii_case(&t.name)
                    && e.child_column.eq_ignore_ascii_case(&col.name)
            });
            if linked {
                continue;
            }
            for cand in generate_candidates(&schemas, &col.name, &t.name) {
                if stored.vetoed.iter().any(|v| {
                    v.same_link(&StoredRelationship {
                        child_table: t.name.clone(),
                        child_column: col.name.clone(),
                        parent_table: cand.table.name.clone(),
                        parent_column: cand.column.clone(),
                        join_hint: None,
                    })
                }) {
                    continue;
                }
                let rel = Relationship {
                    child_table: t.name.clone(),
                    child_column: col.name.clone(),
                    parent_table: cand.table.name.clone(),
                    parent_column: cand.column.clone(),
                    source: RelationshipSource::Inferred,
                    confidence: 0.0,
                    join_hint: None,
                };
                let dup = candidates.iter().any(|e| {
                    e.child_table.eq_ignore_ascii_case(&rel.child_table)
                        && e.child_column.eq_ignore_ascii_case(&rel.child_column)
                        && e.parent_table.eq_ignore_ascii_case(&rel.parent_table)
                });
                if !dup {
                    candidates.push(rel);
                    if candidates.len() >= MAX_CANDIDATE_EDGES {
                        break 'tables;
                    }
                }
            }
        }
    }
    candidates.sort_by(|a, b| {
        a.child_table
            .to_ascii_lowercase()
            .cmp(&b.child_table.to_ascii_lowercase())
            .then(a.child_column.to_ascii_lowercase().cmp(&b.child_column.to_ascii_lowercase()))
            .then(a.parent_table.to_ascii_lowercase().cmp(&b.parent_table.to_ascii_lowercase()))
    });
    edges.extend(candidates);

    Ok(RelationshipsMap { tables, edges })
}

/// Pure layered layout for the ER map — the only "smart" part of the canvas,
/// unit-tested in `relationships::layout`.
#[tauri::command]
pub async fn er_layout_compute(
    tables: Vec<crate::relationships::layout::LayoutTable>,
    edges: Vec<crate::relationships::layout::LayoutEdge>,
) -> Result<crate::relationships::layout::ErLayout, AppError> {
    Ok(crate::relationships::layout::er_layout(&tables, &edges))
}

//! Tauri commands for the logical foreign key relationship analyzer.
//! All algorithms live in `crate::relationships` — these handlers only
//! fetch the pool, run the schema queries and persist verdicts.

use crate::connection::model::DatabaseType;
use crate::drivers::mysql::decode;
use crate::error::AppError;
use crate::relationships::infer::{
    infer_relationships, looks_like_fk_column, ColumnSchema, TableSchema,
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
    let mut push_unique = |rel: Relationship, out: &mut Vec<Relationship>| {
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

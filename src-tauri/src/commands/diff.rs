use tauri::State;
use uuid::Uuid;

use crate::db::driver::*;
use crate::db::types::*;
use crate::error::Result;
use crate::state::AppState;

#[tauri::command]
pub async fn capture_snapshot(
    connection_id: String,
    database: String,
    _name: Option<String>,
    state: State<'_, AppState>,
) -> Result<DatabaseSnapshot> {
    let pool = state.pool_manager.get(&connection_id)
        .ok_or_else(|| crate::error::AppError::NotFound(format!("Connection {} not found", connection_id)))?;

    let mut snapshot = state.driver.capture_snapshot(&pool, &database).await?;
    snapshot.id = Uuid::new_v4().to_string();
    snapshot.connection_id = connection_id.clone();
    snapshot.captured_at = chrono::Utc::now().to_rfc3339();

    // Store in local database
    state.local_db.insert_snapshot(&snapshot).await
        .map_err(|e| crate::error::AppError::Database(e.to_string()))?;

    Ok(snapshot)
}

#[tauri::command]
pub async fn list_snapshots(
    connection_id: Option<String>,
    state: State<'_, AppState>,
) -> Result<Vec<DatabaseSnapshot>> {
    let snapshots = state.local_db.list_snapshots(connection_id.as_deref()).await
        .map_err(|e| crate::error::AppError::Database(e.to_string()))?;
    Ok(snapshots)
}

#[tauri::command]
pub async fn delete_snapshot(
    id: String,
    state: State<'_, AppState>,
) -> Result<()> {
    state.local_db.delete_snapshot(&id).await
        .map_err(|e| crate::error::AppError::Database(e.to_string()))?;
    Ok(())
}

#[tauri::command]
pub async fn compare_snapshots(
    from_id: String,
    to_id: String,
    state: State<'_, AppState>,
) -> Result<SchemaDiff> {
    let from = state.local_db.get_snapshot(&from_id).await
        .map_err(|e| crate::error::AppError::Database(e.to_string()))?
        .ok_or_else(|| crate::error::AppError::NotFound(format!("Snapshot {} not found", from_id)))?;
    let to = state.local_db.get_snapshot(&to_id).await
        .map_err(|e| crate::error::AppError::Database(e.to_string()))?
        .ok_or_else(|| crate::error::AppError::NotFound(format!("Snapshot {} not found", to_id)))?;

    let changes = diff_snapshots(&from, &to);
    Ok(SchemaDiff {
        from_snapshot_id: from_id,
        to_snapshot_id: to_id,
        changes,
    })
}

#[tauri::command]
pub async fn generate_migration_sql(
    diff: SchemaDiff,
) -> Result<Vec<String>> {
    Ok(generate_sql(&diff))
}

// --- Diff algorithm ---

fn diff_snapshots(from: &DatabaseSnapshot, to: &DatabaseSnapshot) -> Vec<SchemaChange> {
    let mut changes = Vec::new();

    // Diff tables
    let from_tables: std::collections::HashMap<_, _> = from.tables.iter().map(|t| (&t.table.name, t)).collect();
    let to_tables: std::collections::HashMap<_, _> = to.tables.iter().map(|t| (&t.table.name, t)).collect();

    for table_name in to_tables.keys() {
        if !from_tables.contains_key(table_name) {
            changes.push(SchemaChange::TableAdded {
                table: to_tables[table_name].clone(),
            });
        }
    }

    for table_name in from_tables.keys() {
        if !to_tables.contains_key(table_name) {
            changes.push(SchemaChange::TableDropped {
                table: from_tables[table_name].table.clone(),
            });
        }
    }

    for table_name in from_tables.keys().filter(|&n| to_tables.contains_key(n)) {
        let from_table = from_tables[table_name];
        let to_table = to_tables[table_name];
        let table_changes = diff_table(from_table, to_table);
        if !table_changes.columns_added.is_empty()
            || !table_changes.columns_dropped.is_empty()
            || !table_changes.columns_modified.is_empty()
            || !table_changes.indexes_added.is_empty()
            || !table_changes.indexes_dropped.is_empty()
            || !table_changes.foreign_keys_added.is_empty()
            || !table_changes.foreign_keys_dropped.is_empty()
        {
            changes.push(SchemaChange::TableModified {
                table_name: table_name.to_string(),
                columns_added: table_changes.columns_added,
                columns_dropped: table_changes.columns_dropped,
                columns_modified: table_changes.columns_modified,
                indexes_added: table_changes.indexes_added,
                indexes_dropped: table_changes.indexes_dropped,
                foreign_keys_added: table_changes.foreign_keys_added,
                foreign_keys_dropped: table_changes.foreign_keys_dropped,
            });
        }
    }

    // Diff views (simple existence diff)
    let from_views: std::collections::HashSet<_> = from.views.iter().map(|v| &v.name).collect();
    let to_views: std::collections::HashSet<_> = to.views.iter().map(|v| &v.name).collect();

    for view_name in &to_views {
        if !from_views.contains(view_name) {
            let view = to.views.iter().find(|v| &v.name == *view_name).unwrap().clone();
            changes.push(SchemaChange::ViewAdded { view });
        }
    }

    for view_name in &from_views {
        if !to_views.contains(view_name) {
            let view = from.views.iter().find(|v| &v.name == *view_name).unwrap().clone();
            changes.push(SchemaChange::ViewDropped { view });
        }
    }

    // Diff triggers (simple existence diff)
    let from_triggers: std::collections::HashSet<_> = from.triggers.iter().map(|t| &t.name).collect();
    let to_triggers: std::collections::HashSet<_> = to.triggers.iter().map(|t| &t.name).collect();

    for trigger_name in &to_triggers {
        if !from_triggers.contains(trigger_name) {
            let trigger = to.triggers.iter().find(|t| &t.name == *trigger_name).unwrap().clone();
            changes.push(SchemaChange::TriggerAdded { trigger });
        }
    }

    for trigger_name in &from_triggers {
        if !to_triggers.contains(trigger_name) {
            let trigger = from.triggers.iter().find(|t| &t.name == *trigger_name).unwrap().clone();
            changes.push(SchemaChange::TriggerDropped { trigger });
        }
    }

    changes
}

struct TableDiff {
    columns_added: Vec<ColumnInfo>,
    columns_dropped: Vec<ColumnInfo>,
    columns_modified: Vec<ColumnInfo>,
    indexes_added: Vec<IndexInfo>,
    indexes_dropped: Vec<IndexInfo>,
    foreign_keys_added: Vec<ForeignKeyInfo>,
    foreign_keys_dropped: Vec<ForeignKeyInfo>,
}

fn diff_table(from: &TableDetail, to: &TableDetail) -> TableDiff {
    let mut diff = TableDiff {
        columns_added: Vec::new(),
        columns_dropped: Vec::new(),
        columns_modified: Vec::new(),
        indexes_added: Vec::new(),
        indexes_dropped: Vec::new(),
        foreign_keys_added: Vec::new(),
        foreign_keys_dropped: Vec::new(),
    };

    // Columns
    let from_cols: std::collections::HashMap<_, _> = from.columns.iter().map(|c| (&c.name, c)).collect();
    let to_cols: std::collections::HashMap<_, _> = to.columns.iter().map(|c| (&c.name, c)).collect();

    for col_name in to_cols.keys() {
        if !from_cols.contains_key(col_name) {
            diff.columns_added.push(to_cols[col_name].clone());
        }
    }

    for col_name in from_cols.keys() {
        if !to_cols.contains_key(col_name) {
            diff.columns_dropped.push(from_cols[col_name].clone());
        }
    }

    for col_name in from_cols.keys().filter(|&n| to_cols.contains_key(n)) {
        let from_col = from_cols[col_name];
        let to_col = to_cols[col_name];
        if !columns_equal(from_col, to_col) {
            diff.columns_modified.push(to_col.clone());
        }
    }

    // Indexes
    let from_idx: std::collections::HashSet<_> = from.indexes.iter().map(index_key).collect();
    let to_idx: std::collections::HashSet<_> = to.indexes.iter().map(index_key).collect();

    for idx in &to.indexes {
        if !from_idx.contains(&index_key(idx)) {
            diff.indexes_added.push(idx.clone());
        }
    }

    for idx in &from.indexes {
        if !to_idx.contains(&index_key(idx)) {
            diff.indexes_dropped.push(idx.clone());
        }
    }

    // Foreign keys
    let from_fk: std::collections::HashSet<_> = from.foreign_keys.iter().map(fk_key).collect();
    let to_fk: std::collections::HashSet<_> = to.foreign_keys.iter().map(fk_key).collect();

    for fk in &to.foreign_keys {
        if !from_fk.contains(&fk_key(fk)) {
            diff.foreign_keys_added.push(fk.clone());
        }
    }

    for fk in &from.foreign_keys {
        if !to_fk.contains(&fk_key(fk)) {
            diff.foreign_keys_dropped.push(fk.clone());
        }
    }

    diff
}

fn columns_equal(a: &ColumnInfo, b: &ColumnInfo) -> bool {
    a.name == b.name
        && a.type_name == b.type_name
        && a.nullable == b.nullable
        && a.is_primary_key == b.is_primary_key
        && a.auto_increment == b.auto_increment
        && a.default_value == b.default_value
}

fn index_key(idx: &IndexInfo) -> String {
    format!("{}|{}|{}", idx.name, idx.is_unique, idx.columns.join(","))
}

fn fk_key(fk: &ForeignKeyInfo) -> String {
    format!("{}|{}|{}|{}", fk.name, fk.column_name, fk.referenced_table, fk.referenced_column)
}

// --- SQL generation ---

fn generate_sql(diff: &SchemaDiff) -> Vec<String> {
    let mut sqls = Vec::new();

    for change in &diff.changes {
        match change {
            SchemaChange::TableAdded { table } => {
                sqls.push(table.create_sql.clone());
            }
            SchemaChange::TableDropped { table } => {
                sqls.push(format!("DROP TABLE `{}`", table.name));
            }
            SchemaChange::TableModified {
                table_name,
                columns_added,
                columns_dropped,
                columns_modified,
                indexes_added,
                indexes_dropped,
                foreign_keys_added,
                foreign_keys_dropped,
            } => {
                for col in columns_added {
                    sqls.push(format!("ALTER TABLE `{}` ADD COLUMN `{}` {}", table_name, col.name, column_type(col)));
                }
                for col in columns_dropped {
                    sqls.push(format!("ALTER TABLE `{}` DROP COLUMN `{}`", table_name, col.name));
                }
                for col in columns_modified {
                    sqls.push(format!("ALTER TABLE `{}` MODIFY COLUMN `{}` {}", table_name, col.name, column_type(col)));
                }
                for idx in indexes_dropped {
                    if idx.is_primary {
                        sqls.push(format!("ALTER TABLE `{}` DROP PRIMARY KEY", table_name));
                    } else {
                        sqls.push(format!("ALTER TABLE `{}` DROP INDEX `{}`", table_name, idx.name));
                    }
                }
                for idx in indexes_added {
                    if idx.is_primary {
                        sqls.push(format!("ALTER TABLE `{}` ADD PRIMARY KEY ({})", table_name, idx.columns.join(", ")));
                    } else {
                        let unique = if idx.is_unique { "UNIQUE " } else { "" };
                        sqls.push(format!("ALTER TABLE `{}` ADD {}INDEX `{}` ({})", table_name, unique, idx.name, idx.columns.join(", ")));
                    }
                }
                for fk in foreign_keys_dropped {
                    sqls.push(format!("ALTER TABLE `{}` DROP FOREIGN KEY `{}`", table_name, fk.name));
                }
                for fk in foreign_keys_added {
                    sqls.push(format!("ALTER TABLE `{}` ADD CONSTRAINT `{}` FOREIGN KEY (`{}`) REFERENCES `{}` (`{}`) ON DELETE {} ON UPDATE {}",
                        table_name, fk.name, fk.column_name, fk.referenced_table, fk.referenced_column, fk.on_delete, fk.on_update));
                }
            }
            SchemaChange::ViewAdded { view } => {
                // TODO: need view definition SQL; for now just placeholder
                sqls.push(format!("-- CREATE VIEW `{}` AS ...", view.name));
            }
            SchemaChange::ViewDropped { view } => {
                sqls.push(format!("DROP VIEW `{}`", view.name));
            }
            SchemaChange::TriggerAdded { trigger } => {
                // TODO: need trigger definition SQL
                sqls.push(format!("-- CREATE TRIGGER `{}` ...", trigger.name));
            }
            SchemaChange::TriggerDropped { trigger } => {
                sqls.push(format!("DROP TRIGGER `{}`", trigger.name));
            }
        }
    }

    sqls
}

fn column_type(col: &ColumnInfo) -> String {
    let mut s = col.type_name.clone();
    if !col.nullable {
        s.push_str(" NOT NULL");
    }
    if col.auto_increment {
        s.push_str(" AUTO_INCREMENT");
    }
    if let Some(default) = &col.default_value {
        s.push_str(&format!(" DEFAULT '{}'", default));
    }
    s
}
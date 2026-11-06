//! Relationship (logical foreign key) data model.
//!
//! Modern MySQL schemas rarely declare physical FOREIGN KEYs — relations are
//! maintained by the application layer. This module models the logical link
//! graph DBDog builds from four sources, highest confidence first:
//! declared FK → user adjudication → imported lists → name+value inference.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum RelationshipSource {
    /// Physical FOREIGN KEY found in information_schema.
    Declared,
    /// Imported from a user-maintained relationship list.
    Imported,
    /// Explicitly confirmed by the user.
    Adjudicated,
    /// Name heuristic + value validation by the analyzer.
    Inferred,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum JoinHint {
    Left,
    Right,
}

/// One logical foreign key: child_table.child_column → parent_table.parent_column.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Relationship {
    pub child_table: String,
    pub child_column: String,
    pub parent_table: String,
    pub parent_column: String,
    pub source: RelationshipSource,
    /// 0.0–1.0. Declared/imported/adjudicated are 1.0; inferred carries the
    /// value-validation hit rate (≥ 0.8 to be shown as a link).
    pub confidence: f64,
    /// JOIN type preference from an imported list (`[LEFT]`/`[RIGHT]`).
    pub join_hint: Option<JoinHint>,
}

/// A stored (persisted) relationship entry — imported lists and user
/// adjudications. Matched case-insensitively against live schema names.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredRelationship {
    pub child_table: String,
    pub child_column: String,
    pub parent_table: String,
    pub parent_column: String,
    #[serde(default)]
    pub join_hint: Option<JoinHint>,
}

/// Per-connection persisted relationship data
/// (app_data_dir/relationships/<connectionId>.json).
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RelationshipStoreData {
    /// Imported entries + user-confirmed links.
    #[serde(default)]
    pub confirmed: Vec<StoredRelationship>,
    /// User-vetoed links — never suggested again, matched case-insensitively.
    #[serde(default)]
    pub vetoed: Vec<StoredRelationship>,
}

/// A child table/column referencing the table being browsed (reverse ref).
/// `parent_column` is the column of OUR table being referenced (usually the
/// primary key) — needed to build the child-side WHERE clause.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReverseReference {
    pub child_table: String,
    pub child_column: String,
    pub parent_column: String,
    pub source: RelationshipSource,
}

impl StoredRelationship {
    /// Case-insensitive identity match (MySQL identifiers compare this way).
    pub fn same_link(&self, other: &StoredRelationship) -> bool {
        self.child_table.eq_ignore_ascii_case(&other.child_table)
            && self.child_column.eq_ignore_ascii_case(&other.child_column)
            && self.parent_table.eq_ignore_ascii_case(&other.parent_table)
            && self.parent_column.eq_ignore_ascii_case(&other.parent_column)
    }
}

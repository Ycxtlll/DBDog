//! Parser for user-maintained relationship lists (the bitanswer format):
//!
//! ```text
//! # comment
//! t_auth.fk_Product -> t_products.productID
//! t_customer.fk_CustomerGroupID -> t_customergroup.id  [LEFT]
//! ```
//!
//! `[LEFT]`/`[RIGHT]` are optional JOIN hints for relation expansion. Parsing
//! is deliberately forgiving: comments, blank lines and malformed lines are
//! reported, everything else is kept so a hand-maintained file imports as a
//! whole.

use super::model::{JoinHint, StoredRelationship};

pub struct ParsedList {
    pub entries: Vec<StoredRelationship>,
    /// (1-based line number, reason) for lines that could not be parsed.
    pub errors: Vec<(usize, String)>,
}

/// Parse a `table.column -> table.column [LEFT|RIGHT]?` list.
pub fn parse_relationship_list(text: &str) -> ParsedList {
    let mut entries = Vec::new();
    let mut errors = Vec::new();
    for (idx, raw) in text.lines().enumerate() {
        let line = raw.trim();
        if line.is_empty() || line.starts_with('#') || line.starts_with("//") {
            continue;
        }
        let (arrow_left, arrow_right) = match line.split_once("->") {
            Some(parts) => parts,
            None => {
                errors.push((idx + 1, format!("missing '->': {line}")));
                continue;
            }
        };
        let (child_table, child_column) = match parse_qualified(arrow_left.trim()) {
            Some(parts) => parts,
            None => {
                errors.push((idx + 1, format!("left side is not table.column: {line}")));
                continue;
            }
        };
        let right = arrow_right.trim();
        // Trailing [LEFT]/[RIGHT] hint.
        let (right_main, join_hint) = match right.rfind('[') {
            Some(pos) if right.ends_with(']') => {
                let hint_raw = right[pos + 1..right.len() - 1].trim().to_ascii_uppercase();
                let hint = match hint_raw.as_str() {
                    "LEFT" => Some(JoinHint::Left),
                    "RIGHT" => Some(JoinHint::Right),
                    _ => {
                        errors.push((idx + 1, format!("unknown join hint: {line}")));
                        None
                    }
                };
                (right[..pos].trim(), hint)
            }
            _ => (right, None),
        };
        let (parent_table, parent_column) = match parse_qualified(right_main) {
            Some(parts) => parts,
            None => {
                errors.push((idx + 1, format!("right side is not table.column: {line}")));
                continue;
            }
        };
        entries.push(StoredRelationship {
            child_table: child_table.to_string(),
            child_column: child_column.to_string(),
            parent_table: parent_table.to_string(),
            parent_column: parent_column.to_string(),
            join_hint,
        });
    }
    ParsedList { entries, errors }
}

/// Split "table.column" at the last dot (schema-qualified names keep working:
/// `db.table.col` → table "db.table"… actually MySQL USE db makes bare names
/// the norm; last-dot split handles the common case and both-side names are
/// validated against the live schema later anyway).
fn parse_qualified(s: &str) -> Option<(&str, &str)> {
    let (t, c) = s.rsplit_once('.')?;
    let t = t.trim();
    let c = c.trim();
    if t.is_empty() || c.is_empty() {
        return None;
    }
    Some((t, c))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_bitanswer_style_list() {
        let text = "\
# comment line
t_auth.fk_Product -> t_products.productID
t_customer.fk_CustomerGroupID -> t_customergroup.id  [LEFT]
t_featuregroupitems.uid -> t_productfeatures.featureId  [RIGHT]
t_snlog.fk_midid -> t_mid.midId
malformed line without arrow
t_x.y -> no-dot-here
";
        let parsed = parse_relationship_list(text);
        assert_eq!(parsed.entries.len(), 4);
        assert_eq!(parsed.errors.len(), 2);
        assert_eq!(parsed.errors[0].0, 6);

        let first = &parsed.entries[0];
        assert_eq!(first.child_table, "t_auth");
        assert_eq!(first.child_column, "fk_Product");
        assert_eq!(first.parent_table, "t_products");
        assert_eq!(first.parent_column, "productID");
        assert!(first.join_hint.is_none());

        assert!(matches!(
            parsed.entries[1].join_hint,
            Some(JoinHint::Left)
        ));
        assert!(matches!(
            parsed.entries[2].join_hint,
            Some(JoinHint::Right)
        ));
    }

    #[test]
    fn skips_comments_and_blank_lines() {
        let parsed = parse_relationship_list("\n# c1\n   \n// c2\na.b -> c.d\n");
        assert_eq!(parsed.entries.len(), 1);
        assert!(parsed.errors.is_empty());
    }

    #[test]
    fn unknown_hint_is_reported_but_entry_kept() {
        let parsed = parse_relationship_list("a.b -> c.d [FULL]\n");
        assert_eq!(parsed.entries.len(), 1);
        assert!(parsed.entries[0].join_hint.is_none());
        assert_eq!(parsed.errors.len(), 1);
    }
}

//! Logical foreign key inference: name heuristics generate candidate links,
//! value validation against parent primary keys accepts or rejects them.
//! Pure helpers (candidates, name normalization) are unit-tested; probing
//! talks to MySQL through the connection pool.

use super::model::{Relationship, RelationshipSource, StoredRelationship};
use crate::drivers::mysql::decode;
use crate::utils::escape_mysql_identifier;
use serde::Serialize;
use sqlx::MySqlPool;
use std::collections::HashMap;

/// Minimal column info the analyzer needs (from information_schema.COLUMNS).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ColumnSchema {
    pub name: String,
    pub data_type: String,
    /// information_schema COLUMN_KEY: "PRI" / "UNI" / "" ("MUL" is ignored —
    /// it says nothing about uniqueness of the referenced side).
    pub column_key: String,
}

/// Minimal table info.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TableSchema {
    pub name: String,
    pub columns: Vec<ColumnSchema>,
}

/// Normalize an identifier for comparison: lowercase, underscores dropped
/// (`fk_SnId` and `sn_id` both → "snid").
fn norm(s: &str) -> String {
    s.to_ascii_lowercase().replace('_', "")
}

/// Comparison keys for a table name: the normalized name plus, for the
/// `t_`-prefixed convention (bitanswer et al.), the bare name.
pub fn table_name_keys(table: &str) -> Vec<String> {
    let mut keys = vec![norm(table)];
    if let Some(rest) = table.strip_prefix("t_") {
        if !rest.is_empty() {
            keys.push(norm(rest));
        }
    }
    keys
}

/// Base words a child column name could have derived from: the column name
/// with a `fk_` prefix stripped, plus a shorter form after dropping a
/// trailing id/no/code/key/guid (only when ≥2 chars remain, so `uid` does
/// not decay into `u` but `snid` still yields `sn`).
pub fn child_column_bases(child_column: &str) -> Vec<String> {
    let lower = child_column.to_ascii_lowercase();
    let stripped_fk = lower.strip_prefix("fk_").unwrap_or(&lower).to_string();
    let mut bases = vec![stripped_fk.clone(), lower.clone()];
    for suffix in ["guid", "code", "key", "no", "id"] {
        if let Some(head) = stripped_fk.strip_suffix(suffix) {
            if head.len() >= 2 {
                bases.push(head.to_string());
            }
            break;
        }
    }
    let mut seen = std::collections::HashSet::new();
    bases.retain(|b| seen.insert(b.clone()));
    bases
}

/// Does this column name look FK-ish at all? Gates probing so arbitrary
/// columns (names, notes, blobs) never generate probes.
pub fn looks_like_fk_column(child_column: &str, tables: &[TableSchema]) -> bool {
    let lower = child_column.to_ascii_lowercase();
    if lower.starts_with("fk_") {
        return true;
    }
    for suffix in ["id", "no", "code", "key", "guid"] {
        if lower.ends_with(suffix) {
            return true;
        }
    }
    let n = norm(child_column);
    tables
        .iter()
        .any(|t| table_name_keys(&t.name).contains(&n))
}

/// Parent column candidates inside a matched parent table, best first:
/// primary keys, then name-similar columns (base+"id", the raw child column
/// name), then unique columns. Capped at 3 to bound probing.
pub fn parent_column_candidates(
    table: &TableSchema,
    bases: &[String],
    child_column: &str,
) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    let push = |c: &ColumnSchema, out: &mut Vec<String>| {
        if !out.iter().any(|x| x.eq_ignore_ascii_case(&c.name)) {
            out.push(c.name.clone());
        }
    };
    for c in &table.columns {
        if c.column_key.eq_ignore_ascii_case("PRI") {
            push(c, &mut out);
        }
    }
    let child_n = norm(child_column);
    let base_norms: Vec<String> = bases.iter().map(|b| norm(b)).collect();
    for c in &table.columns {
        let cn = norm(&c.name);
        if base_norms
            .iter()
            .any(|b| cn == *b || cn == format!("{b}id"))
            || cn == child_n
        {
            push(c, &mut out);
        }
    }
    for c in &table.columns {
        if c.column_key.eq_ignore_ascii_case("UNI") {
            push(c, &mut out);
        }
    }
    out.truncate(3);
    out
}

pub struct Candidate<'a> {
    pub table: &'a TableSchema,
    pub column: String,
}

/// Match a child column against the schema: candidate parent tables by name
/// (singular/plural, `t_` prefix), then candidate parent columns inside.
pub fn generate_candidates<'a>(
    tables: &'a [TableSchema],
    child_column: &str,
    child_table: &str,
) -> Vec<Candidate<'a>> {
    let bases = child_column_bases(child_column);
    let matches_name = |key: &str| {
        bases
            .iter()
            .any(|b| key == *b || key == format!("{b}s") || key == format!("{b}es"))
    };
    let mut out = Vec::new();
    for table in tables {
        if table.name.eq_ignore_ascii_case(child_table) {
            continue;
        }
        if table_name_keys(&table.name).iter().any(|k| matches_name(k)) {
            for column in parent_column_candidates(table, &bases, child_column) {
                out.push(Candidate { table, column });
            }
        }
    }
    out
}

fn is_vetoed(
    vetoed: &[StoredRelationship],
    child_table: &str,
    child_column: &str,
    parent_table: &str,
    parent_column: &str,
) -> bool {
    vetoed.iter().any(|v| {
        v.child_table.eq_ignore_ascii_case(child_table)
            && v.child_column.eq_ignore_ascii_case(child_column)
            && v.parent_table.eq_ignore_ascii_case(parent_table)
            && v.parent_column.eq_ignore_ascii_case(parent_column)
    })
}

/// Share of `samples` found in the parent column. `None` = probe failed or
/// nothing to compare (caller treats as "no evidence", not an error).
async fn validate_candidate(
    pool: &MySqlPool,
    database: &str,
    table: &str,
    column: &str,
    samples: &[serde_json::Value],
) -> Option<f64> {
    if samples.is_empty() {
        return None;
    }
    let placeholders = vec!["?"; samples.len()].join(", ");
    let sql = format!(
        "SELECT COUNT(*) AS m FROM {}.{} WHERE {} IN ({placeholders})",
        escape_mysql_identifier(database),
        escape_mysql_identifier(table),
        escape_mysql_identifier(column),
    );
    let mut query = sqlx::query(&sql);
    for v in samples {
        query = match v {
            serde_json::Value::Number(n) => match n.as_i64() {
                Some(i) => query.bind(i),
                None => query.bind(n.as_f64().unwrap_or(0.0)),
            },
            serde_json::Value::Bool(b) => query.bind(if *b { 1i64 } else { 0i64 }),
            other => query.bind(match other {
                serde_json::Value::String(s) => s.clone(),
                _ => other.to_string(),
            }),
        };
    }
    let row = query.fetch_one(pool).await.ok()?;
    let matched = decode::sql_opt_u64(&row, "m").unwrap_or(0);
    Some(matched as f64 / samples.len() as f64)
}

/// Infer validated logical foreign keys for the browsed table.
///
/// `samples` maps child column → up to ~50 distinct non-null values from the
/// loaded grid page (zero extra queries on the child side). Only FK-ish
/// columns are probed; each column tries at most 4 candidates; the whole call
/// is capped at 60 probes. A candidate becomes a relationship at ≥ 80% hit
/// rate (the plan threshold); user vetoes suppress candidates permanently.
pub async fn infer_relationships(
    pool: &MySqlPool,
    database: &str,
    child_table: &str,
    tables: &[TableSchema],
    samples: &HashMap<String, Vec<serde_json::Value>>,
    vetoed: &[StoredRelationship],
) -> Vec<Relationship> {
    let mut rels = Vec::new();
    let mut probes = 0usize;
    for (col, values) in samples {
        if !looks_like_fk_column(col, tables) {
            continue;
        }
        let mut candidates = generate_candidates(tables, col, child_table);
        candidates.retain(|c| {
            !is_vetoed(vetoed, child_table, col, &c.table.name, &c.column)
        });
        candidates.truncate(4);
        for candidate in candidates {
            if probes >= 60 {
                return rels;
            }
            probes += 1;
            if let Some(rate) = validate_candidate(
                pool,
                database,
                &candidate.table.name,
                &candidate.column,
                values,
            )
            .await
            {
                if rate >= 0.8 {
                    rels.push(Relationship {
                        child_table: child_table.to_string(),
                        child_column: col.clone(),
                        parent_table: candidate.table.name.clone(),
                        parent_column: candidate.column.clone(),
                        source: RelationshipSource::Inferred,
                        confidence: (rate * 100.0).round() / 100.0,
                        join_hint: None,
                    });
                }
            }
        }
    }
    rels
}

#[cfg(test)]
mod tests {
    use super::*;

    fn table(name: &str, cols: &[(&str, &str, &str)]) -> TableSchema {
        TableSchema {
            name: name.to_string(),
            columns: cols
                .iter()
                .map(|(n, t, k)| ColumnSchema {
                    name: n.to_string(),
                    data_type: t.to_string(),
                    column_key: k.to_string(),
                })
                .collect(),
        }
    }

    fn schema() -> Vec<TableSchema> {
        vec![
            table("t_products", &[("productID", "int", "PRI"), ("name", "varchar", "")]),
            table("t_sn", &[("snID", "int", "PRI"), ("status", "int", "")]),
            table("t_customergroup", &[("id", "int", "PRI")]),
            table("t_business", &[("id", "int", "PRI"), ("developerID", "int", "")]),
        ]
    }

    fn candidate_pairs(cols: &str, tables: &[TableSchema]) -> Vec<(String, String)> {
        generate_candidates(tables, cols, "t_current")
            .into_iter()
            .map(|c| (c.table.name.clone(), c.column))
            .collect()
    }

    #[test]
    fn bases_handle_fk_prefix_and_trailing_id() {
        assert_eq!(child_column_bases("fk_snid"), vec!["snid", "fk_snid", "sn"]);
        assert_eq!(child_column_bases("fk_SnId")[2], "sn");
        assert_eq!(child_column_bases("fk_CustomerGroupID")[2], "customergroup");
        // uid must NOT decay to "u"
        assert_eq!(child_column_bases("uid"), vec!["uid"]);
    }

    #[test]
    fn fk_product_matches_t_products_productid() {
        let pairs = candidate_pairs("fk_Product", &schema());
        assert_eq!(pairs, vec![("t_products".to_string(), "productID".to_string())]);
    }

    #[test]
    fn fk_snid_matches_t_sn_snid_case_insensitively() {
        for col in ["fk_snid", "fk_SnId", "fk_snID", "fk_snmachineid"] {
            let pairs = candidate_pairs(col, &schema());
            if col == "fk_snmachineid" {
                // no t_snmachine in this mini schema — must find nothing
                assert!(pairs.is_empty(), "{col} unexpectedly matched {pairs:?}");
            } else {
                assert!(
                    pairs.iter().any(|(t, c)| t == "t_sn" && c.eq_ignore_ascii_case("snID")),
                    "{col} did not match t_sn.snID: {pairs:?}"
                );
            }
        }
    }

    #[test]
    fn singular_column_matches_plural_table() {
        let pairs = candidate_pairs("fk_CustomerGroupID", &schema());
        assert!(pairs.contains(&("t_customergroup".to_string(), "id".to_string())));
    }

    #[test]
    fn uid_finds_nothing_without_matching_table() {
        assert!(candidate_pairs("uid", &schema()).is_empty());
    }

    #[test]
    fn fkish_gate() {
        let s = schema();
        assert!(looks_like_fk_column("fk_Product", &s));
        assert!(looks_like_fk_column("order_id", &s));
        assert!(looks_like_fk_column("uid", &s));
        assert!(!looks_like_fk_column("remark", &s));
        assert!(!looks_like_fk_column("created_at", &s));
    }
}

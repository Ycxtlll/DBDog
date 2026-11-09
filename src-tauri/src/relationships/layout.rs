//! Layered (Sugiyama-lite) layout for the ER relationship map (M-ER).
//!
//! Pure geometry: table names + edge list in, deterministic coordinates out —
//! no DB access, no RNG. Parents rank above children (links point up),
//! layers are ordered by barycenter sweeps to reduce crossings, and tables
//! without any relationship are parked in an "isolated" grid below the main
//! graph — exactly the completion targets the map exists to expose.
//!
//! Determinism matters: the same schema must always produce the same map,
//! or the canvas jumps around between opens.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Card geometry — the TS canvas renders cards with the same constants so
/// the layout's slot arithmetic and the drawn boxes always agree.
pub const CARD_WIDTH: f64 = 210.0;
const CARD_GAP_X: f64 = 36.0;
const LAYER_GAP_Y: f64 = 56.0;
const MARGIN: f64 = 40.0;
const ISOLATED_PER_ROW: usize = 8;
const ISOLATED_ROW_GAP: f64 = 24.0;
const MIN_CARD_HEIGHT: f64 = 96.0;
/// Barycenter sweep cycles (down + up each) — 2 cuts most crossings.
const SWEEP_CYCLES: usize = 2;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LayoutTable {
    pub name: String,
    /// Rendered card height (computed by the canvas from the column list).
    pub height: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LayoutEdge {
    pub child_table: String,
    pub parent_table: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LayoutNode {
    pub table: String,
    pub x: f64,
    pub y: f64,
    /// Layer rank, 0 = top (pure parent tables).
    pub layer: usize,
    /// No relationships at all — parked in the isolated zone.
    pub isolated: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ErLayout {
    pub nodes: Vec<LayoutNode>,
    pub width: f64,
    pub height: f64,
}

/// Longest-path layering with cycle safety: `layer_of[i]` doubles as the
/// memo (usize::MAX = unvisited); a back-edge into the current DFS stack
/// contributes rank 0, so mutual references terminate deterministically.
fn rank_of(
    i: usize,
    parents_of: &[Vec<usize>],
    layer_of: &mut [usize],
    visiting: &mut [bool],
) -> usize {
    if layer_of[i] != usize::MAX {
        return layer_of[i];
    }
    if visiting[i] {
        return 0;
    }
    visiting[i] = true;
    let mut rank = 0;
    for &p in &parents_of[i] {
        rank = rank.max(rank_of(p, parents_of, layer_of, visiting) + 1);
    }
    visiting[i] = false;
    layer_of[i] = rank;
    rank
}

/// Mean of neighbor x positions; nodes without placed neighbors keep their
/// current x (standard fallback so unconnected cards don't drift).
fn barycenter(neighbors: &[usize], xs: &[f64], own: f64) -> f64 {
    if neighbors.is_empty() {
        return own;
    }
    neighbors.iter().map(|&n| xs[n]).sum::<f64>() / neighbors.len() as f64
}

/// Compute the layered layout. Same input → same output, always.
pub fn er_layout(tables: &[LayoutTable], edges: &[LayoutEdge]) -> ErLayout {
    if tables.is_empty() {
        return ErLayout {
            nodes: Vec::new(),
            width: 0.0,
            height: 0.0,
        };
    }

    // Case-insensitive name → index (MySQL identifiers compare this way).
    let mut index: HashMap<String, usize> = HashMap::new();
    for (i, t) in tables.iter().enumerate() {
        index.entry(t.name.to_ascii_lowercase()).or_insert(i);
    }

    // Adjacency over edges whose both endpoints exist; self-loops and
    // duplicate table pairs dropped — ranking only cares about the shape.
    let mut parents_of: Vec<Vec<usize>> = vec![Vec::new(); tables.len()];
    let mut children_of: Vec<Vec<usize>> = vec![Vec::new(); tables.len()];
    let mut has_edge = vec![false; tables.len()];
    for e in edges {
        let child = index
            .get(e.child_table.to_ascii_lowercase().as_str())
            .copied();
        let parent = index
            .get(e.parent_table.to_ascii_lowercase().as_str())
            .copied();
        let (Some(c), Some(p)) = (child, parent) else {
            continue;
        };
        if c == p || parents_of[c].contains(&p) {
            continue;
        }
        parents_of[c].push(p);
        children_of[p].push(c);
        has_edge[c] = true;
        has_edge[p] = true;
    }

    // Layer ranks.
    let mut layer_of = vec![usize::MAX; tables.len()];
    let mut visiting = vec![false; tables.len()];
    for i in 0..tables.len() {
        rank_of(i, &parents_of, &mut layer_of, &mut visiting);
    }

    // Group into layers, initial order by name (deterministic seed).
    let mut layer_count = 0usize;
    for &l in &layer_of {
        layer_count = layer_count.max(l + 1);
    }
    let mut layers: Vec<Vec<usize>> = vec![Vec::new(); layer_count];
    for (i, &l) in layer_of.iter().enumerate() {
        layers[l].push(i);
    }
    for layer in &mut layers {
        layer.sort_by(|&a, &b| {
            tables[a]
                .name
                .to_ascii_lowercase()
                .cmp(&tables[b].name.to_ascii_lowercase())
                .then(a.cmp(&b))
        });
    }

    let slot_x = |slot: usize| MARGIN + slot as f64 * (CARD_WIDTH + CARD_GAP_X);
    let mut xs = vec![0.0f64; tables.len()];
    for layer in &layers {
        for (slot, &i) in layer.iter().enumerate() {
            xs[i] = slot_x(slot);
        }
    }

    // Alternating barycenter sweeps: down by parents, up by children, two
    // full cycles. Each sweep re-orders layers by the mean position of the
    // neighbors settled in the previous sweep — repetition pulls tangled
    // graphs toward far fewer edge crossings while staying deterministic
    // (every ordering decision falls back to the table name).
    let name_key = |i: usize| tables[i].name.to_ascii_lowercase();
    let sweep = |layers: &[Vec<usize>], neighbors: &[Vec<usize>], xs: &mut [f64]| {
        for layer in layers {
            let mut keyed: Vec<(f64, usize)> = layer
                .iter()
                .map(|&i| (barycenter(&neighbors[i], xs, xs[i]), i))
                .collect();
            keyed.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap_or(std::cmp::Ordering::Equal).then(name_key(a.1).cmp(&name_key(b.1))));
            for (slot, &(_, i)) in keyed.iter().enumerate() {
                xs[i] = slot_x(slot);
            }
        }
    };
    for _ in 0..SWEEP_CYCLES {
        sweep(&layers[1..], &parents_of, &mut xs);
        if layer_count > 1 {
            sweep(&layers[..layer_count - 1], &children_of, &mut xs);
        }
    }

    // Y positions: each layer sits below the tallest card of the layer above.
    let mut ys = vec![0.0f64; tables.len()];
    let mut cursor = MARGIN;
    let mut main_width = 0.0f64;
    for layer in &layers {
        if layer.is_empty() {
            continue;
        }
        let max_h = layer
            .iter()
            .map(|&i| tables[i].height.max(MIN_CARD_HEIGHT))
            .fold(0.0f64, f64::max);
        let width = MARGIN * 2.0 + layer.len() as f64 * CARD_WIDTH + (layer.len() - 1) as f64 * CARD_GAP_X;
        main_width = main_width.max(width);
        for &i in layer {
            ys[i] = cursor;
        }
        cursor += max_h + LAYER_GAP_Y;
    }

    // Isolated zone: a grid below the main graph. Row height follows the
    // tallest card in the row — fixed spacing would overlap tall cards.
    let isolated: Vec<usize> = (0..tables.len()).filter(|&i| !has_edge[i]).collect();
    let mut isolated_bottom = cursor;
    let mut isolated_width = 0.0f64;
    if !isolated.is_empty() {
        let zone_y = cursor + 40.0;
        let mut row_y = zone_y;
        for chunk in isolated.chunks(ISOLATED_PER_ROW) {
            let row_h = chunk
                .iter()
                .map(|&i| tables[i].height.max(MIN_CARD_HEIGHT))
                .fold(0.0f64, f64::max);
            for (col, &i) in chunk.iter().enumerate() {
                xs[i] = MARGIN + col as f64 * (CARD_WIDTH + CARD_GAP_X);
                ys[i] = row_y;
            }
            row_y += row_h + ISOLATED_ROW_GAP;
        }
        isolated_width = MARGIN * 2.0
            + isolated.len().min(ISOLATED_PER_ROW) as f64 * CARD_WIDTH
            + (isolated.len().min(ISOLATED_PER_ROW) - 1) as f64 * CARD_GAP_X;
        isolated_bottom = row_y;
    }

    let nodes = (0..tables.len())
        .map(|i| LayoutNode {
            table: tables[i].name.clone(),
            x: xs[i],
            y: ys[i],
            layer: layer_of[i],
            isolated: !has_edge[i],
        })
        .collect();

    ErLayout {
        nodes,
        width: main_width.max(isolated_width).max(400.0),
        height: isolated_bottom.max(cursor).max(300.0),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn table(name: &str, height: f64) -> LayoutTable {
        LayoutTable {
            name: name.to_string(),
            height,
        }
    }

    fn edge(child: &str, parent: &str) -> LayoutEdge {
        LayoutEdge {
            child_table: child.to_string(),
            parent_table: parent.to_string(),
        }
    }

    fn node_of<'a>(layout: &'a ErLayout, name: &str) -> &'a LayoutNode {
        layout
            .nodes
            .iter()
            .find(|n| n.table == name)
            .unwrap_or_else(|| panic!("node {name} missing"))
    }

    #[test]
    fn parents_rank_above_children() {
        let tables = vec![
            table("orders", 200.0),
            table("order_items", 200.0),
            table("users", 200.0),
        ];
        let edges = vec![edge("orders", "users"), edge("order_items", "orders")];
        let layout = er_layout(&tables, &edges);
        assert!(node_of(&layout, "users").layer < node_of(&layout, "orders").layer);
        assert!(node_of(&layout, "orders").layer < node_of(&layout, "order_items").layer);
        assert!(node_of(&layout, "users").y < node_of(&layout, "orders").y);
    }

    #[test]
    fn deterministic_across_runs() {
        let tables = vec![
            table("a", 150.0),
            table("b", 300.0),
            table("c", 120.0),
            table("d", 200.0),
        ];
        let edges = vec![edge("a", "b"), edge("a", "c"), edge("d", "a"), edge("c", "b")];
        let first = er_layout(&tables, &edges);
        for _ in 0..3 {
            let again = er_layout(&tables, &edges);
            assert_eq!(first.width, again.width);
            assert_eq!(first.height, again.height);
            for (n1, n2) in first.nodes.iter().zip(&again.nodes) {
                assert_eq!(n1.table, n2.table);
                assert_eq!(n1.x, n2.x);
                assert_eq!(n1.y, n2.y);
                assert_eq!(n1.layer, n2.layer);
            }
        }
    }

    #[test]
    fn mutual_reference_cycle_terminates() {
        let tables = vec![table("a", 150.0), table("b", 150.0), table("c", 150.0)];
        let edges = vec![edge("a", "b"), edge("b", "a"), edge("c", "a")];
        let layout = er_layout(&tables, &edges);
        // All three got finite, ordered positions (c is a's child → below it).
        assert!(node_of(&layout, "c").y > node_of(&layout, "a").y);
        assert_eq!(layout.nodes.len(), 3);
    }

    #[test]
    fn self_loop_leaves_table_isolated() {
        let tables = vec![table("tree", 150.0), table("users", 150.0)];
        let edges = vec![edge("tree", "tree"), edge("users", "tree")];
        let layout = er_layout(&tables, &edges);
        assert!(!node_of(&layout, "users").isolated);
        // users → tree means tree is not isolated either (it has a child).
        assert!(!node_of(&layout, "tree").isolated);
        assert!(node_of(&layout, "users").layer > node_of(&layout, "tree").layer);
    }

    #[test]
    fn cards_never_overlap() {
        let tables = vec![
            table("users", 300.0),
            table("orders", 180.0),
            table("payments", 420.0),
            table("refunds", 150.0),
            table("coupons", 240.0),
            table("accounts", 120.0),
        ];
        let edges = vec![
            edge("orders", "users"),
            edge("payments", "orders"),
            edge("refunds", "payments"),
            edge("coupons", "users"),
            edge("accounts", "users"),
        ];
        let layout = er_layout(&tables, &edges);
        let height_of = |name: &str| {
            tables
                .iter()
                .find(|t| t.name == name)
                .map(|t| t.height)
                .unwrap_or(0.0)
        };
        for (ai, a) in layout.nodes.iter().enumerate() {
            for b in &layout.nodes[ai + 1..] {
                let ax2 = a.x + CARD_WIDTH;
                let bx2 = b.x + CARD_WIDTH;
                let ay2 = a.y + height_of(&a.table);
                let by2 = b.y + height_of(&b.table);
                let overlap = a.x < bx2 && b.x < ax2 && a.y < by2 && b.y < ay2;
                assert!(!overlap, "{} and {} boxes overlap", a.table, b.table);
            }
        }
    }

    #[test]
    fn isolated_tables_park_below_the_main_graph() {
        let tables = vec![
            table("users", 200.0),
            table("orders", 200.0),
            table("lonely", 200.0),
            table("lonelier", 200.0),
        ];
        let edges = vec![edge("orders", "users")];
        let layout = er_layout(&tables, &edges);
        assert!(node_of(&layout, "lonely").isolated);
        assert!(node_of(&layout, "lonelier").isolated);
        assert!(!node_of(&layout, "users").isolated);
        let main_bottom = layout
            .nodes
            .iter()
            .filter(|n| !n.isolated)
            .map(|n| n.y + 200.0)
            .fold(0.0f64, f64::max);
        assert!(node_of(&layout, "lonely").y > main_bottom);
        assert!(node_of(&layout, "lonelier").y >= node_of(&layout, "lonely").y);
    }

    #[test]
    fn isolated_grid_rows_clear_tall_cards() {
        // 9 isolated tables → two rows (8 + 1); a very tall card sits in
        // row 1, so row 2 must start below its bottom edge.
        let mut tables = vec![table("a1", 120.0)];
        for i in 0..10 {
            let h = if i == 0 { 700.0 } else { 120.0 };
            tables.push(table(format!("lone{i}").as_str(), h));
        }
        let edges = vec![edge("lone9", "a1")];
        let layout = er_layout(&tables, &edges);
        let tall = node_of(&layout, "lone0");
        assert!(tall.isolated);
        let below = node_of(&layout, "lone8"); // lone8 is the 9th isolated → row 2
        assert!(below.isolated);
        assert!(
            below.y >= tall.y + 700.0,
            "row 2 starts at {}, tall card bottom at {}",
            below.y,
            tall.y + 700.0
        );
    }

    #[test]
    fn repeated_sweeps_stay_deterministic() {
        // A tangled graph (hub + fan + mutual pair) exercised through the
        // multi-cycle sweeps — layout must remain stable across runs.
        let tables: Vec<LayoutTable> = (0..10)
            .map(|i| table(format!("t{i}").as_str(), 160.0))
            .collect();
        let edges = vec![
            edge("t1", "t0"),
            edge("t2", "t0"),
            edge("t3", "t1"),
            edge("t4", "t1"),
            edge("t5", "t2"),
            edge("t6", "t2"),
            edge("t7", "t5"),
            edge("t8", "t6"),
            edge("t8", "t7"),
            edge("t9", "t3"),
            edge("t9", "t4"),
            edge("t9", "t8"),
        ];
        let first = er_layout(&tables, &edges);
        let second = er_layout(&tables, &edges);
        for (a, b) in first.nodes.iter().zip(&second.nodes) {
            assert_eq!((a.x, a.y, a.layer), (b.x, b.y, b.layer));
        }
    }

    #[test]
    fn empty_schema_yields_empty_layout() {
        let layout = er_layout(&[], &[]);
        assert!(layout.nodes.is_empty());
        assert_eq!(layout.width, 0.0);
    }

    #[test]
    fn unknown_edge_endpoints_are_dropped() {
        let tables = vec![table("users", 200.0), table("orders", 200.0)];
        let edges = vec![edge("orders", "ghost_table"), edge("orders", "users")];
        let layout = er_layout(&tables, &edges);
        assert_eq!(layout.nodes.len(), 2);
        assert!(!node_of(&layout, "users").isolated);
    }
}

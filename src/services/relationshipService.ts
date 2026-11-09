import { invoke } from "@tauri-apps/api/core";
import type {
  ErLayout,
  ErLayoutInputEdge,
  ErLayoutInputTable,
  RelationshipImportResult,
  RelationshipsMap,
  RelationshipsOverview,
  ReverseReference,
  TableRelationship,
} from "../types";

/** Declared + adjudicated relationships for one table (no probing). */
export async function getRelationships(
  connectionId: string,
  database: string,
  table: string,
): Promise<RelationshipsOverview> {
  return invoke("relationships_get", { connectionId, database, table });
}

/** Value-validate name-heuristic candidates against parent primary keys. */
export async function inferRelationships(
  connectionId: string,
  database: string,
  table: string,
  samples: Record<string, unknown[]>,
): Promise<TableRelationship[]> {
  return invoke("relationships_infer", { connectionId, database, table, samples });
}

/** Import a `table.column -> table.column [LEFT|RIGHT]?` list. */
export async function importRelationships(
  connectionId: string,
  text: string,
): Promise<RelationshipImportResult> {
  return invoke("relationships_import", { connectionId, text });
}

/** Record a user verdict on a link (confirm = pin it, veto = never suggest). */
export async function adjudicateRelationship(
  connectionId: string,
  link: {
    childTable: string;
    childColumn: string;
    parentTable: string;
    parentColumn: string;
  },
  confirm: boolean,
): Promise<void> {
  return invoke("relationships_adjudicate", { connectionId, ...link, confirm });
}

/** Live probe: hit rate of the sampled child values in the parent column. */
export async function probeRelationship(
  connectionId: string,
  database: string,
  parentTable: string,
  parentColumn: string,
  samples: unknown[],
): Promise<number | null> {
  return invoke("relationships_probe", {
    connectionId,
    database,
    parentTable,
    parentColumn,
    samples,
  });
}

/** Reverse inference: indexed child columns that reference this table's PK. */
export async function inferReverseReferences(
  connectionId: string,
  database: string,
  table: string,
  pkColumn: string,
  samples: unknown[],
): Promise<ReverseReference[]> {
  return invoke("relationships_reverse_infer", {
    connectionId,
    database,
    table,
    pkColumn,
    samples,
  });
}

/** Whole-database graph for the ER map: tables + columns + all edges
 *  (declared + adjudicated, plus dashed "?" name-heuristic candidates). */
export async function getRelationshipsMap(
  connectionId: string,
  database: string,
): Promise<RelationshipsMap> {
  return invoke("relationships_map", { connectionId, database });
}

/** Pure layered layout — Rust owns the algorithm, the canvas only draws. */
export async function computeErLayout(
  tables: ErLayoutInputTable[],
  edges: ErLayoutInputEdge[],
): Promise<ErLayout> {
  return invoke("er_layout_compute", { tables, edges });
}

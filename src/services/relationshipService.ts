import { invoke } from "@tauri-apps/api/core";
import type {
  RelationshipImportResult,
  RelationshipsOverview,
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

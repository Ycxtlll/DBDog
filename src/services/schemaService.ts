import { invoke } from "@tauri-apps/api/core";
import type { CompareTableDiff, CompletionSchema, Database, SearchResult, Table, TableDetails } from "../types";

export async function getDatabases(connectionId: string): Promise<Database[]> {
  return invoke("get_databases", { connectionId });
}

export async function getTables(
  connectionId: string,
  database: string,
): Promise<Table[]> {
  return invoke("get_tables", { connectionId, database });
}

export async function getTableDetails(
  connectionId: string,
  database: string,
  table: string,
): Promise<TableDetails> {
  return invoke("get_table_details", { connectionId, database, table });
}

export async function refreshSchema(
  connectionId: string,
  database?: string,
): Promise<void> {
  return invoke("refresh_schema", { connectionId, database });
}

export async function searchSchema(
  connectionId: string,
  keyword: string,
): Promise<SearchResult[]> {
  return invoke("search_schema", { connectionId, keyword });
}

export async function getCompletionSchema(
  connectionId: string,
  database?: string,
): Promise<CompletionSchema> {
  return invoke("get_completion_schema", { connectionId, database: database ?? null });
}

/** Compare diff → target-reshaping ALTER statements (Rust generation). */
export async function compareAlterStatements(
  database: string,
  diff: CompareTableDiff,
): Promise<string[]> {
  return invoke("compare_alter_statements_command", { database, diff });
}

/** Visual designer: one multi-clause ALTER TABLE (Rust generation). */
export async function designerPrepareAlter(
  database: string,
  table: string,
  origColumns: unknown[],
  columns: unknown[],
  origIndexes: unknown[],
  indexes: unknown[],
): Promise<{ sql: string | null; pkChanged: boolean }> {
  return invoke("designer_prepare_alter", {
    database,
    table,
    origColumns,
    columns,
    origIndexes,
    indexes,
  });
}

/** Designer sanity checks — i18n key + params for the first problem. */
export async function designerValidate(
  columns: unknown[],
  indexes: unknown[],
): Promise<{ key: string; params?: Record<string, string> } | null> {
  return invoke("designer_validate_command", { columns, indexes });
}

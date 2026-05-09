import { invoke } from "@tauri-apps/api/core";
import type { Database, SearchResult, Table, TableDetails } from "../types";

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

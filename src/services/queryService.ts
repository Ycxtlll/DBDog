import { invoke } from "@tauri-apps/api/core";
import type { QueryResult, UpdateResult } from "../types";

export async function executeQuery(
  connectionId: string,
  sql: string,
  limit?: number,
  database?: string,
): Promise<QueryResult> {
  return invoke("execute_query", { connectionId, sql, limit, database });
}

export async function executeUpdate(
  connectionId: string,
  sql: string,
  database?: string,
): Promise<UpdateResult> {
  return invoke("execute_update", { connectionId, sql, database });
}

export async function executeExport(
  connectionId: string,
  database: string,
  table: string,
  filePath: string,
  exportId: string,
): Promise<{ totalRows: number; elapsedMs: number; filePath: string }> {
  return invoke("execute_export", { connectionId, database, table, filePath, exportId });
}

export async function cancelExport(exportId: string): Promise<void> {
  return invoke("cancel_export", { exportId });
}

export async function cancelQuery(
  connectionId: string,
  threadId: number,
): Promise<void> {
  return invoke("cancel_query", { connectionId, threadId });
}


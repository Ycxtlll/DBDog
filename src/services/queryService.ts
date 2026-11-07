import { invoke } from "@tauri-apps/api/core";
import type { QueryResult, ScriptExecutionResult, UpdateResult } from "../types";

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


/** Apply a staged changeset: all statements in ONE transaction. */
export async function executeTransaction(
  connectionId: string,
  statements: string[],
  assumeYes?: boolean,
): Promise<number> {
  return invoke("execute_transaction", { connectionId, statements, assumeYes });
}

/** Backend-guarded script execution: split, pre-scan guards, run (MySQL). */
export async function executeScript(
  connectionId: string,
  sql: string,
  limit?: number,
  database?: string,
  assumeYes?: boolean,
): Promise<ScriptExecutionResult> {
  return invoke("execute_script", {
    connectionId,
    sql,
    limit,
    database,
    assumeYes,
  });
}

/** Filter model → full-table search SQL (Rust translation). */
export async function filterSearchSql(
  database: string,
  table: string,
  model: Record<string, unknown>,
): Promise<string | null> {
  return invoke("filter_search_sql_command", { database, table, model });
}

/** Generate forward + rollback SQL for a staged grid change (Rust). */
export async function changesetPrepare(request: {
  database: string;
  table: string;
  pkColumns: string[];
  kind: "update" | "delete" | "insert";
  row: Record<string, unknown>;
  column?: string;
  newValue?: unknown;
}): Promise<{ sql: string; rollbackSql: string }> {
  return invoke("changeset_prepare", { request });
}

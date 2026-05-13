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

export async function cancelQuery(
  connectionId: string,
  threadId: number,
): Promise<void> {
  return invoke("cancel_query", { connectionId, threadId });
}

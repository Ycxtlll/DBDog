import { invoke } from "@tauri-apps/api/core";
import type { QueryResult, UpdateResult } from "../types";

export async function executeQuery(
  connectionId: string,
  sql: string,
  limit?: number,
): Promise<QueryResult> {
  return invoke("execute_query", { connectionId, sql, limit });
}

export async function executeUpdate(
  connectionId: string,
  sql: string,
): Promise<UpdateResult> {
  return invoke("execute_update", { connectionId, sql });
}

export async function cancelQuery(
  connectionId: string,
  threadId: number,
): Promise<void> {
  return invoke("cancel_query", { connectionId, threadId });
}

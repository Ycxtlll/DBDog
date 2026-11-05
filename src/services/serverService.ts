import { invoke } from "@tauri-apps/api/core";
import type { ProcessRow, ServerVariable } from "../types";

export async function getProcesslist(connectionId: string): Promise<ProcessRow[]> {
  return invoke("get_processlist", { connectionId });
}

export async function getServerVariables(connectionId: string): Promise<ServerVariable[]> {
  return invoke("get_server_variables", { connectionId });
}

export async function getServerStatus(connectionId: string): Promise<ServerVariable[]> {
  return invoke("get_server_status", { connectionId });
}

export async function killProcess(connectionId: string, threadId: number): Promise<void> {
  return invoke("kill_process", { connectionId, threadId });
}

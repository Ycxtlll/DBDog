import { invoke } from "@tauri-apps/api/core";
import type { ConnectionConfig, ServerInfo } from "../types";

export async function listConnections(): Promise<ConnectionConfig[]> {
  return invoke("list_connections");
}

export async function saveConnection(
  config: ConnectionConfig,
): Promise<ConnectionConfig> {
  return invoke("save_connection", { config });
}

export async function deleteConnection(id: string): Promise<void> {
  return invoke("delete_connection", { id });
}

export async function testConnection(
  config: ConnectionConfig,
): Promise<string> {
  return invoke("test_connection", { config });
}

export async function connect(id: string, password?: string): Promise<ServerInfo> {
  return invoke("connect", { id, password });
}

export async function disconnect(id: string): Promise<void> {
  return invoke("disconnect", { id });
}

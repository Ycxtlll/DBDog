import { invoke } from "@tauri-apps/api/core";
import type {
  MemcachedEntry,
  MemcachedKeyList,
  MemcachedServerInfo,
} from "../types";

export async function listKeys(
  connectionId: string,
  search?: string,
): Promise<MemcachedKeyList> {
  return invoke("memcached_list_keys", {
    connectionId,
    search: search || null,
  });
}

export async function getItem(
  connectionId: string,
  key: string,
): Promise<MemcachedEntry> {
  return invoke("memcached_get_item", { connectionId, key });
}

export async function deleteItem(
  connectionId: string,
  key: string,
): Promise<void> {
  return invoke("memcached_delete_item", { connectionId, key });
}

export async function flushAll(connectionId: string): Promise<void> {
  return invoke("memcached_flush_all", { connectionId });
}

export async function getStats(
  connectionId: string,
): Promise<MemcachedServerInfo> {
  return invoke("memcached_get_stats", { connectionId });
}

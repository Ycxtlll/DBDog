import { invoke } from "@tauri-apps/api/core";
import type { ZkChildList, ZkNode, ZkServerInfo, ZkTreeNode } from "../types";

export async function listChildren(
  connectionId: string,
  path?: string,
): Promise<ZkChildList> {
  return invoke("zookeeper_list_children", {
    connectionId,
    path: path || null,
  });
}

export async function getNode(
  connectionId: string,
  path: string,
): Promise<ZkNode> {
  return invoke("zookeeper_get_node", { connectionId, path });
}

export async function getTree(
  connectionId: string,
  path?: string,
  maxDepth?: number,
): Promise<ZkTreeNode> {
  return invoke("zookeeper_get_tree", {
    connectionId,
    path: path || null,
    maxDepth: maxDepth || null,
  });
}

export async function getServerInfo(
  connectionId: string,
): Promise<ZkServerInfo> {
  return invoke("zookeeper_get_server_info", { connectionId });
}

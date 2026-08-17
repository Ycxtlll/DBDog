import { create } from "zustand";
import type { ZkNode, ZkServerInfo, ZkTreeNode } from "../types";
import * as zookeeperService from "../services/zookeeperService";
import { parseTauriError } from "../lib/error";

interface ZookeeperState {
  rootNode: ZkTreeNode | null;
  selectedNode: ZkNode | null;
  currentPath: string;
  serverInfo: ZkServerInfo | null;
  isLoadingTree: boolean;
  error: string | null;

  loadTree: (connectionId: string, path?: string, maxDepth?: number) => Promise<void>;
  /** Lazily fetch the children of a frontier node and merge them into the tree. */
  expandNode: (connectionId: string, path: string) => Promise<void>;
  loadNode: (connectionId: string, path: string) => Promise<void>;
  loadServerInfo: (connectionId: string) => Promise<void>;
  setCurrentPath: (path: string) => void;
  clearError: () => void;
  refresh: (connectionId: string) => Promise<void>;
}

/** Find a node by absolute path in the tree (undefined children = frontier). */
function findZkNode(node: ZkTreeNode, path: string): ZkTreeNode | null {
  if (node.path === path) return node;
  const children = node.children ?? [];
  for (const child of children) {
    const found = findZkNode(child, path);
    if (found) return found;
  }
  return null;
}

/** Replace the subtree at `path` with `branch`'s children (recursive merge). */
function mergeBranch(node: ZkTreeNode, path: string, branch: ZkTreeNode): ZkTreeNode {
  if (node.path === path) {
    return { ...node, numChildren: branch.numChildren, children: branch.children };
  }
  if (!node.children) return node;
  const children = node.children.map((child) => mergeBranch(child, path, branch));
  const changed = children.some((c, i) => c !== node.children![i]);
  return changed ? { ...node, children } : node;
}

export const useZookeeperStore = create<ZookeeperState>((set, get) => ({
  rootNode: null,
  selectedNode: null,
  currentPath: "/",
  serverInfo: null,
  isLoadingTree: false,
  error: null,

  loadTree: async (connectionId, path, maxDepth) => {
    set({ isLoadingTree: true, error: null });
    try {
      const node = await zookeeperService.getTree(connectionId, path, maxDepth);
      set({ rootNode: node, isLoadingTree: false });
    } catch (err) {
      set({
        isLoadingTree: false,
        error: parseTauriError(err),
      });
    }
  },

  expandNode: async (connectionId, path) => {
    const { rootNode } = get();
    if (!rootNode) return;
    const target = findZkNode(rootNode, path);
    if (!target || target.children !== undefined) return; // already loaded
    try {
      const branch = await zookeeperService.getTree(connectionId, path, 1);
      set({ rootNode: mergeBranch(rootNode, path, branch) });
    } catch (err) {
      set({ error: parseTauriError(err) });
    }
  },

  loadNode: async (connectionId, path) => {
    set({ error: null });
    try {
      const node = await zookeeperService.getNode(connectionId, path);
      set({ selectedNode: node });
    } catch (err) {
      set({ error: parseTauriError(err) });
    }
  },

  loadServerInfo: async (connectionId) => {
    try {
      const info = await zookeeperService.getServerInfo(connectionId);
      set({ serverInfo: info });
    } catch (_err) {
      // mntr 4LW is optional — non-fatal
      set({ serverInfo: null });
    }
  },

  setCurrentPath: (path) => set({ currentPath: path }),
  clearError: () => set({ error: null }),

  refresh: async (connectionId) => {
    const state = get();
    await state.loadTree(connectionId, state.currentPath, 3);
    // Reload selected node if viewing one
    if (state.selectedNode) {
      await state.loadNode(connectionId, state.selectedNode.path);
    }
  },
}));

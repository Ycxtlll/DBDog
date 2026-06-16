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
  loadNode: (connectionId: string, path: string) => Promise<void>;
  loadServerInfo: (connectionId: string) => Promise<void>;
  setCurrentPath: (path: string) => void;
  clearError: () => void;
  refresh: (connectionId: string) => Promise<void>;
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

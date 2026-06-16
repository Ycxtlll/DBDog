import { create } from "zustand";
import type { ConnectionConfig, ConnectionStatus, ServerInfo } from "../types";
import * as connectionService from "../services/connectionService";

interface ConnectionState {
  configs: ConnectionConfig[];
  activeId: string | null;
  statusMap: Record<string, ConnectionStatus>;
  serverInfoMap: Record<string, ServerInfo>;
  loadConfigs: () => Promise<void>;
  saveConfig: (config: ConnectionConfig) => Promise<void>;
  deleteConfig: (id: string) => Promise<void>;
  connect: (id: string) => Promise<void>;
  disconnect: (id: string) => Promise<void>;
  setActiveId: (id: string | null) => void;
}

export const useConnectionStore = create<ConnectionState>((set) => ({
  configs: [],
  activeId: null,
  statusMap: {},
  serverInfoMap: {},

  loadConfigs: async () => {
    const configs = await connectionService.listConnections();
    set({ configs });
  },

  saveConfig: async (config) => {
    await connectionService.saveConnection(config);
    set((state) => {
      const idx = state.configs.findIndex((c) => c.id === config.id);
      if (idx >= 0) {
        const next = [...state.configs];
        next[idx] = config;
        return { configs: next };
      }
      return { configs: [...state.configs, config] };
    });
  },

  deleteConfig: async (id) => {
    await connectionService.deleteConnection(id);
    set((state) => ({
      configs: state.configs.filter((c) => c.id !== id),
      activeId: state.activeId === id ? null : state.activeId,
    }));
  },

  connect: async (id) => {
    set((state) => ({
      statusMap: { ...state.statusMap, [id]: "connecting" },
    }));
    try {
      const info = await connectionService.connect(id);
      set((state) => ({
        statusMap: { ...state.statusMap, [id]: "connected" },
        serverInfoMap: { ...state.serverInfoMap, [id]: info },
        activeId: id,
      }));
    } catch (err) {
      set((state) => ({
        statusMap: { ...state.statusMap, [id]: "error" },
      }));
      throw err;
    }
  },

  disconnect: async (id) => {
    await connectionService.disconnect(id);
    set((state) => ({
      statusMap: { ...state.statusMap, [id]: "disconnected" },
      serverInfoMap: { ...state.serverInfoMap },
    }));
  },

  setActiveId: (id) => set({ activeId: id }),
}));

import { create } from 'zustand';
import type { ConnectionSummary, ConnectionInfo, ConnectionStatus } from '../types/connection';
import { connectionService } from '../services/connectionService';

interface ConnectionState {
  connections: ConnectionSummary[];
  activeConnections: Map<string, ConnectionInfo>;
  connectionStatuses: Record<string, ConnectionStatus>;
  activeConnectionId: string | null;

  loadConnections: () => Promise<void>;
  connect: (id: string) => Promise<ConnectionInfo>;
  disconnect: (id: string) => Promise<void>;
  deleteConnection: (id: string) => Promise<void>;
  setActiveConnection: (id: string | null) => void;
  getStatus: (id: string) => ConnectionStatus;
}

export const useConnectionStore = create<ConnectionState>((set, get) => ({
  connections: [],
  activeConnections: new Map(),
  connectionStatuses: {},
  activeConnectionId: null,

  loadConnections: async () => {
    const connections = await connectionService.list();
    set({ connections });
  },

  connect: async (id: string) => {
    set((s) => ({
      connectionStatuses: { ...s.connectionStatuses, [id]: 'connecting' } as Record<string, ConnectionStatus>,
    }));
    try {
      const info = await connectionService.connect(id);
      set((s) => {
        const newActive = new Map(s.activeConnections);
        newActive.set(id, info);
        return {
          activeConnections: newActive,
          connectionStatuses: { ...s.connectionStatuses, [id]: 'connected' } as Record<string, ConnectionStatus>,
          activeConnectionId: s.activeConnectionId || id,
        };
      });
      return info;
    } catch (e) {
      set((s) => ({
        connectionStatuses: { ...s.connectionStatuses, [id]: 'error' } as Record<string, ConnectionStatus>,
      }));
      throw e;
    }
  },

  disconnect: async (id: string) => {
    await connectionService.disconnect(id);
    set((s) => {
      const newActive = new Map(s.activeConnections);
      newActive.delete(id);
      const newStatuses = { ...s.connectionStatuses, [id]: 'disconnected' } as Record<string, ConnectionStatus>;
      return {
        activeConnections: newActive,
        connectionStatuses: newStatuses,
        activeConnectionId: s.activeConnectionId === id ? null : s.activeConnectionId,
      };
    });
  },

  deleteConnection: async (id: string) => {
    await connectionService.delete(id);
    set((s) => {
      const newActive = new Map(s.activeConnections);
      newActive.delete(id);
      const { [id]: _, ...newStatuses } = s.connectionStatuses;
      return {
        connections: s.connections.filter((c) => c.id !== id),
        activeConnections: newActive,
        connectionStatuses: newStatuses,
        activeConnectionId: s.activeConnectionId === id ? null : s.activeConnectionId,
      };
    });
  },

  setActiveConnection: (id) => set({ activeConnectionId: id }),

  getStatus: (id: string) => {
    return get().connectionStatuses[id] || 'disconnected';
  },
}));

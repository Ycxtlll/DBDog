import { create } from "zustand";
import type { MemcachedEntry, MemcachedServerInfo } from "../types";
import * as memcachedService from "../services/memcachedService";
import { parseTauriError } from "../lib/error";

interface MemcachedState {
  /** Currently loaded keys */
  keys: string[];
  totalKeys: number;
  truncated: boolean;
  /** Currently viewed item */
  selectedKey: string | null;
  selectedItem: MemcachedEntry | null;
  /** Server stats */
  serverInfo: MemcachedServerInfo | null;
  /** UI state */
  isSearching: boolean;
  searchQuery: string;
  isLoadingKeys: boolean;
  isLoadingItem: boolean;
  isFlushing: boolean;
  error: string | null;

  // Actions
  loadKeys: (connectionId: string, search?: string) => Promise<void>;
  loadItem: (connectionId: string, key: string) => Promise<void>;
  deleteItem: (connectionId: string, key: string) => Promise<void>;
  flushAll: (connectionId: string) => Promise<void>;
  loadServerInfo: (connectionId: string) => Promise<void>;
  setSearchQuery: (query: string) => void;
  setSelectedKey: (key: string | null) => void;
  clearError: () => void;
}

export const useMemcachedStore = create<MemcachedState>((set, get) => ({
  keys: [],
  totalKeys: 0,
  truncated: false,
  selectedKey: null,
  selectedItem: null,
  serverInfo: null,
  isSearching: false,
  searchQuery: "",
  isLoadingKeys: false,
  isLoadingItem: false,
  isFlushing: false,
  error: null,

  loadKeys: async (connectionId, search) => {
    set({ isLoadingKeys: true, error: null, selectedKey: null, selectedItem: null });
    try {
      const result = await memcachedService.listKeys(connectionId, search);
      set({
        keys: result.keys,
        totalKeys: result.totalKeys,
        truncated: result.truncated,
        isLoadingKeys: false,
      });
    } catch (err) {
      set({
        isLoadingKeys: false,
        error: parseTauriError(err as string),
      });
    }
  },

  loadItem: async (connectionId, key) => {
    set({ isLoadingItem: true, error: null });
    try {
      const item = await memcachedService.getItem(connectionId, key);
      set({
        selectedKey: key,
        selectedItem: item,
        isLoadingItem: false,
      });
    } catch (err) {
      set({
        isLoadingItem: false,
        error: parseTauriError(err as string),
      });
    }
  },

  deleteItem: async (connectionId, key) => {
    set({ error: null });
    try {
      await memcachedService.deleteItem(connectionId, key);
      // Remove from local list
      const state = get();
      set({
        keys: state.keys.filter((k) => k !== key),
        totalKeys: state.totalKeys - 1,
        selectedKey: state.selectedKey === key ? null : state.selectedKey,
        selectedItem: state.selectedKey === key ? null : state.selectedItem,
      });
    } catch (err) {
      set({ error: parseTauriError(err as string) });
    }
  },

  flushAll: async (connectionId) => {
    set({ isFlushing: true, error: null });
    try {
      await memcachedService.flushAll(connectionId);
      set({
        keys: [],
        totalKeys: 0,
        truncated: false,
        selectedKey: null,
        selectedItem: null,
        isFlushing: false,
      });
    } catch (err) {
      set({
        isFlushing: false,
        error: parseTauriError(err as string),
      });
    }
  },

  loadServerInfo: async (connectionId) => {
    set({ error: null });
    try {
      const info = await memcachedService.getStats(connectionId);
      set({ serverInfo: info });
    } catch (err) {
      set({ error: parseTauriError(err as string) });
    }
  },

  setSearchQuery: (query) => set({ searchQuery: query }),
  setSelectedKey: (key) => set({ selectedKey: key }),
  clearError: () => set({ error: null }),
}));

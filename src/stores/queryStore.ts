import { create } from 'zustand';
import type { QueryTab, QueryResult, UpdateResult } from '../types/query';

interface QueryState {
  tabs: QueryTab[];
  activeTabId: string | null;

  addTab: (connectionId?: string, database?: string) => string;
  closeTab: (id: string) => void;
  setActiveTab: (id: string) => void;
  updateTabSql: (id: string, sql: string) => void;
  setTabExecuting: (id: string, executing: boolean) => void;
  setTabResult: (id: string, result: QueryResult) => void;
  setTabUpdateResult: (id: string, result: UpdateResult) => void;
  setTabError: (id: string, error: string | undefined) => void;
  getActiveTab: () => QueryTab | undefined;
}

let tabCounter = 0;

export const useQueryStore = create<QueryState>((set, get) => ({
  tabs: [],
  activeTabId: null,

  addTab: (connectionId?: string, database?: string) => {
    tabCounter++;
    const id = `tab-${Date.now()}-${tabCounter}`;
    const tab: QueryTab = {
      id,
      title: `Query ${tabCounter}`,
      sql: '',
      isExecuting: false,
      connectionId,
      database,
    };
    set((s) => ({
      tabs: [...s.tabs, tab],
      activeTabId: id,
    }));
    return id;
  },

  closeTab: (id: string) => {
    set((s) => {
      const newTabs = s.tabs.filter((t) => t.id !== id);
      const newActiveId =
        s.activeTabId === id
          ? newTabs.length > 0
            ? newTabs[newTabs.length - 1].id
            : null
          : s.activeTabId;
      return { tabs: newTabs, activeTabId: newActiveId };
    });
  },

  setActiveTab: (id: string) => set({ activeTabId: id }),

  updateTabSql: (id: string, sql: string) => {
    set((s) => ({
      tabs: s.tabs.map((t) => (t.id === id ? { ...t, sql } : t)),
    }));
  },

  setTabExecuting: (id: string, executing: boolean) => {
    set((s) => ({
      tabs: s.tabs.map((t) => (t.id === id ? { ...t, isExecuting: executing } : t)),
    }));
  },

  setTabResult: (id: string, result: QueryResult) => {
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.id === id ? { ...t, result, updateResult: undefined, error: undefined } : t
      ),
    }));
  },

  setTabUpdateResult: (id: string, result: UpdateResult) => {
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.id === id ? { ...t, updateResult: result, result: undefined, error: undefined } : t
      ),
    }));
  },

  setTabError: (id: string, error: string | undefined) => {
    set((s) => ({
      tabs: s.tabs.map((t) => (t.id === id ? { ...t, error, isExecuting: false } : t)),
    }));
  },

  getActiveTab: () => {
    const s = get();
    return s.tabs.find((t) => t.id === s.activeTabId);
  },
}));

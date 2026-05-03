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
  setTabTitle: (id: string, title: string) => void;
  getActiveTab: () => QueryTab | undefined;
}

let tabCounter = 0;

function generateTitle(sql: string): string {
  const trimmed = sql.trim();
  if (!trimmed) return '';
  const firstLine = trimmed.split('\n')[0];
  if (firstLine.length > 30) return firstLine.slice(0, 27) + '...';
  return firstLine;
}

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
      const idx = s.tabs.findIndex((t) => t.id === id);
      if (idx === -1) return s;
      const newTabs = s.tabs.filter((t) => t.id !== id);
      let newActiveId = s.activeTabId;
      if (s.activeTabId === id) {
        if (newTabs.length > 0) {
          // Activate left tab if exists, otherwise right tab
          newActiveId = newTabs[Math.min(idx, newTabs.length - 1)]?.id ?? null;
        } else {
          newActiveId = null;
        }
      }
      return { tabs: newTabs, activeTabId: newActiveId };
    });
  },

  setActiveTab: (id: string) => set({ activeTabId: id }),

  updateTabSql: (id: string, sql: string) => {
    set((s) => ({
      tabs: s.tabs.map((t) => {
        if (t.id !== id) return t;
        const title = generateTitle(sql) || t.title;
        return { ...t, sql, title: title.startsWith('Query ') ? t.title : title };
      }),
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

  setTabTitle: (id: string, title: string) => {
    set((s) => ({
      tabs: s.tabs.map((t) => (t.id === id ? { ...t, title } : t)),
    }));
  },

  getActiveTab: () => {
    const s = get();
    return s.tabs.find((t) => t.id === s.activeTabId);
  },
}));

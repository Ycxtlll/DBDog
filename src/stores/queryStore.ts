import { create } from "zustand";
import type { QueryResult, QueryTab, UpdateResult } from "../types";
import { generateId } from "../lib/utils";
import * as queryService from "../services/queryService";

interface QueryState {
  tabs: QueryTab[];
  activeTabId: string | null;
  newTab: () => void;
  closeTab: (id: string) => void;
  setTabSql: (id: string, sql: string) => void;
  setActiveTab: (id: string) => void;
  execute: (connectionId: string, id: string, limit?: number) => Promise<void>;
  cancel: (connectionId: string, id: string, threadId: number) => Promise<void>;
  setTabResult: (
    id: string,
    result: QueryResult | UpdateResult,
    isQuery: boolean,
  ) => void;
  setTabError: (id: string, error: string) => void;
  setTabExecuting: (id: string, executing: boolean) => void;
  setTabCancelled: (id: string, cancelled: boolean) => void;
}

export const useQueryStore = create<QueryState>((set, get) => ({
  tabs: [],
  activeTabId: null,

  newTab: () => {
    const tab: QueryTab = {
      id: generateId(),
      name: "New Query",
      sql: "",
      isExecuting: false,
      isCancelled: false,
    };
    set((state) => ({
      tabs: [...state.tabs, tab],
      activeTabId: tab.id,
    }));
  },

  closeTab: (id) => {
    set((state) => {
      const tabs = state.tabs.filter((t) => t.id !== id);
      let activeTabId = state.activeTabId;
      if (activeTabId === id) {
        activeTabId = tabs.length > 0 ? tabs[tabs.length - 1].id : null;
      }
      return { tabs, activeTabId };
    });
  },

  setTabSql: (id, sql) => {
    set((state) => ({
      tabs: state.tabs.map((t) =>
        t.id === id
          ? {
              ...t,
              sql,
              name: sql.trim().split("\n")[0].slice(0, 30) || t.name,
            }
          : t,
      ),
    }));
  },

  setActiveTab: (id) => set({ activeTabId: id }),

  execute: async (connectionId, id, limit) => {
    get().setTabExecuting(id, true);
    const tab = get().tabs.find((t) => t.id === id);
    if (!tab) return;
    try {
      const sql = tab.sql.trim();
      if (!sql) return;
      const firstWord = sql.split(/\s+/)[0]?.toUpperCase() ?? "";
      const isQuery = [
        "SELECT",
        "SHOW",
        "DESCRIBE",
        "DESC",
        "EXPLAIN",
      ].includes(firstWord);

      if (isQuery) {
        const result = await queryService.executeQuery(
          connectionId,
          sql,
          limit,
        );
        get().setTabResult(id, result, true);
      } else {
        const result = await queryService.executeUpdate(connectionId, sql);
        get().setTabResult(id, result, false);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      get().setTabError(id, msg);
    } finally {
      get().setTabExecuting(id, false);
    }
  },

  cancel: async (connectionId, id, threadId) => {
    try {
      await queryService.cancelQuery(connectionId, threadId);
      get().setTabCancelled(id, true);
    } catch (err) {
      console.error("Cancel failed:", err);
    }
  },

  setTabResult: (id, result, isQuery) => {
    set((state) => ({
      tabs: state.tabs.map((t) =>
        t.id === id
          ? { ...t, result, isQueryResult: isQuery, error: undefined }
          : t,
      ),
    }));
  },

  setTabError: (id, error) => {
    set((state) => ({
      tabs: state.tabs.map((t) => (t.id === id ? { ...t, error } : t)),
    }));
  },

  setTabExecuting: (id, executing) => {
    set((state) => ({
      tabs: state.tabs.map((t) =>
        t.id === id ? { ...t, isExecuting: executing } : t,
      ),
    }));
  },

  setTabCancelled: (id, cancelled) => {
    set((state) => ({
      tabs: state.tabs.map((t) =>
        t.id === id ? { ...t, isCancelled: cancelled } : t,
      ),
    }));
  },
}));

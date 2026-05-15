import { create } from "zustand";
import type { QueryHistoryItem, QueryResult, QueryTab, UpdateResult } from "../types";
import { generateId } from "../lib/utils";
import { splitSqlStatements } from "../lib/sql";
import * as queryService from "../services/queryService";
import { parseTauriError } from "../lib/error";

interface QueryState {
  tabs: QueryTab[];
  activeTabId: string | null;
  history: QueryHistoryItem[];
  historyExpanded: boolean;
  newTab: () => string;
  closeTab: (id: string) => void;
  setTabSql: (id: string, sql: string) => void;
  setActiveTab: (id: string) => void;
  execute: (
    connectionId: string,
    id: string,
    limit?: number,
    selectedSql?: string,
  ) => Promise<void>;
  cancel: (connectionId: string, id: string, threadId: number) => Promise<void>;
  setTabResult: (
    id: string,
    result: QueryResult | UpdateResult,
    isQuery: boolean,
  ) => void;
  setTabError: (id: string, error: string) => void;
  setTabExecuting: (id: string, executing: boolean) => void;
  setTabCancelled: (id: string, cancelled: boolean) => void;
  addHistory: (item: Omit<QueryHistoryItem, "timestamp">) => void;
  toggleHistory: () => void;
}

export const useQueryStore = create<QueryState>((set, get) => ({
  tabs: [],
  activeTabId: null,
  history: [],
  historyExpanded: false,

  newTab: () => {
    const tab: QueryTab = {
      id: generateId(),
      name: "",
      sql: "",
      isExecuting: false,
      isCancelled: false,
    };
    set((state) => ({
      tabs: [...state.tabs, tab],
      activeTabId: tab.id,
    }));
    return tab.id;
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

  execute: async (connectionId, id, limit, selectedSql) => {
    get().setTabExecuting(id, true);
    get().setTabError(id, "");
    get().setTabCancelled(id, false);
    const tab = get().tabs.find((t) => t.id === id);
    if (!tab) return;
    const rawSql = (selectedSql ?? tab.sql).trim();
    if (!rawSql) return;

    const statements = splitSqlStatements(rawSql);
    if (statements.length === 0) return;

    const startTime = performance.now();
    let currentDatabase = tab.selectedDatabase;
    let finalResult: QueryResult | UpdateResult | undefined;
    let finalIsQuery = false;
    let totalRowsCount = 0;

    try {
      for (let i = 0; i < statements.length; i++) {
        const stmt = statements[i];
        const isLast = i === statements.length - 1;

        const useMatch = stmt.match(/^USE\s+`?([^`\s]+)`?$/i);
        if (useMatch) {
          currentDatabase = useMatch[1];
          set((state) => ({
            tabs: state.tabs.map((t) =>
              t.id === id ? { ...t, selectedDatabase: currentDatabase } : t,
            ),
          }));
          if (isLast) {
            finalResult = { rowsAffected: 0, elapsedMs: 0 } as UpdateResult;
            finalIsQuery = false;
          }
          continue;
        }

        const firstWord = stmt.split(/\s+/)[0]?.toUpperCase() ?? "";
        const isQuery = ["SELECT", "SHOW", "DESCRIBE", "DESC", "EXPLAIN"].includes(
          firstWord,
        );

        if (isQuery) {
          const result = await queryService.executeQuery(
            connectionId,
            stmt,
            limit,
            currentDatabase,
          );
          totalRowsCount += result.totalCount ?? 0;
          if (isLast) {
            finalResult = result;
            finalIsQuery = true;
          }
        } else {
          const result = await queryService.executeUpdate(
            connectionId,
            stmt,
            currentDatabase,
          );
          totalRowsCount += result.rowsAffected ?? 0;
          if (isLast) {
            finalResult = result;
            finalIsQuery = false;
          }
        }
      }

      if (finalResult) {
        get().setTabResult(id, finalResult, finalIsQuery);
      }

      const elapsedMs = Math.round(performance.now() - startTime);
      get().addHistory({
        sql: rawSql,
        status: "success",
        elapsedMs,
        rowsCount: totalRowsCount,
      });
    } catch (err) {
      const elapsedMs = Math.round(performance.now() - startTime);
      const msg = parseTauriError(err);
      get().setTabError(id, msg);
      get().addHistory({
        sql: rawSql,
        status: "error",
        error: msg,
        elapsedMs,
      });
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

  addHistory: (item) => {
    set((state) => ({
      history: [{ ...item, timestamp: Date.now() }, ...state.history].slice(
        0,
        100,
      ),
    }));
  },

  toggleHistory: () => {
    set((state) => ({ historyExpanded: !state.historyExpanded }));
  },
}));

import { create } from "zustand";
import type {
  QueryHistoryItem,
  QueryResult,
  QueryTab,
  TableBrowseState,
  UpdateResult,
} from "../types";
import { generateId } from "../lib/utils";
import { buildCountSql, buildTableSelect, escapeMysqlIdentifier, splitSqlStatements } from "../lib/sql";
import * as queryService from "../services/queryService";
import { parseTauriError } from "../lib/error";
import { showError } from "./toastStore";

/** Default rows per fetch for table browsing. */
const BROWSE_PAGE_SIZE = 50;

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
  /** Open a table for browsing in the active (or a new) tab: PK lookup,
   *  paged first fetch, and a background COUNT(*) for the pager. */
  openTable: (connectionId: string, database: string, table: string) => Promise<void>;
  /** Fetch one page of the browsed table and update the tab's SQL/state. */
  browsePage: (
    connectionId: string,
    id: string,
    page: number,
    pageSize?: number,
  ) => Promise<void>;
  /** Re-run COUNT(*) for the browsed table (pager refresh). */
  refreshBrowseCount: (connectionId: string, id: string) => Promise<void>;
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
  setTabTableBrowse: (id: string, info: TableBrowseState) => void;
  setTabSelectedDatabase: (id: string, database: string) => void;
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

    // All early returns must stay inside try/finally — leaving isExecuting
    // stuck true permanently disables the Execute button for the tab.
    try {
      const tab = get().tabs.find((t) => t.id === id);
      if (!tab) return;
      const rawSql = (selectedSql ?? tab.sql).trim();
      if (!rawSql) return;

      const statements = splitSqlStatements(rawSql);
      if (statements.length === 0) return;

      // Remember the exact query (and limit) that produced the next result,
      // so the grid can refresh without re-running whatever the user has
      // typed into the editor since.
      set((state) => ({
        tabs: state.tabs.map((t) =>
          t.id === id ? { ...t, executedSql: rawSql, executedLimit: limit } : t,
        ),
      }));

      const startTime = performance.now();
      let currentDatabase = tab.selectedDatabase;
      let finalResult: QueryResult | UpdateResult | undefined;
      let finalIsQuery = false;
      let totalRowsCount = 0;

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
      const msg = parseTauriError(err);
      get().setTabError(id, msg);
      showError(msg);
      get().addHistory({
        sql: (selectedSql ?? get().tabs.find((t) => t.id === id)?.sql ?? "").trim(),
        status: "error",
        error: msg,
        elapsedMs: 0,
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

  openTable: async (connectionId, database, table) => {
    const tabId = get().activeTabId ?? get().newTab();

    // Best-effort primary key lookup — needed for stable ORDER BY paging
    // and for inline cell editing. A table without PK still browses fine.
    let primaryKeyColumns: string[] = [];
    try {
      const keysResult = await queryService.executeQuery(
        connectionId,
        `SHOW KEYS FROM ${escapeMysqlIdentifier(database)}.${escapeMysqlIdentifier(table)} WHERE Key_name = 'PRIMARY'`,
        undefined,
        database,
      );
      const colIdx = keysResult.columns.findIndex((c) => c.name === "Column_name");
      if (colIdx >= 0) {
        primaryKeyColumns = keysResult.rows.map((r) => String(r[colIdx] ?? ""));
      }
    } catch (err) {
      console.error("Failed to fetch primary key columns:", err);
    }

    get().setTabTableBrowse(tabId, {
      database,
      table,
      primaryKeyColumns,
      pageSize: BROWSE_PAGE_SIZE,
      page: 1,
    });
    await get().browsePage(connectionId, tabId, 1, BROWSE_PAGE_SIZE);
    // Count may take a while on large InnoDB tables — update the pager when
    // it arrives instead of blocking the first page of data.
    get().refreshBrowseCount(connectionId, tabId);
  },

  browsePage: async (connectionId, id, page, pageSize) => {
    const tab = get().tabs.find((t) => t.id === id);
    const browse = tab?.tableBrowse;
    if (!tab || !browse || tab.isExecuting) return;

    const size = pageSize ?? browse.pageSize;
    // Clamp when the total is known (e.g. page size shrunk or rows were deleted).
    const totalPages =
      browse.totalRows !== undefined ? Math.max(1, Math.ceil(browse.totalRows / size)) : undefined;
    const targetPage = totalPages !== undefined ? Math.min(Math.max(1, page), totalPages) : Math.max(1, page);
    const offset = (targetPage - 1) * size;
    const sql = buildTableSelect(browse.database, browse.table, browse.primaryKeyColumns, offset, size);

    get().setTabExecuting(id, true);
    get().setTabError(id, "");
    set((state) => ({
      tabs: state.tabs.map((t) =>
        t.id === id
          ? {
              ...t,
              sql,
              name: browse.table,
              executedSql: sql,
              executedLimit: size,
              tableBrowse: { ...browse, page: targetPage, pageSize: size },
            }
          : t,
      ),
    }));

    try {
      const result = await queryService.executeQuery(connectionId, sql, size, browse.database);
      let totalRows = browse.totalRows;
      // Count not arrived yet (or failed): a short page means we hit the end.
      if (totalRows === undefined && result.rows.length < size) {
        totalRows = offset + result.rows.length;
      }
      set((state) => ({
        tabs: state.tabs.map((t) =>
          t.id === id
            ? {
                ...t,
                result,
                isQueryResult: true,
                tableBrowse: t.tableBrowse ? { ...t.tableBrowse, totalRows } : t.tableBrowse,
              }
            : t,
        ),
      }));
      // All rows on a later page were deleted — step back until data shows.
      if (targetPage > 1 && result.rows.length === 0 && (totalRows === undefined || totalRows > 0)) {
        await get().browsePage(connectionId, id, targetPage - 1, size);
      }
    } catch (err) {
      const msg = parseTauriError(err);
      get().setTabError(id, msg);
      showError(msg);
    } finally {
      get().setTabExecuting(id, false);
    }
  },

  refreshBrowseCount: async (connectionId, id) => {
    const tab = get().tabs.find((t) => t.id === id);
    const browse = tab?.tableBrowse;
    if (!tab || !browse) return;
    try {
      const countResult = await queryService.executeQuery(
        connectionId,
        buildCountSql(browse.database, browse.table),
        1,
        browse.database,
      );
      const count = Number(countResult.rows[0]?.[0] ?? 0);
      set((state) => ({
        tabs: state.tabs.map((t) =>
          t.id === id && t.tableBrowse
            ? { ...t, tableBrowse: { ...t.tableBrowse, totalRows: count } }
            : t,
        ),
      }));
    } catch (err) {
      // Pager shows "unknown" and falls back to short-page detection.
      console.error("Failed to count table rows:", err);
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
  toggleHistory: () =>
    set((state) => ({ historyExpanded: !state.historyExpanded })),

  setTabTableBrowse: (id, info) =>
    set((state) => ({
      tabs: state.tabs.map((t) =>
        t.id === id ? { ...t, tableBrowse: info } : t,
      ),
    })),

  setTabSelectedDatabase: (id, database) =>
    set((state) => ({
      tabs: state.tabs.map((t) =>
        t.id === id ? { ...t, selectedDatabase: database } : t,
      ),
    })),
}));

import { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import {
  Search,
  RefreshCw,
  ChevronLeft,
  Table,
  Database as DatabaseIcon,
  Columns3,
} from "lucide-react";
import { useConnectionStore } from "../../stores/connectionStore";
import { useLayoutStore } from "../../stores/layoutStore";
import { useQueryStore } from "../../stores/queryStore";
import * as schemaService from "../../services/schemaService";
import * as queryService from "../../services/queryService";
import type { Database, Table as TableType } from "../../types";
import { VirtualTree, type TreeNode } from "../virtual/VirtualTree";
import { parseTauriError } from "../../lib/error";
import { ExportDialog } from "../export/ExportDialog";

interface SchemaNodeData {
  type: "database" | "table" | "column";
  name: string;
  database?: string;
  table?: string;
  columnType?: string;
}

interface ContextMenuState {
  x: number;
  y: number;
  db: string;
  table: string;
}

export function SchemaTreePanel() {
  const { t } = useTranslation("schema");
  const activeId = useConnectionStore((s) => s.activeId);
  const statusMap = useConnectionStore((s) => s.statusMap);
  const setSidebarView = useLayoutStore((s) => s.setSidebarView);
  const [databases, setDatabases] = useState<Database[]>([]);
  const [tablesMap, setTablesMap] = useState<Record<string, TableType[]>>({});
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [loadingKey, setLoadingKey] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [exportTable, setExportTable] = useState<{ db: string; table: string } | null>(null);

  // Close context menu on any click
  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [contextMenu]);

  const loadDatabases = useCallback(async () => {
    if (!activeId || statusMap[activeId] !== "connected") return;
    try {
      setErrorMsg(null);
      const dbs = await schemaService.getDatabases(activeId);
      setDatabases(dbs);
    } catch (err) {
      const msg = parseTauriError(err);
      setErrorMsg(t("loadDatabasesFailed", { msg }));
      console.error("Failed to load databases:", err);
    }
  }, [activeId, statusMap]);

  useEffect(() => {
    loadDatabases();
  }, [loadDatabases]);

  const handleToggle = async (key: string) => {
    const next = new Set(expandedKeys);
    if (next.has(key)) {
      next.delete(key);
      setExpandedKeys(next);
      return;
    }

    next.add(key);
    setExpandedKeys(new Set(next));

    if (key.startsWith("db:") && activeId) {
      const dbName = key.slice(3);
      // Auto-select this database for the active query tab
      const queryStore = useQueryStore.getState();
      const tabId = queryStore.activeTabId ?? queryStore.newTab();
      queryStore.setTabSelectedDatabase(tabId, dbName);

      if (!tablesMap[dbName]) {
        setLoadingKey(key);
        setErrorMsg(null);
        try {
          const tables = await schemaService.getTables(activeId, dbName);
          setTablesMap((prev) => ({ ...prev, [dbName]: tables }));
        } catch (err) {
          const msg = parseTauriError(err);
          setErrorMsg(t("loadTablesFailed", { dbName, msg }));
          console.error("Failed to load tables:", err);
        } finally {
          setLoadingKey(null);
        }
      }
    }
  };

  const handleTableClick = async (db: string, table: string) => {
    if (!activeId) return;
    const queryStore = useQueryStore.getState();
    const tabId = queryStore.activeTabId ?? queryStore.newTab();
    const sql = `SELECT * FROM \`${db}\`.\`${table}\` LIMIT 1000;`;
    queryStore.setTabSql(tabId, sql);
    queryStore.setTabSelectedDatabase(tabId, db);

    try {
      const keysResult = await queryService.executeQuery(
        activeId,
        `SHOW KEYS FROM \`${db}\`.\`${table}\` WHERE Key_name = 'PRIMARY'`,
        undefined,
        db,
      );
      const colIdx = keysResult.columns.findIndex((c) => c.name === "Column_name");
      const primaryKeyColumns = colIdx >= 0
        ? keysResult.rows.map((r) => String(r[colIdx] ?? ""))
        : [];
      queryStore.setTabEditableTable(tabId, { database: db, table, primaryKeyColumns });
    } catch (err) {
      console.error("Failed to fetch primary key columns:", err);
      queryStore.setTabEditableTable(tabId, { database: db, table, primaryKeyColumns: [] });
    }

    await queryStore.execute(activeId, tabId);
  };

  const handleRefresh = () => {
    if (activeId) {
      schemaService.refreshSchema(activeId);
      setTablesMap({});
      setExpandedKeys(new Set());
      loadDatabases();
    }
  };

  const handleExportData = (db: string, table: string) => {
    if (!activeId) return;
    setExportTable({ db, table });
  };

  const handleNodeContextMenu = (
    _key: string,
    data: SchemaNodeData,
    event: React.MouseEvent,
  ) => {
    if (data.type !== "table" || !data.database) return;
    event.preventDefault();
    setContextMenu({
      x: event.clientX,
      y: event.clientY,
      db: data.database,
      table: data.name,
    });
  };

  const roots: TreeNode<SchemaNodeData>[] = databases.map((db) => {
    const dbKey = `db:${db.name}`;
    const tables = tablesMap[db.name] ?? [];
    return {
      id: dbKey,
      data: { type: "database", name: db.name },
      children: tables.map((table) => {
        const tableKey = `table:${db.name}:${table.name}`;
        return {
          id: tableKey,
          data: { type: "table", name: table.name, database: db.name },
        };
      }),
    };
  });

  const filteredRoots = search
    ? roots
        .map((db) => ({
          ...db,
          children: db.children
            ?.filter((table) =>
              table.data.name.toLowerCase().includes(search.toLowerCase()),
            )
        }))
        .filter(
          (db) =>
            db.data.name.toLowerCase().includes(search.toLowerCase()) ||
            (db.children && db.children.length > 0),
        )
    : roots;

  if (!activeId || statusMap[activeId] !== "connected") {
    return (
      <div className="h-full flex flex-col items-center justify-center text-muted-foreground p-4">
        <p className="text-sm">{t("notConnected")}</p>
        <button
          className="mt-2 text-xs text-primary flex items-center gap-1"
          onClick={() => setSidebarView("connection")}
        >
          <ChevronLeft size={14} />
          {t("backToConnections")}
        </button>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center gap-1 p-2 border-b border-border">
        <button
          className="p-1 rounded hover:bg-accent"
          onClick={() => setSidebarView("connection")}
        >
          <ChevronLeft size={14} />
        </button>
        <div className="flex-1 flex items-center bg-background border border-border rounded px-2 py-1">
          <Search size={12} className="text-muted-foreground mr-1" />
          <input
            className="flex-1 bg-transparent text-xs outline-none"
            placeholder={t("search")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <button className="p-1 rounded hover:bg-accent" onClick={handleRefresh}>
          <RefreshCw size={14} />
        </button>
      </div>

      {errorMsg && (
        <div className="px-3 py-2 text-xs text-destructive bg-destructive/10 border-b border-border">
          {errorMsg}
        </div>
      )}

      {loadingKey?.startsWith("db:") && (
        <div className="px-3 py-1 text-xs text-muted-foreground">
          {t("loadingTables", { dbName: loadingKey.slice(3) })}
        </div>
      )}

      <div className="flex-1 overflow-hidden">
        <VirtualTree
          roots={filteredRoots}
          expandedKeys={expandedKeys}
          onToggle={handleToggle}
          hasChildren={(data) => data.type === "database"}
          onNodeClick={(_key, data) => {
            if (data.type === "table" && data.database) {
              handleTableClick(data.database, data.name);
            }
          }}
          onNodeContextMenu={handleNodeContextMenu}
          renderNode={(data, _depth, _isExpanded) => {
            if (data.type === "database") {
              const isLoading = loadingKey === `db:${data.name}`;
              return (
                <span className="text-sm font-medium truncate flex items-center gap-1">
                  <DatabaseIcon size={12} className="text-muted-foreground" />
                  {data.name}
                  {isLoading && (
                    <span className="text-xs text-muted-foreground animate-pulse">
                      {t("loading")}
                    </span>
                  )}
                </span>
              );
            }
            if (data.type === "table") {
              return (
                <span className="text-sm truncate flex items-center gap-1 flex-1">
                  <Table size={14} className="text-primary shrink-0" />
                  <span className="font-medium truncate">{data.name}</span>
                  <button
                    className="p-0.5 rounded hover:bg-accent opacity-0 group-hover:opacity-100"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (data.database) {
                        useLayoutStore
                          .getState()
                          .openDrawer("tableStructure", {
                            database: data.database,
                            table: data.name,
                          });
                      }
                    }}
                    title={t("viewStructure")}
                  >
                    <Columns3 size={12} />
                  </button>
                </span>
              );
            }
            return (
              <span className="text-xs truncate flex items-center gap-1 text-muted-foreground">
                <span className="font-medium">{data.name}</span>
                <span className="text-[10px]">({data.columnType})</span>
              </span>
            );
          }}
        />
      </div>

      {/* Export dialog */}
      {exportTable && activeId && (
        <ExportDialog
          connectionId={activeId}
          database={exportTable.db}
          table={exportTable.table}
          onClose={() => setExportTable(null)}
        />
      )}

      {/* Right-click context menu for tables */}
      {contextMenu && (
        <div
          className="fixed z-[60] min-w-[140px] py-1 bg-card border border-border rounded-lg shadow-xl"
          style={{
            left: Math.min(contextMenu.x, window.innerWidth - 160),
            top: Math.min(contextMenu.y, window.innerHeight - 100),
          }}
        >
          <button
            type="button"
            onClick={() => {
              handleTableClick(contextMenu.db, contextMenu.table);
              setContextMenu(null);
            }}
            className="w-full px-3 py-2 text-sm text-foreground hover:bg-accent transition-colors text-left"
          >
            查看数据
          </button>
          <button
            type="button"
            onClick={() => {
              handleExportData(contextMenu.db, contextMenu.table);
              setContextMenu(null);
            }}
            className="w-full px-3 py-2 text-sm text-foreground hover:bg-accent transition-colors text-left"
          >
            导出数据
          </button>
          <button
            type="button"
            onClick={() => {
              useLayoutStore
                .getState()
                .openDrawer("tableStructure", {
                  database: contextMenu.db,
                  table: contextMenu.table,
                });
              setContextMenu(null);
            }}
            className="w-full px-3 py-2 text-sm text-foreground hover:bg-accent transition-colors text-left"
          >
            查看结构
          </button>
        </div>
      )}
    </div>
  );
}

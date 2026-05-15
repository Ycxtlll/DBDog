import { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import {
  Search,
  RefreshCw,
  ChevronLeft,
  Table,
  Eye,
  Database as DatabaseIcon,
  Columns3,
} from "lucide-react";
import { useConnectionStore } from "../../stores/connectionStore";
import { useLayoutStore } from "../../stores/layoutStore";
import { useQueryStore } from "../../stores/queryStore";
import * as schemaService from "../../services/schemaService";
import type { Database, Table as TableType, Column } from "../../types";
import { VirtualTree, type TreeNode } from "../virtual/VirtualTree";
import { parseTauriError } from "../../lib/error";

interface SchemaNodeData {
  type: "database" | "table" | "column";
  name: string;
  database?: string;
  table?: string;
  columnType?: string;
}

export function SchemaTreePanel() {
  const { t } = useTranslation("schema");
  const activeId = useConnectionStore((s) => s.activeId);
  const statusMap = useConnectionStore((s) => s.statusMap);
  const setSidebarView = useLayoutStore((s) => s.setSidebarView);
  const [databases, setDatabases] = useState<Database[]>([]);
  const [tablesMap, setTablesMap] = useState<Record<string, TableType[]>>({});
  const [columnsMap, setColumnsMap] = useState<Record<string, Column[]>>({});
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [loadingKey, setLoadingKey] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

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
    } else if (key.startsWith("table:") && activeId) {
      const parts = key.split(":");
      const dbName = parts[1];
      const tableName = parts[2];
      const colKey = `${dbName}.${tableName}`;
      if (!columnsMap[colKey]) {
        setLoadingKey(key);
        setErrorMsg(null);
        try {
          const details = await schemaService.getTableDetails(
            activeId,
            dbName,
            tableName,
          );
          setColumnsMap((prev) => ({ ...prev, [colKey]: details.columns }));
        } catch (err) {
          const msg = parseTauriError(err);
          setErrorMsg(t("loadColumnsFailed", { colKey, msg }));
          console.error("Failed to load columns:", err);
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
    await queryStore.execute(activeId, tabId);
  };

  const handleRefresh = () => {
    if (activeId) {
      schemaService.refreshSchema(activeId);
      setTablesMap({});
      setColumnsMap({});
      setExpandedKeys(new Set());
      loadDatabases();
    }
  };

  const roots: TreeNode<SchemaNodeData>[] = databases.map((db) => {
    const dbKey = `db:${db.name}`;
    const tables = tablesMap[db.name] ?? [];
    return {
      id: dbKey,
      data: { type: "database", name: db.name },
      children: tables.map((table) => {
        const tableKey = `table:${db.name}:${table.name}`;
        const colKey = `${db.name}.${table.name}`;
        const columns = columnsMap[colKey] ?? [];
        return {
          id: tableKey,
          data: { type: "table", name: table.name, database: db.name },
          children: columns.map((col) => ({
            id: `col:${db.name}:${table.name}:${col.name}`,
            data: {
              type: "column",
              name: col.name,
              database: db.name,
              table: table.name,
              columnType: col.dataType,
            },
          })),
        };
      }),
    };
  });

  const filteredRoots = search
    ? roots
        .map((db) => ({
          ...db,
          children: db.children
            ?.map((table) => {
              const colMatch = table.children?.filter((c) =>
                c.data.name.toLowerCase().includes(search.toLowerCase()),
              );
              const tableMatch = table.data.name
                .toLowerCase()
                .includes(search.toLowerCase());
              if (tableMatch || (colMatch && colMatch.length > 0)) {
                return { ...table, children: colMatch ?? table.children };
              }
              return null;
            })
            .filter(Boolean) as TreeNode<SchemaNodeData>[] | undefined,
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
          hasChildren={(data) =>
            data.type === "database" || data.type === "table"
          }
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
                  <Table size={12} className="text-muted-foreground" />
                  <span className="flex-1 truncate">{data.name}</span>
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
                    <Eye size={12} />
                  </button>
                  <button
                    className="p-0.5 rounded hover:bg-accent opacity-0 group-hover:opacity-100"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (data.database && data.name)
                        handleTableClick(data.database, data.name);
                    }}
                    title="SELECT *"
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
    </div>
  );
}

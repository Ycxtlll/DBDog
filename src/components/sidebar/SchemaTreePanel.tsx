import { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { Search, RefreshCw, ChevronLeft, Table, Eye } from "lucide-react";
import { useConnectionStore } from "../../stores/connectionStore";
import { useLayoutStore } from "../../stores/layoutStore";
import { useQueryStore } from "../../stores/queryStore";
import * as schemaService from "../../services/schemaService";
import type { Database, Table as TableType } from "../../types";
import { VirtualTree, type TreeNode } from "../virtual/VirtualTree";

interface SchemaNodeData {
  type: "database" | "table";
  name: string;
  database?: string;
}

export function SchemaTreePanel() {
  const { t } = useTranslation("schema");
  const { activeId, statusMap } = useConnectionStore();
  const { setSidebarView } = useLayoutStore();
  const [databases, setDatabases] = useState<Database[]>([]);
  const [tablesMap, setTablesMap] = useState<Record<string, TableType[]>>({});
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [loadingDb, setLoadingDb] = useState<string | null>(null);

  const loadDatabases = useCallback(async () => {
    if (!activeId || statusMap[activeId] !== "connected") return;
    try {
      const dbs = await schemaService.getDatabases(activeId);
      setDatabases(dbs);
    } catch (err) {
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
    } else {
      next.add(key);
      const [type, dbName] = key.split(":");
      if (type === "db" && activeId && !tablesMap[dbName]) {
        setLoadingDb(dbName);
        try {
          const tables = await schemaService.getTables(activeId, dbName);
          setTablesMap((prev) => ({ ...prev, [dbName]: tables }));
        } catch (err) {
          console.error("Failed to load tables:", err);
        } finally {
          setLoadingDb(null);
        }
      }
    }
    setExpandedKeys(next);
  };

  const handleTableClick = (db: string, table: string) => {
    const queryStore = useQueryStore.getState();
    if (!queryStore.activeTabId) {
      queryStore.newTab();
    }
    const activeTab = queryStore.tabs.find(
      (t) => t.id === queryStore.activeTabId,
    );
    if (activeTab) {
      const sql = `SELECT * FROM \`${db}\`.\`${table}\` LIMIT 1000;`;
      queryStore.setTabSql(activeTab.id, sql);
    }
  };

  const handleRefresh = () => {
    if (activeId) {
      schemaService.refreshSchema(activeId);
      setTablesMap({});
      loadDatabases();
    }
  };

  const roots: TreeNode<SchemaNodeData>[] = databases.map((db) => {
    const dbKey = `db:${db.name}`;
    const tables = tablesMap[db.name] ?? [];
    return {
      id: dbKey,
      data: { type: "database", name: db.name },
      children: tables.map((table) => ({
        id: `table:${db.name}:${table.name}`,
        data: { type: "table", name: table.name, database: db.name },
      })),
    };
  });

  const filteredRoots = search
    ? roots
        .map((db) => ({
          ...db,
          children: db.children?.filter((t) =>
            t.data.name.toLowerCase().includes(search.toLowerCase()),
          ),
        }))
        .filter((db) => db.children && db.children.length > 0)
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
      <div className="flex-1 overflow-hidden">
        <VirtualTree
          roots={filteredRoots}
          expandedKeys={expandedKeys}
          onToggle={handleToggle}
          renderNode={(data, _depth, _isExpanded) => {
            if (data.type === "database") {
              return (
                <span className="text-sm font-medium truncate">
                  {data.name} {loadingDb === data.name && "..."}
                </span>
              );
            }
            return (
              <span className="text-sm truncate flex items-center gap-1 flex-1">
                <Table size={12} className="text-muted-foreground" />
                <span
                  className="flex-1 truncate"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (data.database)
                      handleTableClick(data.database, data.name);
                  }}
                >
                  {data.name}
                </span>
                <button
                  className="p-0.5 rounded hover:bg-accent opacity-0 group-hover:opacity-100"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (data.database) {
                      useLayoutStore.getState().openDrawer("tableStructure", {
                        database: data.database,
                        table: data.name,
                      });
                    }
                  }}
                  title={t("viewStructure")}
                >
                  <Eye size={12} />
                </button>
              </span>
            );
          }}
        />
      </div>
    </div>
  );
}

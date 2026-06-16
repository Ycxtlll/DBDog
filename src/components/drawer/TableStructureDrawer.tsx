import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { X } from "lucide-react";
import { useLayoutStore } from "../../stores/layoutStore";
import * as schemaService from "../../services/schemaService";
import { parseTauriError } from "../../lib/error";
import type { TableDetails } from "../../types";
import { VirtualList } from "../virtual/VirtualList";
import CodeMirror from "@uiw/react-codemirror";
import { sql } from "@codemirror/lang-sql";
import { vscodeDark } from "@uiw/codemirror-theme-vscode";


interface TableStructureDrawerProps {
  connectionId: string | null;
}

export function TableStructureDrawer({
  connectionId,
}: TableStructureDrawerProps) {
  const { t } = useTranslation("schema");
  const { drawer, closeDrawer } = useLayoutStore();
  const [details, setDetails] = useState<TableDetails | null>(null);
  const [activeTab, setActiveTab] = useState<
    "columns" | "indexes" | "foreignKeys" | "triggers" | "sql"
  >("columns");
  const [error, setError] = useState<string | null>(null);

  const params = drawer.params;
  const db = typeof params?.database === "string" ? params.database : undefined;
  const table = typeof params?.table === "string" ? params.table : undefined;

  useEffect(() => {
    async function load() {
      if (drawer.type === "tableStructure" && connectionId && db && table) {
        setError(null);
        try {
          const data = await schemaService.getTableDetails(connectionId, db, table);
          setDetails(data);
        } catch (err) {
          const msg = parseTauriError(err);
          setError(msg);
          setDetails(null);
          console.error("Failed to load table details:", err);
        }
      } else {
        setDetails(null);
        setError(null);
      }
    }
    load();
  }, [drawer.type, connectionId, db, table]);

  if (drawer.type !== "tableStructure") return null;

  return (
    <div className="absolute right-0 top-0 bottom-6 w-[400px] bg-card border-l border-border shadow-xl z-40 flex flex-col">
      <div className="flex items-center justify-between p-3 border-b border-border">
        <div>
          <div className="font-semibold">{table}</div>
          <div className="text-xs text-muted-foreground">{db}</div>
        </div>
        <button className="p-1 rounded hover:bg-accent" onClick={closeDrawer}>
          <X size={16} />
        </button>
      </div>
      <div className="flex border-b border-border">
        {(
          ["columns", "indexes", "foreignKeys", "triggers", "sql"] as const
        ).map((tab) => (
          <button
            key={tab}
            className={`flex-1 px-2 py-1.5 text-xs ${activeTab === tab ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-accent/50"}`}
            onClick={() => setActiveTab(tab)}
          >
            {t(tab)}
          </button>
        ))}
      </div>
      {error && (
        <div className="px-3 py-2 text-xs text-destructive bg-destructive/10 border-b border-border">
          {error}
        </div>
      )}
      <div className="flex-1 overflow-hidden">
        {activeTab === "columns" && details && (
          <VirtualList
            items={details.columns}
            rowHeight={36}
            renderItem={(col) => (
              <div className="px-3 py-2 border-b border-border/50 text-sm flex items-center justify-between">
                <div>
                  <span className="font-medium">{col.name}</span>
                  <span className="text-xs text-muted-foreground ml-2">
                    {col.dataType}
                  </span>
                </div>
                <div className="text-xs text-muted-foreground">
                  {col.isPrimaryKey && "PK "}
                  {col.isAutoIncrement && "AI "}
                  {!col.nullable && "NOT NULL"}
                </div>
              </div>
            )}
          />
        )}
        {activeTab === "indexes" && details && (
          <VirtualList
            items={details.indexes}
            rowHeight={36}
            renderItem={(idx) => (
              <div className="px-3 py-2 border-b border-border/50 text-sm">
                <span className="font-medium">{idx.name}</span>
                <span className="text-xs text-muted-foreground ml-2">
                  ({idx.columns.join(", ")})
                </span>
                <span className="text-xs text-muted-foreground ml-2">
                  {idx.indexType}
                </span>
              </div>
            )}
          />
        )}
        {activeTab === "foreignKeys" && details && (
          <VirtualList
            items={details.foreignKeys}
            rowHeight={36}
            renderItem={(fk) => (
              <div className="px-3 py-2 border-b border-border/50 text-sm">
                {fk.column}
                {fk.referencedTable && fk.referencedColumn
                  ? ` → ${fk.referencedTable}.${fk.referencedColumn}`
                  : null}
              </div>
            )}
          />
        )}
        {activeTab === "triggers" && details && (
          <VirtualList
            items={details.triggers}
            rowHeight={36}
            renderItem={(tr) => (
              <div className="px-3 py-2 border-b border-border/50 text-sm">
                <span className="font-medium">{tr.name}</span>
                <span className="text-xs text-muted-foreground ml-2">
                  {tr.timing} {tr.event}
                </span>
              </div>
            )}
          />
        )}
        {activeTab === "sql" && details && (
          <div className="h-full overflow-auto">
            <CodeMirror
              value={details.createTableSql}
              extensions={[sql()]}
              readOnly
              theme={vscodeDark}
              basicSetup={{ lineNumbers: false, foldGutter: false, highlightActiveLine: false }}
              className="text-xs"
            />
          </div>
        )}
      </div>
    </div>
  );
}

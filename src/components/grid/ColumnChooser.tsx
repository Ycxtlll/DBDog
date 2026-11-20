import { useCallback, useEffect, useState } from "react";
import type { AgGridReact } from "ag-grid-react";
import { useTranslation } from "react-i18next";
import { Columns3 } from "lucide-react";
import { Checkbox } from "../ui/Checkbox";
import { clearGridState } from "../../lib/gridState";
import type { TableBrowseState } from "../../types";

interface ColumnChooserProps {
  gridRef: React.RefObject<AgGridReact | null>;
  activeConnectionId: string | null;
  browse: TableBrowseState | undefined;
}

/**
 * Column visibility chooser: a toolbar button opening the popover with one
 * checkbox per data column. Widths/order/visibility persist per
 * connection+database+table (browse mode only) so a wide table opens the way
 * the user left it.
 */
export function ColumnChooser({ gridRef, activeConnectionId, browse }: ColumnChooserProps) {
  const { t } = useTranslation("query");
  const [chooserOpen, setChooserOpen] = useState(false);
  const [hiddenCols, setHiddenCols] = useState<Set<string>>(new Set());

  const dataColumnIds = useCallback((): string[] => {
    const api = gridRef.current?.api;
    if (!api) return [];
    return (api.getColumns() ?? [])
      .map((c) => c.getColId())
      .filter((id) => id !== "__select");
  }, [gridRef]);

  const toggleColumn = useCallback(
    (col: string) => {
      const api = gridRef.current?.api;
      const column = api?.getColumn(col);
      if (!api || !column) return;
      const nextVisible = !column.isVisible();
      api.setColumnVisible(col, nextVisible);
      setHiddenCols((prev) => {
        const next = new Set(prev);
        if (nextVisible) next.delete(col);
        else next.add(col);
        return next;
      });
    },
    [gridRef],
  );

  const showAllColumns = useCallback(() => {
    const api = gridRef.current?.api;
    if (!api) return;
    for (const col of dataColumnIds()) api.setColumnVisible(col, true);
    setHiddenCols(new Set());
  }, [dataColumnIds, gridRef]);

  const resetColumnLayout = useCallback(() => {
    if (!activeConnectionId || !browse) return;
    clearGridState(activeConnectionId, browse.database, browse.table);
    gridRef.current?.api?.resetColumnState();
    setHiddenCols(new Set());
    setChooserOpen(false);
  }, [activeConnectionId, browse, gridRef]);

  // Chooser opens → read live visibility from the grid (skips the selection
  // column — it is chrome, not data).
  useEffect(() => {
    if (!chooserOpen) return;
    const api = gridRef.current?.api;
    if (!api) return;
    const hidden = new Set<string>();
    for (const c of api.getColumns() ?? []) {
      const id = c.getColId();
      if (id !== "__select" && !c.isVisible()) hidden.add(id);
    }
    setHiddenCols(hidden);
  }, [chooserOpen, gridRef]);

  if (!browse) return null;

  return (
    <div className="relative">
      <button
        onClick={() => setChooserOpen((o) => !o)}
        title={t("columns")}
        className={`p-1 rounded-md hover:bg-accent text-muted-foreground hover:text-foreground transition-colors ${chooserOpen ? "bg-accent text-foreground" : ""}`}
      >
        <Columns3 size={12} />
      </button>
      {chooserOpen && (
        <>
          <div className="fixed inset-0 z-40" onMouseDown={() => setChooserOpen(false)} />
          <div className="absolute right-0 top-full mt-1 z-50 min-w-[180px] max-h-72 overflow-y-auto bg-card border border-border rounded-lg shadow-xl py-1 animate-menu-in">
            <div className="flex items-center justify-between px-2 py-1 border-b border-border">
              <span className="text-[11px] text-muted-foreground">{t("columns")}</span>
              <div className="flex items-center gap-1">
                <button
                  onClick={showAllColumns}
                  className="text-[11px] text-primary hover:underline"
                >
                  {t("showAllColumns")}
                </button>
                <button
                  onClick={resetColumnLayout}
                  className="text-[11px] text-muted-foreground hover:text-foreground"
                  title={t("resetLayout")}
                >
                  {t("resetLayout")}
                </button>
              </div>
            </div>
            {dataColumnIds().map((col) => (
              <div key={col} className="px-2 py-0.5">
                <Checkbox checked={!hiddenCols.has(col)} onChange={() => toggleColumn(col)}>
                  <span className="text-xs font-mono">{col}</span>
                </Checkbox>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

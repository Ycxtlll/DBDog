import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Braces,
  Check,
  Ban,
  CircleDot,
  CircleSlash,
  CornerDownRight,
  Copy,
  Database,
  Eye,
  FileJson,
  Filter,
  FilterX,
  GitFork,
  Pin,
  Rows3,
  Trash2,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { QueryResult, ReverseReference, TableBrowseState, TableRelationship } from "../../types";
import { confirmDialog } from "../../lib/confirm";
import { buildInsertStatements } from "../../lib/sql";
import {
  formatCellValue,
  getFilterType,
  tryParseJson,
  type ContextMenuState,
} from "./gridHelpers";

/** One row of the grid context menu (icon + label, project menu style). */
function MenuRow({
  icon: Icon,
  label,
  onClick,
  destructive,
}: {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
  destructive?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full px-3 py-1.5 text-sm hover:bg-accent transition-colors text-left flex items-center gap-2 ${
        destructive ? "text-destructive hover:bg-destructive/10" : "text-foreground"
      }`}
    >
      <Icon size={14} className={`shrink-0 ${destructive ? "" : "text-muted-foreground"}`} />
      {label}
    </button>
  );
}

interface GridContextMenuProps {
  contextMenu: ContextMenuState;
  onClose: () => void;
  queryResult: QueryResult;
  browse: TableBrowseState | undefined;
  selectedRows: Record<string, unknown>[];
  fkByColumn: Map<string, TableRelationship>;
  referencedBy: ReverseReference[];
  setRelModalCol: (col: string | null) => void;
  adjudicateRel: (rel: TableRelationship, confirm: boolean) => void;
  viewReferencingRows: (ref: ReverseReference, value: unknown) => void;
  /** Quick-filter the clicked column, merged over the live filter model. */
  onQuickFilter: (col: string, model: Record<string, unknown>) => void;
  copyText: (text: string) => void;
  stageNewRow: (row: Record<string, unknown>) => void;
  discardNewRow: (row: Record<string, unknown>) => void;
  pinRow: (row: Record<string, unknown>) => void;
  openRowDetail: (row: Record<string, unknown>, col?: string, tableName?: string) => void;
  handleDeleteRow: (row: Record<string, unknown>) => void;
}

/** The grid's right-click menu: copy / quick filter / FK ops / row ops.
 *  Copy actions work on any query result; row ops stay browse-only. */
export function GridContextMenu({
  contextMenu,
  onClose,
  queryResult,
  browse,
  selectedRows,
  fkByColumn,
  referencedBy,
  setRelModalCol,
  adjudicateRel,
  viewReferencingRows,
  onQuickFilter,
  copyText,
  stageNewRow,
  discardNewRow,
  pinRow,
  openRowDetail,
  handleDeleteRow,
}: GridContextMenuProps) {
  const { t } = useTranslation("query");
  const menuRef = useRef<HTMLDivElement>(null);
  // Final viewport-clamped position; null until measured (menu renders
  // invisible at the raw click point first).
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  // Measure the real menu size and open it toward where there is room —
  // down-right from the cursor by default, flipped upward/leftward when the
  // click sits near the bottom/right edge (native context-menu behavior).
  // The menu therefore always renders fully inside the window; max-height +
  // internal scroll remains only as the physical fallback for windows
  // smaller than the menu itself.
  useLayoutEffect(() => {
    const el = menuRef.current;
    if (!el) return;
    const margin = 8;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    let left = contextMenu.x;
    let top = contextMenu.y;
    if (left + w > vw - margin) {
      left = contextMenu.x - w; // flip: align right edge with the cursor
      if (left < margin) left = margin; // menu wider than the window
    }
    if (top + h > vh - margin) {
      top = contextMenu.y - h; // flip: align bottom edge with the cursor
      if (top < margin) top = margin; // menu taller than the window
    }
    setPos({ left: Math.round(left), top: Math.round(top) });
  }, [contextMenu.x, contextMenu.y]);

  // Close context menu on any click outside
  useEffect(() => {
    const close = () => onClose();
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [onClose]);

  const cols = Object.keys(contextMenu.rowData);
  const menuValue = contextMenu.value;
  const valueIsNull = menuValue === null;
  const parsedJson =
    !valueIsNull && typeof menuValue !== "object" ? tryParseJson(String(menuValue)) : null;
  const colType = queryResult.columns.find((c) => c.name === contextMenu.col)?.dataType ?? "";
  const filterKind =
    getFilterType(colType) === "agNumberColumnFilter"
      ? "number"
      : getFilterType(colType) === "agDateColumnFilter"
        ? "date"
        : "text";
  const numericOk =
    filterKind !== "number" || (menuValue !== null && Number.isFinite(Number(menuValue)));
  const eqNeModel = (eq: boolean): Record<string, unknown> => {
    if (filterKind === "number") {
      return { filterType: "number", type: eq ? "equals" : "notEqual", filter: Number(menuValue) };
    }
    if (filterKind === "date") {
      return { filterType: "date", type: eq ? "equals" : "notEqual", dateFrom: String(menuValue).slice(0, 10) };
    }
    return { filterType: "text", type: eq ? "equals" : "notEqual", filter: formatCellValue(menuValue) };
  };
  const applyQuickFilter = (model: Record<string, unknown>) => {
    onClose();
    onQuickFilter(contextMenu.col, model);
  };
  /** Multi-row copy: TSV (Excel-ready), JSON array, or INSERT statements. */
  const copySelectedRows = (kind: "tsv" | "json" | "insert") => {
    if (selectedRows.length === 0) return;
    const cols = queryResult.columns.map((c) => c.name);
    if (kind === "tsv") {
      const esc = (x: string) => x.replace(/\t/g, " ").replace(/\r?\n/g, " ");
      const body = selectedRows
        .map((r) => cols.map((c) => esc(formatCellValue(r[c]))).join("	"))
        .join("\n");
      copyText(`${cols.join("\t")}\n${body}`);
    } else if (kind === "json") {
      copyText(JSON.stringify(selectedRows, null, 2));
    } else if (browse) {
      copyText(buildInsertStatements(browse.database, browse.table, cols, selectedRows));
    }
  };

  return (
    <div
      ref={menuRef}
      className="fixed z-[60] min-w-[200px] max-w-[92vw] max-h-[calc(100vh-16px)] overflow-y-auto py-1 bg-card border border-border rounded-lg shadow-xl animate-menu-in"
      style={{
        left: pos?.left ?? contextMenu.x,
        top: pos?.top ?? contextMenu.y,
        visibility: pos ? "visible" : "hidden",
      }}
    >
      {selectedRows.length >= 2 && (
        <>
          <MenuRow icon={Copy} label={t("copySelectedTsv", { n: selectedRows.length })} onClick={() => { copySelectedRows("tsv"); onClose(); }} />
          <MenuRow icon={FileJson} label={t("copySelectedJson")} onClick={() => { copySelectedRows("json"); onClose(); }} />
          {browse && (
            <MenuRow icon={Database} label={t("copySelectedInsert")} onClick={() => { copySelectedRows("insert"); onClose(); }} />
          )}
          <div className="my-1 border-t border-border" />
        </>
      )}
      <MenuRow icon={Copy} label={t("copyValue")} onClick={() => { copyText(formatCellValue(menuValue)); onClose(); }} />
      {parsedJson !== null && (
        <MenuRow icon={Braces} label={t("copyAsJson")} onClick={() => { copyText(JSON.stringify(parsedJson, null, 2)); onClose(); }} />
      )}
      <MenuRow icon={Rows3} label={t("copyRow")} onClick={() => { copyText(cols.map((c) => `${c}: ${formatCellValue(contextMenu.rowData[c])}`).join("\n")); onClose(); }} />
      <MenuRow icon={FileJson} label={t("copyRowJson")} onClick={() => { copyText(JSON.stringify(contextMenu.rowData, null, 2)); onClose(); }} />
      {browse && (
        <MenuRow
          icon={Database}
          label={t("copyAsInsert")}
          onClick={() => { copyText(buildInsertStatements(browse.database, browse.table, cols, [contextMenu.rowData])); onClose(); }}
        />
      )}
      <div className="my-1 border-t border-border" />
      {numericOk && !valueIsNull && (
        <MenuRow icon={Filter} label={t("filterByValue")} onClick={() => applyQuickFilter(eqNeModel(true))} />
      )}
      {numericOk && !valueIsNull && (
        <MenuRow icon={FilterX} label={t("excludeValue")} onClick={() => applyQuickFilter(eqNeModel(false))} />
      )}
      <MenuRow icon={CircleSlash} label={t("filterBlank")} onClick={() => applyQuickFilter({ filterType: filterKind, type: "blank" })} />
      <MenuRow icon={CircleDot} label={t("filterNotBlank")} onClick={() => applyQuickFilter({ filterType: filterKind, type: "notBlank" })} />
      {(referencedBy.length > 0 || fkByColumn.get(contextMenu.col)?.source === "inferred") && (
        <div className="my-1 border-t border-border" />
      )}
      {referencedBy.map((ref) => {
        const refValue = ref.parentColumn ? contextMenu.rowData[ref.parentColumn] : null;
        if (refValue === null || refValue === undefined) return null;
        return (
          <MenuRow
            key={`${ref.childTable}.${ref.childColumn}`}
            icon={CornerDownRight}
            label={t("viewReferencingRows", { table: ref.childTable })}
            onClick={() => { viewReferencingRows(ref, refValue); onClose(); }}
          />
        );
      })}
      {(() => {
        const rel = fkByColumn.get(contextMenu.col);
        if (!rel || rel.source !== "inferred") return null;
        return (
          <>
            <MenuRow icon={Check} label={t("confirmRelationship")} onClick={() => { adjudicateRel(rel, true); onClose(); }} />
            <MenuRow icon={Ban} label={t("vetoRelationship")} onClick={() => { adjudicateRel(rel, false); onClose(); }} />
          </>
        );
      })()}
      {browse && (
        <MenuRow
          icon={GitFork}
          label={fkByColumn.get(contextMenu.col) ? t("editRelationship") : t("setRelationship")}
          onClick={() => {
            setRelModalCol(contextMenu.col);
            onClose();
          }}
        />
      )}
      <div className="my-1 border-t border-border" />
      {contextMenu.rowData.__dbdogNew ? (
        <>
          <MenuRow icon={Check} label={t("stageNewRow")} onClick={() => { stageNewRow(contextMenu.rowData); onClose(); }} />
          <MenuRow icon={Trash2} label={t("discardNewRow")} destructive onClick={() => { discardNewRow(contextMenu.rowData); onClose(); }} />
        </>
      ) : (
        <MenuRow icon={Pin} label={t("pinRow")} onClick={() => { pinRow(contextMenu.rowData); onClose(); }} />
      )}
      {!contextMenu.rowData.__dbdogNew && (
        <MenuRow icon={Eye} label={t("viewRowData")} onClick={() => { openRowDetail(contextMenu.rowData, contextMenu.col, browse?.table); onClose(); }} />
      )}
      {browse && !contextMenu.rowData.__dbdogNew && (
        <MenuRow
          icon={Trash2}
          label={t("deleteRow")}
          destructive
          onClick={async () => {
            onClose();
            const confirmed = await confirmDialog(t("confirmDeleteRow"), t("deleteRow"));
            if (confirmed) {
              handleDeleteRow(contextMenu.rowData);
            }
          }}
        />
      )}
    </div>
  );
}

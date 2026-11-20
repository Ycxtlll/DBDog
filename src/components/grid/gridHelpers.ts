/** Shared types + pure helpers extracted from ResultGrid (grid feature). */
import type { CellContextMenuEvent } from "ag-grid-community";

/** Cell the row-detail modal is showing (single-click row inspection). */
export interface DetailCellInfo {
  columnName: string;
  value: unknown;
  rowData: Record<string, unknown>;
  /** Table the row belongs to — parent table on FK jumps. */
  tableName?: string;
}

/** State for the grid's right-click context menu. */
export interface ContextMenuState {
  x: number;
  y: number;
  rowData: Record<string, unknown>;
  /** Column the menu was opened on (right-click target). */
  col: string;
  /** Raw value of the clicked cell (null when NULL/missing). */
  value: unknown;
}

/** Parse a string as a JSON object/array for the "copy as JSON" action. */
export function tryParseJson(s: string): unknown | null {
  const trimmed = s.trim();
  if (!(trimmed.startsWith("{") || trimmed.startsWith("["))) return null;
  try {
    const parsed: unknown = JSON.parse(trimmed);
    return typeof parsed === "object" && parsed !== null ? parsed : null;
  } catch {
    return null;
  }
}

export function formatCellValue(value: unknown): string {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

export function getFilterType(dataType: string): string {
  const upper = dataType?.toUpperCase() ?? "";
  if (
    upper.includes("INT") ||
    upper.includes("FLOAT") ||
    upper.includes("DECIMAL") ||
    upper.includes("DOUBLE") ||
    upper.includes("NUMERIC")
  ) {
    return "agNumberColumnFilter";
  }
  if (
    upper.includes("DATE") ||
    upper.includes("TIME") ||
    upper.includes("YEAR")
  ) {
    return "agDateColumnFilter";
  }
  return "agTextColumnFilter";
}

/** Build context-menu state from an AG Grid context-menu event. */
export function contextMenuFromEvent(event: CellContextMenuEvent): ContextMenuState | null {
  const mouseEvent = event.event as MouseEvent | null;
  if (!mouseEvent) return null;
  const col = String(event.colDef.field ?? event.colDef.headerName ?? "");
  const row = (event.data as Record<string, unknown>) ?? {};
  return {
    x: mouseEvent.clientX,
    y: mouseEvent.clientY,
    rowData: row,
    col,
    value: col in row ? row[col] ?? null : null,
  };
}

/** AG Grid overlay: the paw + woof empty state (single custom layer). */
export function buildNoRowsOverlay(t: (key: string) => string): string {
  const paw =
    '<svg xmlns="http://www.w3.org/2000/svg" width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' +
    '<circle cx="11" cy="4" r="2"/>' +
    '<circle cx="18" cy="8" r="2"/>' +
    '<circle cx="20" cy="16" r="2"/>' +
    '<path d="M9 10a5 5 0 0 1 5 5v3.5a3.5 3.5 0 0 1-6.84 1.045Q6.52 17.48 4.46 16.84A3.5 3.5 0 0 1 5.5 10Z"/>' +
    "</svg>";
  return (
    '<div style="display:flex;flex-direction:column;align-items:center;gap:8px;color:var(--ag-header-icon-color, var(--muted-foreground));opacity:.65">' +
    paw +
    '<div style="font-size:12px">' +
    t("gridEmptyWoof") +
    "</div></div>"
  );
}

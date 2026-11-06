import type { ColumnMeta, QueryResult } from "../types";

function escapeCsvField(value: unknown): string {
  if (value === null || value === undefined) return "NULL";
  const s = String(value);
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/**
 * Convert rows + columns to a CSV string (without header).
 */
function rowsToCsv(rows: unknown[][]): string {
  return rows
    .map((row) =>
      row.map((val) => escapeCsvField(val)).join(","),
    )
    .join("\n");
}

/**
 * Build a CSV header line from column metadata.
 */
function buildHeader(columns: ColumnMeta[]): string {
  return columns.map((col) => escapeCsvField(col.name)).join(",");
}

/**
 * Format a value for use in a keyset pagination WHERE clause.
 * Numbers stay as-is; everything else is single-quoted.
 */
/**
 * Build a keyset pagination WHERE clause for MySQL row-value comparison.
 *
 * Example output for a single PK column `id`:
 *   `id` > 12345
 * Example output for composite PK (`a`, `b`):
 *   (`a`, `b`) > (1, 'hello')
 */
export function queryResultToCsv(result: QueryResult): string {
  const header = buildHeader(result.columns);
  const body = rowsToCsv(result.rows);
  return header + "\n" + body;
}

/**
 * Convert a QueryResult to a JSON string (array of objects).
 */
export function queryResultToJson(result: QueryResult): string {
  const data = result.rows.map((row) => {
    const obj: Record<string, unknown> = {};
    result.columns.forEach((col, i) => {
      obj[col.name] = i < row.length ? row[i] : null;
    });
    return obj;
  });
  return JSON.stringify(data, null, 2);
}

/**
 * Trigger a file download in the browser.
 * Works in Tauri's webview as well.
 */
export function downloadFile(content: string, filename: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

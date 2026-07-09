import type { ColumnMeta, QueryResult } from "../types";
import { executeQuery } from "../services/queryService";

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
function formatKeysetValue(val: unknown): string {
  if (val === null || val === undefined) return "NULL";
  if (typeof val === "number" || typeof val === "bigint") return String(val);
  const s = String(val).replace(/\\/g, "\\\\").replace(/'/g, "\\'");
  return `'${s}'`;
}

/**
 * Build a keyset pagination WHERE clause for MySQL row-value comparison.
 *
 * Example output for a single PK column `id`:
 *   `id` > 12345
 * Example output for composite PK (`a`, `b`):
 *   (`a`, `b`) > (1, 'hello')
 */
function buildKeysetWhere(
  pkColumns: string[],
  lastRow: unknown[],
  allColumns: ColumnMeta[],
): string {
  // Build a map from column name → index for the pk values
  const colIndex = new Map<string, number>();
  allColumns.forEach((c, i) => colIndex.set(c.name, i));

  const pkValues = pkColumns.map((col) => {
    const idx = colIndex.get(col);
    return idx !== undefined ? lastRow[idx] : null;
  });

  if (pkColumns.length === 1) {
    return `\`${pkColumns[0]}\` > ${formatKeysetValue(pkValues[0])}`;
  }

  const cols = pkColumns.map((c) => `\`${c}\``).join(", ");
  const vals = pkValues.map(formatKeysetValue).join(", ");
  return `(${cols}) > (${vals})`;
}

/**
 * Export a MySQL table to CSV using keyset pagination.
 *
 * - Orders by primary key columns (avoids OFFSET which can lock tables).
 * - Fetches in batches of `batchSize` rows.
 * - Calls `onBatch(totalRows)` after each batch for progress reporting.
 *
 * Returns the complete CSV string.
 */
export async function exportTableToCsv(
  connectionId: string,
  database: string,
  table: string,
  pkColumns: string[],
  onBatch: (totalRows: number) => void,
): Promise<string> {
  const batchSize = 5000;
  const pkOrder = pkColumns.map((c) => `\`${c}\``).join(", ");

  let allRows: unknown[][] = [];
  let columns: ColumnMeta[] | null = null;
  let done = false;
  let totalRows = 0;
  let lastRow: unknown[] | null = null;

  while (!done) {
    let sql: string;
    if (lastRow && columns) {
      const where = buildKeysetWhere(pkColumns, lastRow, columns);
      sql = `SELECT * FROM \`${database}\`.\`${table}\` WHERE ${where} ORDER BY ${pkOrder} LIMIT ${batchSize}`;
    } else {
      sql = `SELECT * FROM \`${database}\`.\`${table}\` ORDER BY ${pkOrder} LIMIT ${batchSize}`;
    }

    const result: QueryResult = await executeQuery(connectionId, sql, batchSize);

    if (!columns) {
      columns = result.columns;
    }

    if (result.rows.length === 0) {
      done = true;
      break;
    }

    allRows.push(...result.rows);
    totalRows += result.rows.length;
    onBatch(totalRows);

    if (result.rows.length < batchSize) {
      done = true;
    } else {
      lastRow = result.rows[result.rows.length - 1];
    }
  }

  if (!columns) return "";

  const header = buildHeader(columns);
  const body = rowsToCsv(allRows);
  return header + "\n" + body;
}

/**
 * Convert a QueryResult to a CSV string (single-batch, for small results).
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

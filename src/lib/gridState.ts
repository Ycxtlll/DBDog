import type { ColumnState } from "ag-grid-community";

/**
 * Per-table grid layout memory (M1 表格状态记忆): column widths, order and
 * visibility are remembered per connection+database+table in localStorage,
 * so a wide table opens the way the user left it instead of resetting
 * every time. Only browse-mode columns are persisted — custom SQL result
 * layouts are one-off and vary per query.
 *
 * Deliberately layout-only: sort and filter are NOT remembered. Sort is
 * server-side in browse mode (browse.sort owns it) and filters drive the
 * generated search SQL — restoring either from a blob would desync what
 * the header shows from what the data actually is.
 */

interface SavedColumnState {
  colId: string;
  hide?: boolean | null;
  pinned?: boolean | "left" | "right" | null;
  width?: number;
}

const gridStateKey = (connectionId: string, database: string, table: string) =>
  `dbdog.gridcols.${connectionId}.${database}.${table}`;

/** Strip everything but the layout four — sort/filter must never persist. */
const sanitize = (s: ColumnState): SavedColumnState | null =>
  s.colId == null
    ? null
    : { colId: s.colId, hide: s.hide, pinned: s.pinned ?? null, width: s.width };

export function loadGridState(
  connectionId: string,
  database: string,
  table: string,
): SavedColumnState[] | null {
  try {
    const raw = localStorage.getItem(gridStateKey(connectionId, database, table));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.length > 0
      ? (parsed as SavedColumnState[])
      : null;
  } catch {
    return null;
  }
}

export function saveGridState(
  connectionId: string,
  database: string,
  table: string,
  state: ColumnState[],
): void {
  try {
    const saved = state
      .map(sanitize)
      .filter((s): s is SavedColumnState => s !== null);
    localStorage.setItem(gridStateKey(connectionId, database, table), JSON.stringify(saved));
  } catch {
    // Storage unavailable — the layout simply is not remembered.
  }
}

export function clearGridState(connectionId: string, database: string, table: string): void {
  try {
    localStorage.removeItem(gridStateKey(connectionId, database, table));
  } catch {
    // Nothing to do.
  }
}

/**
 * Reconcile a saved column state against the columns that actually exist
 * now (schema drift: renamed/dropped/new columns). Saved entries for
 * missing columns are dropped; columns that appeared after the save are
 * appended at the end.
 */
export function reconcileGridState(
  saved: SavedColumnState[],
  existingColIds: string[],
): ColumnState[] | null {
  if (saved.length === 0 || existingColIds.length === 0) return null;
  const existing = new Set(existingColIds);
  const kept = saved.filter((s) => existing.has(s.colId));
  const known = new Set(kept.map((s) => s.colId));
  const appended = existingColIds
    .filter((id) => !known.has(id))
    .map((colId) => ({ colId }));
  if (kept.length === 0) return null;
  return [...kept, ...appended] as ColumnState[];
}

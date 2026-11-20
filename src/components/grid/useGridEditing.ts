import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import i18n from "../../lib/i18n";
import type { PendingChange, QueryResult, QueryTab, TableBrowseState } from "../../types";
import * as queryService from "../../services/queryService";
import { useQueryStore } from "../../stores/queryStore";
import { useLunaStore } from "../../stores/lunaStore";
import { useUiStore } from "../../stores/uiStore";
import { showError, showSuccess } from "../../stores/toastStore";
import { generateId } from "../../lib/utils";
import { parseTauriError } from "../../lib/error";
import { escapeMysqlIdentifier, escapeMysqlString } from "../../lib/sql";

interface UseGridEditingArgs {
  tab: QueryTab;
  browse: TableBrowseState | undefined;
  result: unknown;
  isQueryResult: boolean;
  activeConnectionId: string | null;
  /** Row the detail modal is operating on (cell edit / row delete). */
  detailRowData: Record<string, unknown> | null;
  closeDetail: () => void;
  /** Re-run the query that produced the grid (data changed server-side). */
  refreshGrid: () => Promise<void>;
}

/**
 * Grid data-editing pipeline: primary-key resolution, cell edits, row
 * deletes, placeholder INSERT rows, and the changeset (staged batch or
 * immediate apply per the "apply edits immediately" setting). Applies go
 * through the backend transaction command — either as one staged batch or
 * one statement per save.
 */
export function useGridEditing({
  tab,
  browse,
  result,
  isQueryResult,
  activeConnectionId,
  detailRowData,
  closeDetail,
  refreshGrid,
}: UseGridEditingArgs) {
  const { t } = useTranslation("query");
  const applyImmediately = useUiStore((s) => s.query.applyImmediately ?? true);

  // Rows being filled for a staged INSERT (grid editing loop).
  const [pendingNewRows, setPendingNewRows] = useState<Record<string, unknown>[]>([]);

  // ── Changeset apply state ─────────────────────────────────────────────────
  const [changesetOpen, setChangesetOpen] = useState(false);
  const [applyingChanges, setApplyingChanges] = useState(false);

  /** Append an empty placeholder row for a staged INSERT. */
  const addNewRow = useCallback(() => {
    if (!browse || !isQueryResult || !result) return;
    const qr = result as QueryResult;
    if (qr.columns.length === 0) return;
    const row: Record<string, unknown> = { __dbdogNew: true, __dbdogRowId: generateId() };
    for (const c of qr.columns) row[c.name] = null;
    setPendingNewRows((prev) => [...prev, row]);
  }, [browse, isQueryResult, result]);

  /** Record an applied change in the query history. Immediate applies do
   *  NOT accumulate rollback SQL — per-edit undo was wasted state; undo
   *  (Ctrl+Z) stays available for staged batch applies only. */
  const recordApplied = useCallback(
    (change: PendingChange) => {
      useQueryStore.getState().addHistory({ sql: change.sql, status: "success", elapsedMs: 0 });
      useLunaStore.getState().countEdits(1);
    },
    [],
  );

  /** Apply one change immediately through the transaction command. */
  const applyOne = useCallback(
    async (change: PendingChange) => {
      if (!activeConnectionId) return;
      await queryService.executeTransaction(activeConnectionId, [change.sql]);
      recordApplied(change);
    },
    [activeConnectionId, recordApplied],
  );

  /** Stage a filled placeholder row as an INSERT change (or apply it at once). */
  const stageNewRow = useCallback(
    (row: Record<string, unknown>) => {
      if (!browse || !activeConnectionId) return;
      const { database, table } = browse;
      void (async () => {
        try {
          const data: Record<string, unknown> = {};
          for (const [k, v] of Object.entries(row)) {
            if (k === "__dbdogNew" || k === "__dbdogRowId") continue;
            data[k] = v;
          }
          const { sql, rollbackSql } = await queryService.changesetPrepare({
            database,
            table,
            pkColumns: [],
            kind: "insert",
            row: data,
          });
          const change: PendingChange = {
            id: generateId(),
            kind: "insert",
            sql,
            rollbackSql,
            table,
            database,
          };
          if (applyImmediately) {
            await applyOne(change);
            setPendingNewRows((prev) => prev.filter((r) => r.__dbdogRowId !== row.__dbdogRowId));
            showSuccess(t("appliedToast"));
            await refreshGrid();
          } else {
            useQueryStore.getState().stageChange(tab.id, change);
            setPendingNewRows((prev) => prev.filter((r) => r.__dbdogRowId !== row.__dbdogRowId));
            showSuccess(t("stagedToast"));
          }
        } catch (err) {
          // Keep the placeholder row so the values can be fixed and saved again.
          showError(parseTauriError(err));
        }
      })();
    },
    [browse, activeConnectionId, tab.id, t, applyImmediately, applyOne, refreshGrid],
  );

  const discardNewRow = useCallback((row: Record<string, unknown>) => {
    setPendingNewRows((prev) => prev.filter((r) => r.__dbdogRowId !== row.__dbdogRowId));
  }, []);

  /** Drop every unfilled placeholder row (changeset discard). */
  const clearNewRows = useCallback(() => {
    setPendingNewRows([]);
  }, []);

  /** Fetch/verify the primary-key columns usable for WHERE clauses. Falls
   *  back to the first UNIQUE index when no PK exists (M3: tables without a
   *  primary key get a real edit path instead of a dead end). */
  const resolvePkColumns = useCallback(
    async (database: string, table: string, stored: string[]): Promise<string[]> => {
      let pkCols = stored;
      if (pkCols.length === 0) {
        try {
          const keysResult = await queryService.executeQuery(
            activeConnectionId!,
            `SHOW KEYS FROM ${escapeMysqlIdentifier(database)}.${escapeMysqlIdentifier(table)}`,
            undefined,
            database,
          );
          const nameIdx = keysResult.columns.findIndex((c) => c.name.toLowerCase() === "key_name");
          const colIdx = keysResult.columns.findIndex((c) => c.name.toLowerCase() === "column_name");
          const nuIdx = keysResult.columns.findIndex((c) => c.name.toLowerCase() === "non_unique");
          const seqIdx = keysResult.columns.findIndex((c) => c.name.toLowerCase() === "seq_in_index");
          if (nameIdx >= 0 && colIdx >= 0 && nuIdx >= 0 && seqIdx >= 0) {
            // Unique indexes in declaration order; columns ordered by seq.
            const groups = new Map<string, { seq: number; col: string }[]>();
            for (const row of keysResult.rows) {
              if (Number(row[nuIdx] ?? 1) !== 0) continue;
              const key = String(row[nameIdx] ?? "");
              const list = groups.get(key) ?? [];
              list.push({ seq: Number(row[seqIdx] ?? 0), col: String(row[colIdx] ?? "") });
              groups.set(key, list);
            }
            const chosen =
              groups.get("PRIMARY") ?? (groups.size > 0 ? groups.values().next().value : undefined);
            if (chosen) {
              pkCols = [...chosen].sort((a, b) => a.seq - b.seq).map((c) => c.col);
              // A nullable unique index cannot key a row safely (multiple
              // NULL rows all match `col IS NULL`) — require NOT NULL.
              if (!groups.has("PRIMARY")) {
                const nullable = await queryService.executeQuery(
                  activeConnectionId!,
                  `SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ${escapeMysqlString(database)} AND TABLE_NAME = ${escapeMysqlString(table)} AND COLUMN_NAME IN (${pkCols.map((c) => escapeMysqlString(c)).join(", ")}) AND IS_NULLABLE = 'YES'`,
                  undefined,
                  database,
                );
                if (nullable.rows.length > 0) {
                  pkCols = [];
                }
              }
            }
          }
          useQueryStore.getState().setTabTableBrowse(tab.id, { database, table, primaryKeyColumns: pkCols, pageSize: tab.tableBrowse?.pageSize ?? 50, page: tab.tableBrowse?.page ?? 1, totalRows: tab.tableBrowse?.totalRows, filterSql: tab.tableBrowse?.filterSql, sort: tab.tableBrowse?.sort, browseMode: tab.tableBrowse?.browseMode });
        } catch {
          return [];
        }
      }
      // The current result must actually contain every PK column — the user
      // may have run arbitrary SQL since the grid was produced, and matching
      // rows by columns that aren't in the result would UPDATE/DELETE wrong
      // rows (missing values degrade to `pk IS NULL`).
      if (isQueryResult && result) {
        const colNames = new Set((result as QueryResult).columns.map((c) => c.name));
        if (!pkCols.every((c) => colNames.has(c))) {
          return [];
        }
      }
      return pkCols;
    },
    [activeConnectionId, tab.id, isQueryResult, result],
  );

  const handleSave = useCallback(
    async (colName: string, newValue: string | null) => {
      if (!detailRowData || !tab.tableBrowse || !activeConnectionId || !isQueryResult || !result) return;

      const { database, table } = tab.tableBrowse;

      const pkCols = await resolvePkColumns(database, table, tab.tableBrowse.primaryKeyColumns);
      if (pkCols.length === 0) {
        showError(t("noPrimaryKey"));
        return;
      }

      // SQL generation (forward + rollback) lives in Rust — the rollback
      // statements are the changeset's safety net.
      const { sql, rollbackSql } = await queryService.changesetPrepare({
        database,
        table,
        pkColumns: pkCols,
        kind: "update",
        row: detailRowData,
        column: colName,
        newValue: newValue === null ? null : newValue,
      });

      if (applyImmediately) {
        // Write through at once; rethrow so the detail modal stays in edit
        // mode when the server rejects the change.
        await applyOne({ id: generateId(), kind: "update", sql, rollbackSql, table, database });
        showSuccess(t("appliedToast"));
        await refreshGrid();
        return;
      }

      // Stage instead of applying immediately (M4 changeset): the batch goes
      // to the server as ONE transaction from the pending-changes bar.
      useQueryStore.getState().stageChange(tab.id, {
        id: generateId(),
        kind: "update",
        sql,
        rollbackSql,
        table,
        database,
      });
      showSuccess(t("stagedToast"));
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [detailRowData, tab.tableBrowse, tab.id, activeConnectionId, isQueryResult, result, resolvePkColumns, applyImmediately, applyOne, refreshGrid, t],
  );

  // Delete a row (called from context menu or modal)
  const handleDeleteRow = useCallback(
    async (row: Record<string, unknown>) => {
      if (!tab.tableBrowse || !activeConnectionId || !isQueryResult || !result) return;

      const { database, table } = tab.tableBrowse;

      const pkCols = await resolvePkColumns(database, table, tab.tableBrowse.primaryKeyColumns);
      if (pkCols.length === 0) {
        showError(t("noPrimaryKey"));
        return;
      }

      const { sql, rollbackSql } = await queryService.changesetPrepare({
        database,
        table,
        pkColumns: pkCols,
        kind: "delete",
        row,
      });

      if (applyImmediately) {
        // Rethrow so the row modal stays open on failure (caller catches).
        await applyOne({ id: generateId(), kind: "delete", sql, rollbackSql, table, database });
        showSuccess(t("appliedToast"));
        await refreshGrid();
        return;
      }

      // Stage the delete (M4 changeset) — applied with the batch.
      useQueryStore.getState().stageChange(tab.id, {
        id: generateId(),
        kind: "delete",
        sql,
        rollbackSql,
        table,
        database,
      });
      showSuccess(t("stagedToast"));
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tab.tableBrowse, tab.id, activeConnectionId, isQueryResult, result, resolvePkColumns, refreshGrid, applyImmediately, applyOne, t],
  );

  const handleDeleteModalRow = useCallback(
    async () => {
      if (!detailRowData) return;
      await handleDeleteRow(detailRowData);
      closeDetail();
    },
    [detailRowData, handleDeleteRow, closeDetail],
  );

  const applyChanges = useCallback(async () => {
    const changes = tab.pendingChanges ?? [];
    if (!activeConnectionId || changes.length === 0 || applyingChanges) return;
    setApplyingChanges(true);
    try {
      await queryService.executeTransaction(activeConnectionId, changes.map((c) => c.sql));
      for (const c of changes) {
        useQueryStore.getState().addHistory({ sql: c.sql, status: "success", elapsedMs: 0 });
        useQueryStore.getState().addHistory({
          sql: c.rollbackSql,
          status: "success",
          kind: "rollback",
          elapsedMs: 0,
        });
      }
      showSuccess(t("changesetApplied", { count: changes.length }));
      useLunaStore.getState().countEdits(changes.length);
      useLunaStore
        .getState()
        .sayBark(
          i18n.language === "zh"
            ? "都改好了，骨头还是热的 🦴"
            : "All applied — the bone is still warm 🦴",
        );
      useQueryStore.getState().setLastAppliedRollbacks(tab.id, changes.map((c) => c.rollbackSql));
      useQueryStore.getState().clearPendingChanges(tab.id);
      setChangesetOpen(false);
      setPendingNewRows([]);
      await refreshGrid();
    } catch (err) {
      // The backend rolled the whole batch back; staged changes stay so the
      // failing statement can be removed or fixed and reapplied.
      showError(parseTauriError(err));
    } finally {
      setApplyingChanges(false);
    }
  }, [tab.pendingChanges, tab.id, activeConnectionId, applyingChanges, t, refreshGrid]);

  const undoLastApplied = useCallback(async () => {
    const rollbacks = tab.lastAppliedRollbacks ?? [];
    if (!activeConnectionId || rollbacks.length === 0 || applyingChanges) return;
    setApplyingChanges(true);
    try {
      await queryService.executeTransaction(activeConnectionId, [...rollbacks].reverse(), true);
      for (const sql of rollbacks) {
        useQueryStore.getState().addHistory({ sql, status: "success", elapsedMs: 0 });
      }
      showSuccess(t("undoDone"));
      useQueryStore.getState().setLastAppliedRollbacks(tab.id, []);
      await refreshGrid();
    } catch (err) {
      showError(parseTauriError(err));
    } finally {
      setApplyingChanges(false);
    }
  }, [tab.lastAppliedRollbacks, tab.id, activeConnectionId, applyingChanges, t, refreshGrid]);

  return {
    pendingNewRows,
    addNewRow,
    stageNewRow,
    discardNewRow,
    clearNewRows,
    resolvePkColumns,
    handleSave,
    handleDeleteRow,
    handleDeleteModalRow,
    changesetOpen,
    setChangesetOpen,
    applyingChanges,
    applyChanges,
    undoLastApplied,
  };
}

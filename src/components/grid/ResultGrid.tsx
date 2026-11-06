import { useMemo, useState, useCallback, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { AgGridReact } from "ag-grid-react";
import type { ColDef, ICellRendererParams, ITooltipParams, CellContextMenuEvent, CellKeyDownEvent, FilterChangedEvent, SortChangedEvent } from "ag-grid-community";
import { Braces, CircleDot, CircleSlash, Copy, Database, Eye, FileJson, Filter, FilterX, Rows3, Trash2 } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useUiStore } from "../../stores/uiStore";
import { useConnectionStore } from "../../stores/connectionStore";
import type { QueryResult, QueryTab, UpdateResult } from "../../types";
import { CellDetailModal } from "./CellDetailModal";
import { BrowsePagination } from "./BrowsePagination";
import * as queryService from "../../services/queryService";
import { useQueryStore } from "../../stores/queryStore";
import { showSuccess, showError } from "../../stores/toastStore";
import { parseTauriError } from "../../lib/error";
import { confirmDialog } from "../../lib/confirm";
import {
  escapeMysqlIdentifier,
  browseStateSelectSql,
  buildInsertStatements,
  buildTableSearchSql,
  buildRollbackForUpdate,
  buildRollbackForDelete,
  formatSqlValue,
} from "../../lib/sql";
import { limitGuardSql } from "../../stores/queryStore";

interface DetailCellInfo {
  columnName: string;
  value: unknown;
  rowData: Record<string, unknown>;
}

interface ContextMenuState {
  x: number;
  y: number;
  rowData: Record<string, unknown>;
  /** Column the menu was opened on (right-click target). */
  col: string;
  /** Raw value of the clicked cell (null when NULL/missing). */
  value: unknown;
}

interface ResultGridProps {
  tab: QueryTab;
}

export function ResultGrid({ tab }: ResultGridProps) {
  const { t } = useTranslation("query");
  const resolvedTheme = useUiStore((s) => s.resolvedTheme);
  const activeConnectionId = useConnectionStore((s) => s.activeId);

  const [detailCell, setDetailCell] = useState<DetailCellInfo | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const gridRef = useRef<AgGridReact>(null);

  const isQueryResult = tab.isQueryResult;
  const result = tab.result;
  const browse = tab.tableBrowse;
  // The pager only makes sense while the grid actually shows browse data —
  // hide it once the user runs their own SQL in the tab.
  const showBrowsePager = !!browse && tab.executedSql === browseStateSelectSql(browse);

  const agGridLocaleText = useMemo(
    () => ({
      pageSizeSelectorLabel: t("agPageSize"),
      ariaPageSizeSelectorLabel: t("agPageSize"),
      page: t("agPage"),
      of: t("agOf"),
      to: "-",
      firstPage: t("agFirstPage"),
      previousPage: t("agPrevPage"),
      nextPage: t("agNextPage"),
      lastPage: t("agLastPage"),
      noRowsToShow: t("agNoRows"),
      loadingOoo: t("agLoading"),
      ariaSkeletonCellLoading: t("agLoading"),
      ariaSkeletonCellLoadingFailed: t("agLoadFailed"),
    }),
    [t],
  );

  // Close context menu on any click outside
  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [contextMenu]);

  // The store drops tableBrowse.filterSql when a user-initiated run replaces
  // the filter-driven search — clear the grid's column filter too, or the
  // leftover model would keep client-side filtering the fresh result. The
  // previous value must be tracked: clearing must not fire while the filter
  // search itself is executing (filterSql was just set).
  const prevFilterSqlRef = useRef<string | undefined>(undefined);
  const filterSql = tab.tableBrowse?.filterSql;
  useEffect(() => {
    const had = prevFilterSqlRef.current;
    prevFilterSqlRef.current = filterSql;
    if (had && !filterSql) {
      gridRef.current?.api.setFilterModel(null);
    }
  }, [filterSql]);

  // All hooks must be called before any conditional returns (React Rules of Hooks)
  const columnDefs: ColDef[] = useMemo(() => {
    if (!isQueryResult || !result) return [];
    const qr = result as QueryResult;
    return qr.columns.map(
      (col): ColDef => ({
        field: col.name,
        headerName: col.name,
        headerTooltip: `${col.name} (${col.dataType})`,
        flex: 1,
        minWidth: Math.max(100, col.name.length * 9 + 24),
        wrapHeaderText: true,
        filter: getFilterType(col.dataType),
        // Apply/reset buttons: the filter only lands on Apply/Enter, so a
        // full-table search fires once per explicit apply instead of per
        // keystroke.
        filterParams: { buttons: ["apply", "reset"] },
        sortable: true,
        valueFormatter: (params) => {
          if (params.value === null || params.value === undefined) return "NULL";
          if (typeof params.value === "boolean") return params.value ? "true" : "false";
          return String(params.value);
        },
        tooltipValueGetter: (params: ITooltipParams) => {
          const formatted = formatCellValue(params.value);
          if (formatted.length <= 200) return formatted;
          return formatted.slice(0, 200) + "...";
        },
        cellRenderer: (params: ICellRendererParams) => {
          // NULL and the empty string must be distinguishable at a glance —
          // both previously rendered as blank-ish text.
          if (params.value === null || params.value === undefined) {
            return <span className="italic text-muted-foreground/80">NULL</span>;
          }
          if (params.value === "") {
            return <span className="italic text-muted-foreground/60">&apos;&apos;</span>;
          }
          const formatted = formatCellValue(params.value);
          const displayText =
            formatted.length > 50
              ? formatted.slice(0, 50) + "..."
              : formatted;
          return (
            <span className="inline-flex items-center gap-1 w-full cursor-pointer hover:underline">
              <span>{displayText}</span>
              {formatted.length > 50 && (
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="shrink-0 text-muted-foreground"
                >
                  <path d="m21 21-6-6m6 6v-4.8m0 4.8h-4.8" />
                  <path d="M3 16.2V21m0 0h4.8M3 21l6-6" />
                </svg>
              )}
            </span>
          );
        },
      }),
    );
  }, [isQueryResult, result, t]);

  const rowData = useMemo(() => {
    if (!isQueryResult || !result) return [];
    const qr = result as QueryResult;
    return qr.rows.map((row) => {
      const obj: Record<string, unknown> = {};
      qr.columns.forEach((col, i) => {
        if (i < row.length) {
          obj[col.name] = row[i];
        } else {
          obj[col.name] = null;
        }
      });
      return obj;
    });
  }, [isQueryResult, result]);

  const openRowDetail = useCallback(
    (row: Record<string, unknown>, focusColumn?: string) => {
      const firstCol = Object.keys(row)[0] ?? "";
      const col = focusColumn ?? firstCol;
      setDetailCell({
        columnName: col,
        value: row[col] ?? null,
        rowData: row,
      });
    },
    [],
  );

  const handleCellClick = useCallback(
    (event: { colDef: { field?: string; headerName?: string }; value: unknown; data: unknown }) => {
      const row = (event.data as Record<string, unknown>) ?? {};
      const col = String(event.colDef.field ?? event.colDef.headerName ?? "");
      setDetailCell({
        columnName: col,
        value: event.value,
        rowData: row,
      });
    },
    [],
  );

  const handleCellContextMenu = useCallback(
    (event: CellContextMenuEvent) => {
      const row = (event.data as Record<string, unknown>) ?? {};
      const mouseEvent = event.event as MouseEvent | null;
      if (!mouseEvent) return;
      const col = String(event.colDef.field ?? event.colDef.headerName ?? "");
      setContextMenu({
        x: mouseEvent.clientX,
        y: mouseEvent.clientY,
        rowData: row,
        col,
        value: col in row ? row[col] ?? null : null,
      });
    },
    [],
  );

  const copyText = useCallback(
    (text: string) => {
      navigator.clipboard
        .writeText(text)
        .then(() => showSuccess(t("copiedToast")))
        .catch(() => {});
    },
    [t],
  );

  /** Header-click sort: plain browse data sorts server-side (ORDER BY +
   *  re-fetch page 1); arbitrary SQL results keep their client-side page
   *  sort, so the handler no-ops there. */
  const handleSortChanged = useCallback(
    (event: SortChangedEvent) => {
      if (!activeConnectionId || !browse) return;
      const current = useQueryStore.getState().tabs.find((t) => t.id === tab.id);
      if (!current || current.isExecuting) return;
      const plainBrowse =
        current.executedSql === browseStateSelectSql(browse) ||
        (!!browse.filterSql && current.executedSql === browse.filterSql);
      if (!plainBrowse) return;
      const first = event.api.getColumnState().find((c) => c.sort);
      const next =
        first && first.sort
          ? { col: first.colId, dir: first.sort === "desc" ? ("desc" as const) : ("asc" as const) }
          : null;
      const prev = browse.sort ?? null;
      if ((prev?.col ?? null) === (next?.col ?? null) && (prev?.dir ?? null) === (next?.dir ?? null)) {
        return;
      }
      void useQueryStore
        .getState()
        .browseSort(activeConnectionId, tab.id, next?.col ?? null, next?.dir);
    },
    [activeConnectionId, tab.id, browse],
  );

  /**
   * Re-run the exact query that produced the current grid — NOT whatever the
   * user has typed into the editor since (which may be a different or
   * multi-statement script).
   */
  const refreshGrid = useCallback(async () => {
    const current = useQueryStore.getState().tabs.find((t) => t.id === tab.id);
    const sql = current?.executedSql?.trim();
    if (!activeConnectionId || !sql) return;
    try {
      // Same unbounded-SELECT guard as the normal execute path — the grid
      // refresh must not bypass it and rescan a whole table.
      const freshResult = await queryService.executeQuery(
        activeConnectionId,
        limitGuardSql(sql, current?.executedLimit),
        current?.executedLimit,
        current?.selectedDatabase,
      );
      useQueryStore.getState().setTabResult(tab.id, freshResult, true);
    } catch {
      // Grid refresh failed — the edit itself already succeeded.
    }
  }, [activeConnectionId, tab.id]);

  /**
   * Column filter applied → search the WHOLE table with generated SQL
   * (synced into the editor above) instead of only the loaded rows. Only
   * while the grid shows plain browse data of tab.tableBrowse — results of
   * arbitrary SQL can't be translated to a WHERE clause. Empty filter →
   * drop the generated search and go back to browsing.
   */
  const handleFilterChanged = useCallback(
    (event: FilterChangedEvent) => {
      if (!activeConnectionId) return;
      const current = useQueryStore.getState().tabs.find((t) => t.id === tab.id);
      const browse = current?.tableBrowse;
      if (!current || !browse || current.isExecuting) return;
      const plainBrowse =
        current.executedSql === browseStateSelectSql(browse) ||
        (!!browse.filterSql && current.executedSql === browse.filterSql);
      if (!plainBrowse) return;
      const store = useQueryStore.getState();
      const sql = buildTableSearchSql(browse.database, browse.table, event.api.getFilterModel());
      if (sql) {
        void store.searchTable(activeConnectionId, tab.id, sql);
      } else if (browse.filterSql) {
        void store.clearTableSearch(activeConnectionId, tab.id);
      }
    },
    [activeConnectionId, tab.id],
  );

  /** Fetch/verify the primary-key columns usable for WHERE clauses. */
  const resolvePkColumns = useCallback(
    async (database: string, table: string, stored: string[]): Promise<string[]> => {
      let pkCols = stored;
      if (pkCols.length === 0) {
        try {
          const keysResult = await queryService.executeQuery(
            activeConnectionId!,
            `SHOW KEYS FROM ${escapeMysqlIdentifier(database)}.${escapeMysqlIdentifier(table)} WHERE Key_name = 'PRIMARY'`,
            undefined,
            database,
          );
          const colIdx = keysResult.columns.findIndex((c) => c.name === "Column_name");
          if (colIdx >= 0) {
            pkCols = keysResult.rows.map((r) => String(r[colIdx] ?? ""));
          }
          useQueryStore.getState().setTabTableBrowse(tab.id, { database, table, primaryKeyColumns: pkCols, pageSize: tab.tableBrowse?.pageSize ?? 50, page: tab.tableBrowse?.page ?? 1, totalRows: tab.tableBrowse?.totalRows, filterSql: tab.tableBrowse?.filterSql });
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
    async (colName: string, newValue: string) => {
      if (!detailCell || !tab.tableBrowse || !activeConnectionId || !isQueryResult || !result) return;

      const { database, table } = tab.tableBrowse;

      const pkCols = await resolvePkColumns(database, table, tab.tableBrowse.primaryKeyColumns);
      if (pkCols.length === 0) {
        showError(t("noPrimaryKey"));
        return;
      }

      const wheres: string[] = [];
      for (const pkCol of pkCols) {
        const val = detailCell.rowData[pkCol];
        wheres.push(
          val === null || val === undefined
            ? `${escapeMysqlIdentifier(pkCol)} IS NULL`
            : `${escapeMysqlIdentifier(pkCol)} = ${formatSqlValue(val)}`,
        );
      }

      const setClause =
        newValue === ""
          ? `${escapeMysqlIdentifier(colName)} = NULL`
          : `${escapeMysqlIdentifier(colName)} = ${formatSqlValue(newValue)}`;

      const sql = `UPDATE ${escapeMysqlIdentifier(database)}.${escapeMysqlIdentifier(table)} SET ${setClause} WHERE ${wheres.join(" AND ")} LIMIT 1;`;

      // Reverse statement from the pre-edit row snapshot — recorded in
      // history as a rollback entry the user can load and run.
      const rollbackSql = buildRollbackForUpdate(
        database,
        table,
        pkCols,
        detailCell.rowData,
        colName,
      );

      const startTime = performance.now();
      try {
        await queryService.executeUpdate(activeConnectionId, sql, database);
        const elapsedMs = Math.round(performance.now() - startTime);
        useQueryStore.getState().addHistory({
          sql,
          status: "success",
          elapsedMs,
        });
        useQueryStore.getState().addHistory({
          sql: rollbackSql,
          status: "success",
          kind: "rollback",
          elapsedMs: 0,
        });
        showSuccess(t("cellUpdatedRollback", { table, column: colName }));

        // Refresh row data in local state
        setDetailCell((prev) => {
          if (!prev) return null;
          const updatedRow = { ...prev.rowData };
          updatedRow[colName] = newValue === "" ? null : tryParseValue(newValue);
          return { ...prev, rowData: updatedRow, value: updatedRow[prev.columnName] ?? null };
        });

        await refreshGrid();
      } catch (err) {
        const elapsedMs = Math.round(performance.now() - startTime);
        const msg = parseTauriError(err);
        useQueryStore.getState().addHistory({
          sql,
          status: "error",
          error: msg,
          elapsedMs,
        });
        showError(msg);
        throw err;
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [detailCell, tab.tableBrowse, tab.id, activeConnectionId, isQueryResult, result, resolvePkColumns, refreshGrid],
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

      const wheres: string[] = [];
      for (const pkCol of pkCols) {
        const val = row[pkCol];
        wheres.push(
          val === null || val === undefined
            ? `${escapeMysqlIdentifier(pkCol)} IS NULL`
            : `${escapeMysqlIdentifier(pkCol)} = ${formatSqlValue(val)}`,
        );
      }

      const sql = `DELETE FROM ${escapeMysqlIdentifier(database)}.${escapeMysqlIdentifier(table)} WHERE ${wheres.join(" AND ")} LIMIT 1;`;

      // Full-row INSERT that restores the deleted row (primary key included).
      const rollbackSql = buildRollbackForDelete(
        database,
        table,
        (result as QueryResult).columns.map((c) => c.name),
        row,
      );

      const startTime = performance.now();
      try {
        await queryService.executeUpdate(activeConnectionId, sql, database);
        const elapsedMs = Math.round(performance.now() - startTime);
        useQueryStore.getState().addHistory({
          sql,
          status: "success",
          elapsedMs,
        });
        useQueryStore.getState().addHistory({
          sql: rollbackSql,
          status: "success",
          kind: "rollback",
          elapsedMs: 0,
        });
        showSuccess(t("rowDeletedRollback", { table }));
      } catch (err) {
        const elapsedMs = Math.round(performance.now() - startTime);
        const msg = parseTauriError(err);
        useQueryStore.getState().addHistory({
          sql,
          status: "error",
          error: msg,
          elapsedMs,
        });
        showError(msg);
        throw err;
      }

      await refreshGrid();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tab.tableBrowse, tab.id, activeConnectionId, isQueryResult, result, resolvePkColumns, refreshGrid],
  );

  const handleDeleteModalRow = useCallback(
    async () => {
      if (!detailCell) return;
      await handleDeleteRow(detailCell.rowData);
      setDetailCell(null);
    },
    [detailCell, handleDeleteRow],
  );

  if (!result) return null;

  if (!isQueryResult) {
    const updateResult = result as UpdateResult;
    return (
      <div className="h-full flex flex-col items-center justify-center text-muted-foreground">
        <div className="text-lg font-medium">
          {updateResult.rowsAffected} {t("rowsAffected")}
        </div>
        {updateResult.lastInsertId !== undefined && (
          <div className="text-sm">
            {t("lastInsertId")}: {updateResult.lastInsertId}
          </div>
        )}
        <div className="text-xs">{updateResult.elapsedMs}ms</div>
      </div>
    );
  }

  const queryResult = result as QueryResult;

  const handleBrowsePage = useCallback(
    (page: number) => {
      if (activeConnectionId) {
        useQueryStore.getState().browsePage(activeConnectionId, tab.id, page);
      }
    },
    [activeConnectionId, tab.id],
  );

  const handleBrowsePageSize = useCallback(
    (size: number) => {
      if (activeConnectionId) {
        useQueryStore.getState().browsePage(activeConnectionId, tab.id, 1, size);
      }
    },
    [activeConnectionId, tab.id],
  );

  const handleBrowseRefresh = useCallback(() => {
    if (!activeConnectionId) return;
    const store = useQueryStore.getState();
    store.refreshBrowseCount(activeConnectionId, tab.id);
    store.browsePage(activeConnectionId, tab.id, tab.tableBrowse?.page ?? 1);
  }, [activeConnectionId, tab.id]);

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between px-3 py-1 text-xs border-b border-border bg-muted">
        <span>
          {browse
            ? browse.totalRows !== undefined
              ? `${browse.totalRows.toLocaleString()} ${t("rows")}`
              : t("totalRowsUnknown")
            : <>
                {queryResult.totalCount} {t("rows")}{" "}
                {queryResult.truncated && `(${t("truncated")})`}
              </>}
        </span>
        <span>{queryResult.elapsedMs}ms</span>
      </div>
      <div className={`flex-1 min-h-0 ${resolvedTheme === "dark" ? "ag-theme-quartz-dark" : "ag-theme-quartz"}`}>
        <AgGridReact
          ref={gridRef}
          columnDefs={columnDefs}
          rowData={rowData}
          pagination={!showBrowsePager}
          paginationPageSize={100}
          paginationPageSizeSelector={[50, 100, 200, 500]}
          localeText={agGridLocaleText}
          enableCellTextSelection
          preventDefaultOnContextMenu={true}
          onCellClicked={handleCellClick}
          onCellContextMenu={handleCellContextMenu}
          onCellKeyDown={(e) => {
            const ke = e.event as KeyboardEvent | undefined;
            if (!ke) return;
            if ((ke.ctrlKey || ke.metaKey) && !ke.shiftKey && !ke.altKey && ke.key.toLowerCase() === "c") {
              copyText(formatCellValue((e as CellKeyDownEvent).value));
              ke.preventDefault();
            }
          }}
          onFilterChanged={handleFilterChanged}
          onSortChanged={handleSortChanged}
        />
      </div>
      {showBrowsePager && browse && (
        <BrowsePagination
          page={browse.page}
          pageSize={browse.pageSize}
          totalRows={browse.totalRows}
          rowsOnPage={queryResult.rows.length}
          loading={tab.isExecuting}
          onPage={handleBrowsePage}
          onPageSize={handleBrowsePageSize}
          onRefresh={handleBrowseRefresh}
        />
      )}

      {/* Right-click context menu — copy / quick filter / row ops,
          available on any query result (row ops stay browse-only). */}
      {contextMenu && (() => {
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
        const eqNeModel = (eq: boolean): Record<string, unknown> | null => {
          if (filterKind === "number") {
            return { filterType: "number", type: eq ? "equals" : "notEqual", filter: Number(menuValue) };
          }
          if (filterKind === "date") {
            return { filterType: "date", type: eq ? "equals" : "notEqual", dateFrom: String(menuValue).slice(0, 10) };
          }
          return { filterType: "text", type: eq ? "equals" : "notEqual", filter: formatCellValue(menuValue) };
        };
        const applyQuickFilter = (model: Record<string, unknown> | null) => {
          setContextMenu(null);
          if (!model || !gridRef.current) return;
          const current = gridRef.current.api.getFilterModel();
          gridRef.current.api.setFilterModel({ ...current, [contextMenu.col]: model });
        };
        return (
          <div
            className="fixed z-[60] min-w-[200px] py-1 bg-card border border-border rounded-lg shadow-xl animate-menu-in"
            style={{
              left: Math.min(contextMenu.x, window.innerWidth - 220),
              top: Math.min(contextMenu.y, window.innerHeight - 400),
            }}
          >
            <MenuRow icon={Copy} label={t("copyValue")} onClick={() => { copyText(formatCellValue(menuValue)); setContextMenu(null); }} />
            {parsedJson !== null && (
              <MenuRow icon={Braces} label={t("copyAsJson")} onClick={() => { copyText(JSON.stringify(parsedJson, null, 2)); setContextMenu(null); }} />
            )}
            <MenuRow icon={Rows3} label={t("copyRow")} onClick={() => { copyText(cols.map((c) => `${c}: ${formatCellValue(contextMenu.rowData[c])}`).join("\n")); setContextMenu(null); }} />
            <MenuRow icon={FileJson} label={t("copyRowJson")} onClick={() => { copyText(JSON.stringify(contextMenu.rowData, null, 2)); setContextMenu(null); }} />
            {browse && (
              <MenuRow
                icon={Database}
                label={t("copyAsInsert")}
                onClick={() => { copyText(buildInsertStatements(browse.database, browse.table, cols, [contextMenu.rowData])); setContextMenu(null); }}
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
            <div className="my-1 border-t border-border" />
            <MenuRow icon={Eye} label={t("viewRowData")} onClick={() => { openRowDetail(contextMenu.rowData, contextMenu.col); setContextMenu(null); }} />
            {browse && (
              <MenuRow
                icon={Trash2}
                label={t("deleteRow")}
                destructive
                onClick={async () => {
                  setContextMenu(null);
                  const confirmed = await confirmDialog(t("confirmDeleteRow"), t("deleteRow"));
                  if (confirmed) {
                    handleDeleteRow(contextMenu.rowData).catch(() => {});
                  }
                }}
              />
            )}
          </div>
        );
      })()}

      <CellDetailModal
        open={!!detailCell}
        columnName={detailCell?.columnName}
        value={detailCell?.value}
        rowData={detailCell?.rowData}
        onSave={tab.tableBrowse ? handleSave : undefined}
        onDeleteRow={tab.tableBrowse ? handleDeleteModalRow : undefined}
        onClose={() => setDetailCell(null)}
      />
    </div>
  );
}

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

/** Parse a string as a JSON object/array for the "copy as JSON" action. */
function tryParseJson(s: string): unknown | null {
  const trimmed = s.trim();
  if (!(trimmed.startsWith("{") || trimmed.startsWith("["))) return null;
  try {
    const parsed: unknown = JSON.parse(trimmed);
    return typeof parsed === "object" && parsed !== null ? parsed : null;
  } catch {
    return null;
  }
}

function formatCellValue(value: unknown): string {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function getFilterType(dataType: string): string {
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

/** Try to parse a value back to its natural JS type for local state updates. */
function tryParseValue(s: string): unknown {
  if (s === "") return null;
  if (s === "null" || s === "NULL") return null;
  if (s === "true") return true;
  if (s === "false") return false;
  const n = Number(s);
  if (!isNaN(n) && s.trim() !== "") return n;
  return s;
}

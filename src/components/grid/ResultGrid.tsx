import { useMemo, useState, useCallback, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { AgGridReact } from "ag-grid-react";
import type { ColDef, CellContextMenuEvent, CellKeyDownEvent, FilterChangedEvent, RowClassParams, SortChangedEvent } from "ag-grid-community";
import { FilePlus2, Filter, X } from "lucide-react";
import { useUiStore } from "../../stores/uiStore";
import { useConnectionStore } from "../../stores/connectionStore";
import type { QueryResult, QueryTab, UpdateResult } from "../../types";
import { CellDetailModal } from "./CellDetailModal";
import { BrowsePagination } from "./BrowsePagination";
import { ColumnChooser } from "./ColumnChooser";
import { GridContextMenu } from "./GridContextMenu";
import { ChangesetBar } from "./ChangesetBar";
import { PinnedRowsBar } from "./PinnedRowsBar";
import { SelectionStatsBar } from "./SelectionStatsBar";
import { RelationshipModal } from "./RelationshipModal";
import { RowDiffModal } from "./RowDiffModal";
import { buildColumnDefs, buildRowData } from "./gridColumns";
import { buildNoRowsOverlay, contextMenuFromEvent, formatCellValue, type ContextMenuState, type DetailCellInfo } from "./gridHelpers";
import { useGridRelationships } from "./useGridRelationships";
import { useGridEditing } from "./useGridEditing";
import * as queryService from "../../services/queryService";
import * as relationshipService from "../../services/relationshipService";
import { useQueryStore } from "../../stores/queryStore";
import { showSuccess } from "../../stores/toastStore";
import {
  loadGridState,
  saveGridState,
  reconcileGridState,
} from "../../lib/gridState";

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
  /** Live AG Grid filter model → rendered as removable chips above the grid. */
  const [filterModel, setFilterModelState] = useState<Record<string, unknown>>({});
  /** Multi-row selection (checkbox column) for copy/stats. */
  const [selectedRows, setSelectedRows] = useState<Record<string, unknown>[]>([]);
  // ── M3 row diff: pin up to two rows, compare side by side ────────────────
  const [pinnedRows, setPinnedRows] = useState<Record<string, unknown>[]>([]);
  const [rowDiffOpen, setRowDiffOpen] = useState(false);

  const isQueryResult = tab.isQueryResult === true;
  const result = tab.result;
  const browse = tab.tableBrowse;
  // The pager only makes sense while the grid actually shows browse data —
  // hide it once the user runs their own SQL in the tab.
  const showBrowsePager = !!browse && browse.browseMode === "browse";

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
      // Re-run through the backend guard (LIMIT wrap included) — the grid
      // refresh must not bypass it and rescan a whole table.
      const script = await queryService.executeScript(
        activeConnectionId,
        sql,
        current?.executedLimit,
        current?.selectedDatabase,
        true,
      );
      // Comment-only script: nothing ran, keep the current grid untouched.
      if (script.statements.length === 0) return;
      if (script.finalIsQuery && script.finalResult) {
        useQueryStore.getState().setTabResult(tab.id, script.finalResult, true);
      } else {
        useQueryStore.getState().setTabResult(
          tab.id,
          { rowsAffected: script.finalRowsAffected, elapsedMs: script.elapsedMs } as UpdateResult,
          false,
        );
      }
      // A refreshed script rebuilds its result-set tabs too (display falls
      // back to the last set — re-running the whole script re-ordered nothing).
      if (script.queryResults.length > 1) {
        useQueryStore.getState().setTabResultSets(
          tab.id,
          script.queryResults,
          script.finalIsQuery ? script.queryResults.length - 1 : -1,
        );
      } else {
        useQueryStore.getState().setTabResultSets(tab.id, []);
      }
    } catch {
      // Grid refresh failed — the edit itself already succeeded.
    }
  }, [activeConnectionId, tab.id]);

  const openRowDetail = useCallback(
    (row: Record<string, unknown>, focusColumn?: string, tableName?: string) => {
      const firstCol = Object.keys(row)[0] ?? "";
      const col = focusColumn ?? firstCol;
      setDetailCell({
        columnName: col,
        value: row[col] ?? null,
        rowData: row,
        tableName,
      });
    },
    [],
  );

  // FK links, reverse references, relationship editor, FK jump navigation.
  const rel = useGridRelationships({
    tabId: tab.id,
    browse,
    result,
    isQueryResult,
    activeConnectionId,
    detailTableName: detailCell?.tableName,
    openRowDetail,
  });

  // Data editing: cell save / row delete / INSERT placeholders / changeset.
  const editing = useGridEditing({
    tab,
    browse,
    result,
    isQueryResult,
    activeConnectionId,
    detailRowData: detailCell?.rowData ?? null,
    closeDetail: () => setDetailCell(null),
    refreshGrid,
  });

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

  // ── Per-table column layout memory ────────────────────────────────────────
  const gridStateTimerRef = useRef<number | null>(null);

  const scheduleGridStateSave = useCallback(() => {
    if (!activeConnectionId || !browse) return;
    if (gridStateTimerRef.current !== null) window.clearTimeout(gridStateTimerRef.current);
    gridStateTimerRef.current = window.setTimeout(() => {
      gridStateTimerRef.current = null;
      const state = gridRef.current?.api?.getColumnState();
      if (state && activeConnectionId && browse) {
        saveGridState(activeConnectionId, browse.database, browse.table, state);
      }
    }, 400);
  }, [activeConnectionId, browse]);

  useEffect(
    () => () => {
      if (gridStateTimerRef.current !== null) window.clearTimeout(gridStateTimerRef.current);
    },
    [],
  );

  // Apply the remembered layout whenever the grid's columns (re)build —
  // guarded to browse mode; custom SQL layouts are one-off.
  const applySavedGridState = useCallback(() => {
    if (!activeConnectionId || !browse) return;
    const api = gridRef.current?.api;
    if (!api) return;
    const saved = loadGridState(activeConnectionId, browse.database, browse.table);
    if (!saved) return;
    const existing = api.getColumns()?.map((c) => c.getColId()) ?? [];
    const state = reconcileGridState(saved, existing);
    if (state) api.applyColumnState({ state, applyOrder: true });
  }, [activeConnectionId, browse]);

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

  const noRowsOverlay = useMemo(() => buildNoRowsOverlay(t), [t]);

  const columnDefs: ColDef[] = useMemo(() => {
    if (!isQueryResult || !result) return [];
    return buildColumnDefs(result as QueryResult, rel.fkByColumn);
  }, [isQueryResult, result, rel.fkByColumn]);

  const rowData = useMemo(() => {
    if (!isQueryResult || !result) return editing.pendingNewRows;
    return buildRowData(result as QueryResult, editing.pendingNewRows);
  }, [isQueryResult, result, editing.pendingNewRows]);

  const handleCellClick = useCallback(
    (event: {
      colDef: { field?: string; headerName?: string };
      value: unknown;
      data: unknown;
      event?: unknown;
    }) => {
      const col = String(event.colDef.field ?? event.colDef.headerName ?? "");
      // Selection-column clicks toggle checkboxes only.
      if (!event.colDef.field) return;
      // Click on the FK jump icon navigates to the parent row instead of
      // opening this row's detail.
      const mouse = event.event as MouseEvent | undefined;
      const fkEl = (mouse?.target as HTMLElement | null | undefined)?.closest?.("[data-fk-jump]");
      if (fkEl) {
        const relItem = rel.fkByColumnRef.current.get(col);
        if (relItem && event.value !== null && event.value !== undefined) {
          void rel.handleFkJump(relItem, event.value);
        }
        return;
      }
      const row = (event.data as Record<string, unknown>) ?? {};
      if (row.__dbdogNew) return; // placeholders fill by double-click only
      setDetailCell({
        columnName: col,
        value: event.value,
        rowData: row,
        tableName: browse?.table,
      });
    },
    [rel.fkByColumnRef, rel.handleFkJump, browse],
  );

  const handleCellContextMenu = useCallback((event: CellContextMenuEvent) => {
    setContextMenu(contextMenuFromEvent(event));
  }, []);

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
      const plainBrowse = browse.browseMode !== "custom";
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
   * Column filter applied → search the WHOLE table with generated SQL
   * (synced into the editor above) instead of only the loaded rows. Only
   * while the grid shows plain browse data of tab.tableBrowse — results of
   * arbitrary SQL can't be translated to a WHERE clause. Empty filter →
   * drop the generated search and go back to browsing.
   */
  const handleFilterChanged = useCallback(
    async (event: FilterChangedEvent) => {
      if (!activeConnectionId) return;
      const current = useQueryStore.getState().tabs.find((t) => t.id === tab.id);
      const browseInfo = current?.tableBrowse;
      if (!current || !browseInfo || current.isExecuting) return;
      const plainBrowse = browseInfo.browseMode !== "custom";
      if (!plainBrowse) return;
      const model = event.api.getFilterModel() as Record<string, unknown>;
      setFilterModelState(model);
      const store = useQueryStore.getState();
      const sql = await queryService.filterSearchSql(
        browseInfo.database,
        browseInfo.table,
        model,
      );
      if (sql) {
        void store.searchTable(activeConnectionId, tab.id, sql);
      } else if (browseInfo.filterSql) {
        void store.clearTableSearch(activeConnectionId, tab.id);
      }
    },
    [activeConnectionId, tab.id],
  );

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

  const pinRow = useCallback((row: Record<string, unknown>) => {
    setPinnedRows((prev) => (prev.length >= 2 ? [prev[0], row] : [...prev, row]));
  }, []);
  const rowLabel = useCallback(
    (row: Record<string, unknown>) => {
      const pkCol = browse?.primaryKeyColumns[0];
      const label = (pkCol && row[pkCol] !== null && row[pkCol] !== undefined ? row[pkCol] : Object.values(row)[0]);
      return `${pkCol ?? ""}${pkCol ? "=" : ""}${String(label).slice(0, 20)}`;
    },
    [browse],
  );

  /** Set one column's quick-filter, merged over the live filter model. */
  const applyColumnQuickFilter = useCallback(
    (col: string, model: Record<string, unknown> | null) => {
      const api = gridRef.current?.api;
      if (!api) return;
      if (model === null) {
        api.setFilterModel(null);
        return;
      }
      api.setFilterModel({ ...api.getFilterModel(), [col]: model });
    },
    [],
  );

  if (!result) return null;

  if (!isQueryResult) {
    const updateResult = result as UpdateResult;
    const sets = tab.resultSets;
    return (
      <div className="h-full flex flex-col">
        {/* A script like `SELECT …; UPDATE …` still has its SELECT result
            sets reachable — the affected-rows panel is not a dead end. */}
        {sets && sets.length > 0 && (
          <div className="flex items-center gap-1 px-2 py-1 text-xs border-b border-border bg-muted overflow-x-auto">
            {sets.map((rs, i) => (
              <button
                key={i}
                onClick={() => useQueryStore.getState().setActiveResultSet(tab.id, i)}
                className="px-2 py-0.5 rounded-md whitespace-nowrap text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
              >
                {t("resultSet", { n: i + 1 })} · {rs.rows.length}
              </button>
            ))}
          </div>
        )}
        <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground">
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
      </div>
    );
  }

  const queryResult = result as QueryResult;

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
        <div className="flex items-center gap-2">
          <span>{queryResult.elapsedMs}ms</span>
          <ColumnChooser gridRef={gridRef} activeConnectionId={activeConnectionId} browse={browse} />
        </div>
      </div>
      {/* Multi-SELECT scripts: switchable result-set tabs (custom SQL only) */}
      {!browse && tab.resultSets && tab.resultSets.length > 1 && (
        <div className="flex items-center gap-1 px-2 py-1 text-xs border-b border-border bg-muted overflow-x-auto">
          {tab.resultSets.map((rs, i) => (
            <button
              key={i}
              onClick={() => useQueryStore.getState().setActiveResultSet(tab.id, i)}
              className={`px-2 py-0.5 rounded-md whitespace-nowrap transition-colors ${
                (tab.activeResultSet ?? -1) === i
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground"
              }`}
            >
              {t("resultSet", { n: i + 1 })} · {rs.rows.length}
            </button>
          ))}
        </div>
      )}
      {/* Active filter chips — every condition visible, one click to drop */}
      {Object.keys(filterModel).length > 0 && (
        <div className="flex items-center gap-1.5 flex-wrap px-3 py-1 text-xs border-b border-border bg-muted overflow-x-auto">
          <span className="text-muted-foreground shrink-0 flex items-center gap-1">
            <Filter size={11} />
            {t("activeFilters")}
          </span>
          {Object.entries(filterModel).map(([col, entry]) => {
            const o = (entry ?? {}) as Record<string, unknown>;
            const type = o.type as string | undefined;
            const v = o.filter ?? o.dateFrom ?? "";
            const short =
              type === "blank" ? "空值"
                : type === "notBlank" ? "非空"
                : type === "contains" ? `∋ ${v}`
                : type === "notContains" ? `∌ ${v}`
                : type === "startsWith" ? `${v}…`
                : type === "endsWith" ? `…${v}`
                : type === "equals" ? `= ${v}`
                : type === "notEqual" ? `≠ ${v}`
                : type === "lessThan" ? `< ${v}`
                : type === "lessThanOrEqual" ? `≤ ${v}`
                : type === "greaterThan" ? `> ${v}`
                : type === "greaterThanOrEqual" ? `≥ ${v}`
                : type === "inRange" ? `${v}~${o.filterTo ?? o.dateTo ?? ""}`
                : String(type ?? "?");
            return (
              <span
                key={col}
                className="inline-flex items-center gap-1 rounded-md border border-border bg-background pl-2 pr-1 py-0.5 shrink-0"
              >
                <span className="font-mono text-foreground">{col}</span>
                <span className="text-muted-foreground">{short}</span>
                <button
                  onClick={() => {
                    const next = { ...filterModel };
                    delete next[col];
                    gridRef.current?.api.setFilterModel(next);
                  }}
                  className="rounded-sm p-0.5 text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                  aria-label={`${col} ${t("removeFilter")}`}
                >
                  <X size={11} />
                </button>
              </span>
            );
          })}
          <button
            onClick={() => gridRef.current?.api.setFilterModel(null)}
            className="shrink-0 text-muted-foreground hover:text-foreground underline-offset-2 hover:underline"
          >
            {t("clearFilters")}
          </button>
        </div>
      )}
      <div className={`relative flex-1 min-h-0 ${resolvedTheme === "dark" ? "ag-theme-quartz-dark" : "ag-theme-quartz"}`}>
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
          // Column layout memory: apply the remembered layout whenever the
          // column set rebuilds; persist user-driven changes (debounced).
          onColumnEverythingChanged={applySavedGridState}
          onColumnMoved={scheduleGridStateSave}
          onColumnResized={scheduleGridStateSave}
          onColumnVisible={scheduleGridStateSave}
          onColumnPinned={scheduleGridStateSave}
          onCellKeyDown={(e) => {
            const ke = e.event as KeyboardEvent | undefined;
            if (!ke) return;
            if ((ke.ctrlKey || ke.metaKey) && !ke.shiftKey && !ke.altKey && ke.key.toLowerCase() === "c") {
              copyText(formatCellValue((e as CellKeyDownEvent).value));
              ke.preventDefault();
            }
            // Ctrl+Z reverts the last applied changeset via its rollback SQL.
            if ((ke.ctrlKey || ke.metaKey) && !ke.shiftKey && !ke.altKey && ke.key.toLowerCase() === "z") {
              if (tab.lastAppliedRollbacks?.length) {
                ke.preventDefault();
                void editing.undoLastApplied();
              }
            }
          }}
          overlayNoRowsTemplate={noRowsOverlay}
          overlayLoadingTemplate=" "
          onFilterChanged={handleFilterChanged}
          onSortChanged={handleSortChanged}
          rowSelection="multiple"
          suppressRowClickSelection={true}
          onSelectionChanged={(e: { api: { getSelectedRows: () => Record<string, unknown>[] } }) =>
            setSelectedRows(e.api.getSelectedRows())
          }
          rowClassRules={{
            "dbdog-new-row": (params: RowClassParams) => !!params.data?.__dbdogNew,
          }}
        />
      </div>
      <SelectionStatsBar selectedRows={selectedRows} queryResult={queryResult} />
      <PinnedRowsBar
        pinnedRows={pinnedRows}
        rowLabel={rowLabel}
        onOpenDiff={() => setRowDiffOpen(true)}
        onClear={() => setPinnedRows([])}
      />
      <ChangesetBar
        tab={tab}
        applyingChanges={editing.applyingChanges}
        changesetOpen={editing.changesetOpen}
        onApply={() => void editing.applyChanges()}
        onDiscard={() => {
          useQueryStore.getState().clearPendingChanges(tab.id);
          editing.clearNewRows();
          // Inline edits live in the grid display only — refresh so the
          // view matches the database again.
          void refreshGrid();
        }}
        onUndo={() => void editing.undoLastApplied()}
        setChangesetOpen={editing.setChangesetOpen}
      />
      {showBrowsePager && browse && (
        <div className="flex w-full items-center justify-between gap-3">
          <button
            onClick={editing.addNewRow}
            disabled={tab.isExecuting}
            className="flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-md border border-border bg-secondary text-secondary-foreground hover:bg-secondary/80 transition-colors disabled:opacity-50 shrink-0"
          >
            <FilePlus2 size={12} className="text-muted-foreground" />
            {t("newRow")}
          </button>
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
        </div>
      )}

      {contextMenu && (
        <GridContextMenu
          contextMenu={contextMenu}
          onClose={() => setContextMenu(null)}
          queryResult={queryResult}
          browse={browse}
          selectedRows={selectedRows}
          fkByColumn={rel.fkByColumn}
          referencedBy={rel.referencedBy}
          setRelModalCol={rel.setRelModalCol}
          adjudicateRel={rel.adjudicateRel}
          viewReferencingRows={rel.viewReferencingRows}
          onQuickFilter={applyColumnQuickFilter}
          copyText={copyText}
          stageNewRow={editing.stageNewRow}
          discardNewRow={editing.discardNewRow}
          pinRow={pinRow}
          openRowDetail={openRowDetail}
          handleDeleteRow={(row) => {
            editing.handleDeleteRow(row).catch(() => {});
          }}
        />
      )}

      <CellDetailModal
        open={!!detailCell}
        title={detailCell?.tableName}
        relationships={detailCell?.tableName === browse?.table ? rel.relationships : rel.modalRels}
        onFkJump={(relItem, value) => void rel.handleFkJump(relItem, value)}
        columnName={detailCell?.columnName}
        value={detailCell?.value}
        rowData={detailCell?.rowData}
        onSave={tab.tableBrowse ? editing.handleSave : undefined}
        onDeleteRow={tab.tableBrowse ? editing.handleDeleteModalRow : undefined}
        onClose={() => setDetailCell(null)}
      />

      <RelationshipModal
        open={!!rel.relModalCol}
        connectionId={activeConnectionId}
        database={browse?.database}
        childTable={browse?.table}
        childColumn={rel.relModalCol ?? undefined}
        existing={rel.relModalCol ? rel.fkByColumn.get(rel.relModalCol) ?? null : null}
        samples={rel.relModalSamples}
        onChanged={() => {
          // Reload persisted links, keeping inferred ones that were neither
          // confirmed nor vetoed (they are not part of the stored overview).
          if (!browse || !activeConnectionId) return;
          relationshipService
            .getRelationships(activeConnectionId, browse.database, browse.table)
            .then((overview) => {
              rel.setRelationships((prev) => {
                const keptInferred = prev.filter(
                  (r) =>
                    r.source === "inferred" &&
                    !overview.relationships.some(
                      (x) =>
                        x.childColumn === r.childColumn &&
                        x.parentTable === r.parentTable &&
                        x.parentColumn === r.parentColumn,
                    ),
                );
                return [...overview.relationships, ...keptInferred];
              });
              rel.setReferencedBy(overview.referencedBy);
            })
            .catch(() => {});
        }}
        onClose={() => rel.setRelModalCol(null)}
      />

      <RowDiffModal
        open={rowDiffOpen}
        left={pinnedRows[0]}
        right={pinnedRows[1]}
        tableName={browse?.table}
        onClose={() => setRowDiffOpen(false)}
      />
    </div>
  );
}

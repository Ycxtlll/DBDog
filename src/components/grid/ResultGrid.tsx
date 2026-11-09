import { useMemo, useState, useCallback, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { AgGridReact } from "ag-grid-react";
import type { ColDef, ICellRendererParams, ITooltipParams, CellContextMenuEvent, CellKeyDownEvent, FilterChangedEvent, RowClassParams, SortChangedEvent } from "ag-grid-community";
import { Braces, Check, Ban, CircleDot, CircleSlash, CornerDownRight, Copy, Database, Eye, FileJson, Filter, FilterX, FilePlus2, GitFork, Loader2, Pin, Rows3, Trash2, X } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useUiStore } from "../../stores/uiStore";
import { useConnectionStore } from "../../stores/connectionStore";
import type { QueryResult, QueryTab, ReverseReference, TableRelationship, UpdateResult } from "../../types";
import { CellDetailModal } from "./CellDetailModal";
import { FkJumpButton } from "./FkJumpButton";
import { RelationshipModal } from "./RelationshipModal";
import { RowDiffModal } from "./RowDiffModal";
import { BrowsePagination } from "./BrowsePagination";
import * as queryService from "../../services/queryService";
import * as relationshipService from "../../services/relationshipService";
import { useQueryStore } from "../../stores/queryStore";
import { showSuccess, showError } from "../../stores/toastStore";
import { parseTauriError } from "../../lib/error";
import { confirmDialog } from "../../lib/confirm";
import { generateId } from "../../lib/utils";
import {
  escapeMysqlIdentifier,
  escapeMysqlString,
  buildInsertStatements,
  formatSqlValue,
} from "../../lib/sql";

interface DetailCellInfo {
  columnName: string;
  value: unknown;
  rowData: Record<string, unknown>;
  /** Table the row belongs to — parent table on FK jumps. */
  tableName?: string;
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
  // Logical foreign keys for the browsed table (M2 关系分析器).
  const [relationships, setRelationships] = useState<TableRelationship[]>([]);
  const [referencedBy, setReferencedBy] = useState<ReverseReference[]>([]);
  // Cache per table so the row modal can show jump buttons for parent rows
  // too (the modal's displayed table changes with each FK jump).
  const tableRelsRef = useRef<Map<string, TableRelationship[]>>(new Map());
  const [modalRels, setModalRels] = useState<TableRelationship[]>([]);
  /** Column whose relationship editor is open (manual link management). */
  const [relModalCol, setRelModalCol] = useState<string | null>(null);
  // Rows being filled for a staged INSERT (grid editing loop).
  const [pendingNewRows, setPendingNewRows] = useState<Record<string, unknown>[]>([]);
  /** Live AG Grid filter model → rendered as removable chips above the grid. */
  const [filterModel, setFilterModelState] = useState<Record<string, unknown>>({});
  /** Multi-row selection (checkbox column) for copy/stats. */
  const [selectedRows, setSelectedRows] = useState<Record<string, unknown>[]>([]);

  const isQueryResult = tab.isQueryResult;
  const result = tab.result;
  const browse = tab.tableBrowse;
  // The pager only makes sense while the grid actually shows browse data —
  // hide it once the user runs their own SQL in the tab.
  const showBrowsePager = !!browse && browse.browseMode === "browse";

  // Sample values of the relationship-editor column from the loaded page —
  // live probe fuel for the manual link editor.
  const relModalSamples = useMemo(() => {
    if (!relModalCol || !result || !isQueryResult) return [];
    const qr = result as QueryResult;
    const idx = qr.columns.findIndex((c) => c.name === relModalCol);
    if (idx < 0) return [];
    const vals: unknown[] = [];
    const seen = new Set<string>();
    for (const row of qr.rows) {
      const v = row[idx];
      if (v === null || v === undefined || v === "") continue;
      const key = String(v);
      if (seen.has(key)) continue;
      seen.add(key);
      vals.push(v);
      if (vals.length >= 50) break;
    }
    return vals;
  }, [relModalCol, result, isQueryResult]);

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

  // child column → relationship, for cell rendering and click routing.
  useEffect(() => {
    if (!browse) return;
    tableRelsRef.current.set(`${browse.database}|${browse.table}`, relationships);
  }, [relationships, browse]);

  const fkByColumn = useMemo(() => {
    const map = new Map<string, TableRelationship>();
    for (const rel of relationships) map.set(rel.childColumn, rel);
    return map;
  }, [relationships]);
  const fkByColumnRef = useRef(fkByColumn);
  fkByColumnRef.current = fkByColumn;
  // Forward negative cache (tableKey → probed-without-hit column names) and
  // the once-per-table reverse scan guard. Column-keyed, NOT value-keyed:
  // the candidate set comes from the schema, so a column that missed on one
  // page misses on every page — per-fingerprint caching would re-probe on
  // each flip. DDL events clear both (a column may become a real FK).
  const fwdNegativeRef = useRef<Map<string, Set<string>>>(new Map());
  const revRanRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const reset = () => {
      fwdNegativeRef.current.clear();
      revRanRef.current.clear();
    };
    window.addEventListener("dbdog-schema-changed", reset);
    return () => window.removeEventListener("dbdog-schema-changed", reset);
  }, []);

  // Declared/adjudicated links load once per browsed table (cheap — no
  // probing); re-browsing the same table keeps what inference has merged.
  const relTableKeyRef = useRef("");
  const relFetchIdRef = useRef(0);
  useEffect(() => {
    const key = browse ? `${browse.database}|${browse.table}` : "";
    if (key === relTableKeyRef.current) return;
    relTableKeyRef.current = key;
    setRelationships([]);
    setReferencedBy([]);
    revRanRef.current.delete(key); // re-opening a table rescans reverse refs
    if (!browse || !activeConnectionId) return;
    const fetchId = ++relFetchIdRef.current;
    relationshipService
      .getRelationships(activeConnectionId, browse.database, browse.table)
      .then((overview) => {
        if (fetchId === relFetchIdRef.current) {
          setRelationships(overview.relationships);
          setReferencedBy(overview.referencedBy);
        }
      })
      .catch(() => {
        /* analyzer unavailable or non-MySQL — grid renders without links */
      });
  }, [browse, activeConnectionId]);

  // Inference pass: sample distinct values from the loaded page (zero extra
  // child-side queries) and let the backend probe parent primary keys.
  // Runs per new result while the grid shows this table's browse data.
  // Negative cache: a (column, samples) combo that produced no link is never
  // re-probed — page flips must not hammer the production DB with probes.
  useEffect(() => {
    if (!browse || !activeConnectionId || !result || !isQueryResult) return;
    const current = useQueryStore.getState().tabs.find((tt) => tt.id === tab.id);
    if (!current) return;
    const plainBrowse = browse.browseMode !== "custom";
    if (!plainBrowse) return;
    const qr = result as QueryResult;
    const tableKey = `${browse.database}|${browse.table}`;
    const negative = fwdNegativeRef.current.get(tableKey) ?? new Set<string>();
    const samples: Record<string, unknown[]> = {};
    const sampledColumns: string[] = [];
    qr.columns.forEach((col, colIdx) => {
      if (fkByColumnRef.current.has(col.name)) return;
      if (negative.has(col.name)) return;
      const vals: unknown[] = [];
      const seen = new Set<string>();
      for (const row of qr.rows) {
        const v = row[colIdx];
        if (v === null || v === undefined || v === "") continue;
        const key = String(v);
        if (seen.has(key)) continue;
        seen.add(key);
        vals.push(v);
        if (vals.length >= 50) break;
      }
      if (vals.length === 0) return;
      sampledColumns.push(col.name);
      samples[col.name] = vals;
    });
    if (Object.keys(samples).length === 0) return;
    let stale = false;
    relationshipService
      .inferRelationships(activeConnectionId, browse.database, browse.table, samples)
      .then((inferred) => {
        if (stale) return;
        const linked = new Set(inferred.map((r) => r.childColumn));
        for (const colName of sampledColumns) {
          if (!linked.has(colName)) negative.add(colName);
        }
        fwdNegativeRef.current.set(tableKey, negative);
        if (inferred.length === 0) return;
        setRelationships((prev) => {
          const merged = [...prev];
          for (const rel of inferred) {
            const dup = merged.some(
              (r) =>
                r.childColumn === rel.childColumn &&
                r.parentTable === rel.parentTable &&
                r.parentColumn === rel.parentColumn,
            );
            if (!dup) merged.push(rel);
          }
          return merged;
        });
      })
      .catch(() => {
        /* probing failed (permissions, timeout) — links just stay absent */
      });
    return () => {
      stale = true;
    };
  }, [result, browse, activeConnectionId, isQueryResult, tab.id]);

  // Reverse inference (the safety net): which indexed child columns reference
  // this table's primary key. Declared-only lists stay empty on schemas
  // without physical FKs (bitanswer) — this lights the menu up there.
  // Samples are the page's PK values; runs once per browsed table.
  useEffect(() => {
    if (!browse || !activeConnectionId || !result || !isQueryResult) return;
    const current = useQueryStore.getState().tabs.find((tt) => tt.id === tab.id);
    if (!current) return;
    const plainBrowse = browse.browseMode !== "custom";
    if (!plainBrowse) return;
    const pkCol = browse.primaryKeyColumns[0];
    if (!pkCol) return;
    const tableKey = `${browse.database}|${browse.table}`;
    if (revRanRef.current.has(tableKey)) return;
    const qr = result as QueryResult;
    const idx = qr.columns.findIndex((c) => c.name === pkCol);
    if (idx < 0) return;
    const vals: unknown[] = [];
    const seen = new Set<string>();
    for (const row of qr.rows) {
      const v = row[idx];
      if (v === null || v === undefined || v === "") continue;
      const key = String(v);
      if (seen.has(key)) continue;
      seen.add(key);
      vals.push(v);
      if (vals.length >= 50) break;
    }
    if (vals.length < 3) return;
    revRanRef.current.add(tableKey);
    let stale = false;
    relationshipService
      .inferReverseReferences(activeConnectionId, browse.database, browse.table, pkCol, vals)
      .then((refs) => {
        if (stale || refs.length === 0) return;
        setReferencedBy((prev) => {
          const merged = [...prev];
          for (const ref of refs) {
            const dup = prev.some(
              (x) =>
                x.childTable === ref.childTable &&
                x.childColumn === ref.childColumn &&
                x.parentColumn === ref.parentColumn,
            );
            if (!dup) merged.push(ref);
          }
          return merged;
        });
      })
      .catch(() => {
        /* reverse probing failed — menu just stays declared-only */
      });
    return () => {
      stale = true;
    };
  }, [result, browse, activeConnectionId, isQueryResult, tab.id]);

  // All hooks must be called before any conditional returns (React Rules of Hooks)
  // Single empty-state: AG Grid's own overlay carries the paw + woof text
  // (the previous custom absolute layer stacked with this one).
  const noRowsOverlay = useMemo(() => {
    const paw =
      '<svg xmlns="http://www.w3.org/2000/svg" width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' +
      '<circle cx="11" cy="4" r="2"/>' +
      '<circle cx="18" cy="8" r="2"/>' +
      '<circle cx="20" cy="16" r="2"/>' +
      '<path d="M9 10a5 5 0 0 1 5 5v3.5a3.5 3.5 0 0 1-6.84 1.045Q6.52 17.48 4.46 16.84A3.5 3.5 0 0 1 5.5 10Z"/>' +
      '</svg>';
    return (
      '<div style="display:flex;flex-direction:column;align-items:center;gap:8px;color:var(--ag-header-icon-color, var(--muted-foreground));opacity:.65">' +
      paw +
      '<div style="font-size:12px">' +
      t("gridEmptyWoof") +
      "</div></div>"
    );
  }, [t]);

  const columnDefs: ColDef[] = useMemo(() => {
    if (!isQueryResult || !result) return [];
    const qr = result as QueryResult;
    return [
      {
        colId: "__select",
        headerName: "",
        checkboxSelection: true,
        headerCheckboxSelection: true,
        width: 44,
        minWidth: 44,
        maxWidth: 44,
        sortable: false,
        filter: false,
        resizable: false,
        pinned: "left" as const,
      },
      ...qr.columns.map(
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
        // Only new-row placeholders are editable (double-click fills them);
        // real rows edit via the row modal — single click opens instantly.
        editable: (params: { data?: Record<string, unknown> }) =>
          !!params.data?.__dbdogNew,
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
              {(() => {
                // 0 / empty string are the schema convention for "no
                // reference" — no link icon, so no dead-end jumps.
                const v = params.value;
                if (v === 0 || v === "0" || v === "" || v === null || v === undefined) return null;
                const rel = fkByColumn.get(col.name);
                if (!rel) return null;
                return <FkJumpButton rel={rel} />;
              })()}
            </span>
          );
        },
      }),
      ),
    ];
  }, [isQueryResult, result, t, fkByColumn, tab.tableBrowse]);

  const rowData = useMemo(() => {
    if (!isQueryResult || !result) return pendingNewRows;
    const qr = result as QueryResult;
    const rows = qr.rows.map((row) => {
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
    return [...rows, ...pendingNewRows];
  }, [isQueryResult, result, pendingNewRows]);

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

  // Relationships for the table the row modal is currently showing — the
  // browsed table comes from cache, others (jump targets) fetch on demand.
  useEffect(() => {
    const tableName = detailCell?.tableName;
    if (!tableName || !activeConnectionId || !browse) return;
    const key = `${browse.database}|${tableName}`;
    const cached = tableRelsRef.current.get(key);
    if (cached) {
      setModalRels(cached);
      return;
    }
    let stale = false;
    relationshipService
      .getRelationships(activeConnectionId, browse.database, tableName)
      .then((overview) => {
        if (stale) return;
        tableRelsRef.current.set(key, overview.relationships);
        setModalRels(overview.relationships);
      })
      .catch(() => {
        if (!stale) setModalRels([]);
      });
    return () => {
      stale = true;
    };
  }, [detailCell?.tableName, activeConnectionId, browse]);

  /** FK link click → fetch the parent row and show it in the row modal. */
  const handleFkJump = useCallback(
    async (rel: TableRelationship, value: unknown) => {
      if (!activeConnectionId || !browse) return;
      try {
        const res = await queryService.executeQuery(
          activeConnectionId,
          `SELECT * FROM ${escapeMysqlIdentifier(browse.database)}.${escapeMysqlIdentifier(rel.parentTable)} WHERE ${escapeMysqlIdentifier(rel.parentColumn)} = ${formatSqlValue(value)} LIMIT 1;`,
          undefined,
          browse.database,
        );
        if (res.rows.length === 0) {
          showError(t("fkParentNotFound"));
          return;
        }
        const row: Record<string, unknown> = {};
        res.columns.forEach((c, i) => {
          row[c.name] = res.rows[0][i] ?? null;
        });
        openRowDetail(row, rel.parentColumn, rel.parentTable);
      } catch (err) {
        showError(parseTauriError(err));
      }
    },
    [activeConnectionId, browse, t, openRowDetail],
  );

  /** Reverse reference: run the child-side query in this tab. */
  const viewReferencingRows = useCallback(
    (ref: ReverseReference, value: unknown) => {
      setContextMenu(null);
      if (!browse || !activeConnectionId) return;
      const sql = `SELECT * FROM ${escapeMysqlIdentifier(browse.database)}.${escapeMysqlIdentifier(ref.childTable)} WHERE ${escapeMysqlIdentifier(ref.childColumn)} = ${formatSqlValue(value)} LIMIT 200;`;
      void useQueryStore.getState().execute(activeConnectionId, tab.id, undefined, sql);
    },
    [browse, activeConnectionId, tab.id],
  );

  /** Persist a verdict on an inferred link and update the local view. */
  const adjudicateRel = useCallback(
    (rel: TableRelationship, confirm: boolean) => {
      setContextMenu(null);
      if (!activeConnectionId) return;
      relationshipService
        .adjudicateRelationship(
          activeConnectionId,
          {
            childTable: rel.childTable,
            childColumn: rel.childColumn,
            parentTable: rel.parentTable,
            parentColumn: rel.parentColumn,
          },
          confirm,
        )
        .then(() => {
          showSuccess(t("fkAdjudicated"));
          setRelationships((prev) =>
            confirm
              ? prev.map((r) =>
                  r === rel ? { ...r, source: "adjudicated" as const, confidence: 1 } : r,
                )
              : prev.filter((r) => r !== rel),
          );
        })
        .catch((err) => showError(parseTauriError(err)));
    },
    [activeConnectionId, t],
  );

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
        const rel = fkByColumnRef.current.get(col);
        if (rel && event.value !== null && event.value !== undefined) {
          void handleFkJump(rel, event.value);
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
    [handleFkJump, browse],
  );

  /** Append an empty placeholder row for a staged INSERT. */
  const addNewRow = useCallback(() => {
    if (!browse || !isQueryResult || !result) return;
    const qr = result as QueryResult;
    if (qr.columns.length === 0) return;
    const row: Record<string, unknown> = { __dbdogNew: true, __dbdogRowId: generateId() };
    for (const c of qr.columns) row[c.name] = null;
    setPendingNewRows((prev) => [...prev, row]);
  }, [browse, isQueryResult, result]);

  /** Stage a filled placeholder row as an INSERT change. */
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
          useQueryStore.getState().stageChange(tab.id, {
            id: generateId(),
            kind: "insert",
            sql,
            rollbackSql,
            table,
            database,
          });
          setPendingNewRows((prev) => prev.filter((r) => r.__dbdogRowId !== row.__dbdogRowId));
          showSuccess(t("stagedToast"));
        } catch (err) {
          showError(parseTauriError(err));
        }
      })();
    },
    [browse, activeConnectionId, tab.id, t],
  );

  const discardNewRow = useCallback((row: Record<string, unknown>) => {
    setPendingNewRows((prev) => prev.filter((r) => r.__dbdogRowId !== row.__dbdogRowId));
  }, []);

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
  /** Multi-row copy: TSV (Excel-ready), JSON array, or INSERT statements. */
  const copySelectedRows = useCallback(
    (kind: "tsv" | "json" | "insert") => {
      if (selectedRows.length === 0) return;
      const qr = tab.isQueryResult ? (tab.result as QueryResult | undefined) : undefined;
      if (!qr) return;
      const cols = qr.columns.map((c) => c.name);
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
    },
    [selectedRows, browse, copyText],
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
    async (event: FilterChangedEvent) => {
      if (!activeConnectionId) return;
      const current = useQueryStore.getState().tabs.find((t) => t.id === tab.id);
      const browse = current?.tableBrowse;
      if (!current || !browse || current.isExecuting) return;
      const plainBrowse = browse.browseMode !== "custom";
      if (!plainBrowse) return;
      const model = event.api.getFilterModel() as Record<string, unknown>;
      setFilterModelState(model);
      const store = useQueryStore.getState();
      const sql = await queryService.filterSearchSql(
        browse.database,
        browse.table,
        model,
      );
      if (sql) {
        void store.searchTable(activeConnectionId, tab.id, sql);
      } else if (browse.filterSql) {
        void store.clearTableSearch(activeConnectionId, tab.id);
      }
    },
    [activeConnectionId, tab.id],
  );

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

      // SQL generation (forward + rollback) lives in Rust — the rollback
      // statements are the changeset's safety net.
      const { sql, rollbackSql } = await queryService.changesetPrepare({
        database,
        table,
        pkColumns: pkCols,
        kind: "update",
        row: detailCell.rowData,
        column: colName,
        newValue: newValue === null ? null : newValue,
      });

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
    [detailCell, tab.tableBrowse, tab.id, activeConnectionId, isQueryResult, result, resolvePkColumns],
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

      const { sql, rollbackSql } = await queryService.changesetPrepare({
        database,
        table,
        pkColumns: pkCols,
        kind: "delete",
        row,
      });

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

  // ── M4 changeset: apply / discard / undo ─────────────────────────────────
  const [changesetOpen, setChangesetOpen] = useState(false);
  const [applyingChanges, setApplyingChanges] = useState(false);

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

  // ── M3 row diff: pin up to two rows, compare side by side ────────────────
  const [pinnedRows, setPinnedRows] = useState<Record<string, unknown>[]>([]);
  const [rowDiffOpen, setRowDiffOpen] = useState(false);
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
                void undoLastApplied();
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
      {/* Selection stats — instant aggregates over the checked rows */}
      {selectedRows.length > 0 && (() => {
        const numeric: { col: string; sum: number; avg: number }[] = [];
        for (const col of queryResult.columns) {
          let sum = 0;
          let n = 0;
          let ok = true;
          for (const r of selectedRows) {
            const raw = r[col.name];
            const v =
              typeof raw === "number"
                ? raw
                : typeof raw === "string" && raw !== "" && Number.isFinite(Number(raw))
                  ? Number(raw)
                  : NaN;
            if (Number.isFinite(v)) {
              sum += v;
              n++;
            } else {
              ok = false;
              break;
            }
          }
          if (ok && n > 0) numeric.push({ col: col.name, sum, avg: sum / n });
        }
        const fmt = (x: number) => (Number.isInteger(x) ? x.toLocaleString() : x.toFixed(2));
        return (
          <div className="flex items-center gap-1.5 px-3 py-1 text-xs border-t border-border bg-muted overflow-x-auto">
            <span className="text-muted-foreground shrink-0">
              {t("selectedRowsCount", { n: selectedRows.length })}
            </span>
            {numeric.slice(0, 6).map((st) => (
              <span
                key={st.col}
                className="shrink-0 inline-flex items-center gap-1 rounded-md border border-border bg-background px-1.5 py-0.5 font-mono"
              >
                <span className="text-muted-foreground">{st.col}</span>
                <span>Σ {fmt(st.sum)}</span>
                <span className="text-muted-foreground">μ {fmt(st.avg)}</span>
              </span>
            ))}
          </div>
        );
      })()}
      {/* Pinned rows (row diff) */}
      {pinnedRows.length > 0 && (
        <div className="flex items-center gap-2 px-3 py-1 text-xs border-t border-border bg-muted">
          <Pin size={11} className="text-muted-foreground shrink-0" />
          {pinnedRows.map((r, i) => (
            <span key={i} className="font-mono text-muted-foreground">
              {rowLabel(r)}
            </span>
          ))}
          {pinnedRows.length === 2 && (
            <button
              onClick={() => setRowDiffOpen(true)}
              className="text-primary hover:underline"
            >
              {t("rowDiffView")}
            </button>
          )}
          <button
            onClick={() => setPinnedRows([])}
            className="text-muted-foreground hover:text-foreground"
          >
            {t("rowDiffClear")}
          </button>
        </div>
      )}
      {/* Changeset bar (M4): staged modifications apply as one transaction */}
      {((tab.pendingChanges?.length ?? 0) > 0 || !!tab.lastAppliedRollbacks?.length) && (
        <div className="flex items-center justify-between gap-2 px-3 py-1 text-xs border-t border-border bg-muted">
          <span className="text-amber-600 dark:text-amber-400 font-medium flex items-center gap-1">
            <Loader2 size={11} className={applyingChanges ? "animate-spin" : "hidden"} />
            {(tab.pendingChanges?.length ?? 0) > 0 &&
              t("changesetBar", { count: tab.pendingChanges!.length })}
          </span>
          <div className="flex items-center gap-2">
            {(tab.pendingChanges?.length ?? 0) > 0 && (
              <>
                <button onClick={() => setChangesetOpen(true)} className="text-primary hover:underline">
                  {t("changesetView")}
                </button>
                <button
                  onClick={() => void applyChanges()}
                  disabled={applyingChanges || tab.isExecuting}
                  className="px-2 py-0.5 font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50 flex items-center gap-1"
                >
                  {t("changesetApply")}
                </button>
                <button
                  onClick={() => {
                    useQueryStore.getState().clearPendingChanges(tab.id);
                    setPendingNewRows([]);
                    // Inline edits live in the grid display only — refresh
                    // so the view matches the database again.
                    void refreshGrid();
                  }}
                  className="text-muted-foreground hover:text-foreground"
                >
                  {t("changesetDiscard")}
                </button>
              </>
            )}
            {!!tab.lastAppliedRollbacks?.length && (
              <button
                onClick={() => void undoLastApplied()}
                disabled={applyingChanges || tab.isExecuting}
                className="text-muted-foreground hover:text-foreground disabled:opacity-50"
                title="Ctrl+Z"
              >
                {t("undoLast")}
              </button>
            )}
          </div>
        </div>
      )}
      {showBrowsePager && browse && (
        <div className="flex w-full items-center justify-between gap-3">
          <button
            onClick={addNewRow}
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
            {selectedRows.length >= 2 && (
              <>
                <MenuRow icon={Copy} label={t("copySelectedTsv", { n: selectedRows.length })} onClick={() => { copySelectedRows("tsv"); setContextMenu(null); }} />
                <MenuRow icon={FileJson} label={t("copySelectedJson")} onClick={() => { copySelectedRows("json"); setContextMenu(null); }} />
                {browse && (
                  <MenuRow icon={Database} label={t("copySelectedInsert")} onClick={() => { copySelectedRows("insert"); setContextMenu(null); }} />
                )}
                <div className="my-1 border-t border-border" />
              </>
            )}
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
                  onClick={() => viewReferencingRows(ref, refValue)}
                />
              );
            })}
            {(() => {
              const rel = fkByColumn.get(contextMenu.col);
              if (!rel || rel.source !== "inferred") return null;
              return (
                <>
                  <MenuRow icon={Check} label={t("confirmRelationship")} onClick={() => adjudicateRel(rel, true)} />
                  <MenuRow icon={Ban} label={t("vetoRelationship")} onClick={() => adjudicateRel(rel, false)} />
                </>
              );
            })()}
            {browse && (
              <MenuRow
                icon={GitFork}
                label={fkByColumn.get(contextMenu.col) ? t("editRelationship") : t("setRelationship")}
                onClick={() => {
                  setRelModalCol(contextMenu.col);
                  setContextMenu(null);
                }}
              />
            )}
            <div className="my-1 border-t border-border" />
            {contextMenu.rowData.__dbdogNew ? (
              <>
                <MenuRow icon={Check} label={t("stageNewRow")} onClick={() => { stageNewRow(contextMenu.rowData); setContextMenu(null); }} />
                <MenuRow icon={Trash2} label={t("discardNewRow")} destructive onClick={() => { discardNewRow(contextMenu.rowData); setContextMenu(null); }} />
              </>
            ) : (
              <MenuRow icon={Pin} label={t("pinRow")} onClick={() => { pinRow(contextMenu.rowData); setContextMenu(null); }} />
            )}
            {!contextMenu.rowData.__dbdogNew && (
              <MenuRow icon={Eye} label={t("viewRowData")} onClick={() => { openRowDetail(contextMenu.rowData, contextMenu.col, browse?.table); setContextMenu(null); }} />
            )}
            {browse && !contextMenu.rowData.__dbdogNew && (
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
        title={detailCell?.tableName}
        relationships={detailCell?.tableName === browse?.table ? relationships : modalRels}
        onFkJump={(rel, value) => void handleFkJump(rel, value)}
        columnName={detailCell?.columnName}
        value={detailCell?.value}
        rowData={detailCell?.rowData}
        onSave={tab.tableBrowse ? handleSave : undefined}
        onDeleteRow={tab.tableBrowse ? handleDeleteModalRow : undefined}
        onClose={() => setDetailCell(null)}
      />

      <RelationshipModal
        open={!!relModalCol}
        connectionId={activeConnectionId}
        database={browse?.database}
        childTable={browse?.table}
        childColumn={relModalCol ?? undefined}
        existing={relModalCol ? fkByColumn.get(relModalCol) ?? null : null}
        samples={relModalSamples}
        onChanged={() => {
          // Reload persisted links, keeping inferred ones that were neither
          // confirmed nor vetoed (they are not part of the stored overview).
          if (!browse || !activeConnectionId) return;
          relationshipService
            .getRelationships(activeConnectionId, browse.database, browse.table)
            .then((overview) => {
              setRelationships((prev) => {
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
              setReferencedBy(overview.referencedBy);
            })
            .catch(() => {});
        }}
        onClose={() => setRelModalCol(null)}
      />

      {/* Changeset review panel: every staged statement, then one-transaction apply */}
      {changesetOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 animate-overlay-in">
          <div className="w-[680px] max-w-[94vw] max-h-[80vh] bg-card border border-border rounded-lg shadow-2xl flex flex-col animate-modal-in">
            <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-muted shrink-0">
              <span className="text-sm font-medium">
                {t("changesetTitle")} · {t("changesetBar", { count: tab.pendingChanges?.length ?? 0 })}
              </span>
              <button onClick={() => setChangesetOpen(false)} className="text-muted-foreground hover:text-foreground" aria-label={t("close")}>
                <X size={16} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-3 space-y-2">
              {(tab.pendingChanges ?? []).map((c, i) => (
                <div key={c.id} className="border border-border rounded-md p-2">
                  <div className="flex items-center justify-between mb-1">
                    <span className={`text-xs font-medium ${c.kind === "delete" ? "text-destructive" : "text-amber-600 dark:text-amber-400"}`}>
                      {i + 1}. {c.kind.toUpperCase()} · {c.table}
                    </span>
                    <button
                      onClick={() => useQueryStore.getState().removePendingChange(tab.id, c.id)}
                      className="p-0.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                      aria-label={t("changesetRemove")}
                    >
                      <X size={12} />
                    </button>
                  </div>
                  <pre className="text-xs font-mono whitespace-pre-wrap break-all text-foreground/90 bg-muted rounded-md px-2 py-1.5">{c.sql}</pre>
                </div>
              ))}
              {(tab.pendingChanges?.length ?? 0) === 0 && (
                <div className="text-xs text-muted-foreground px-1 py-2">{t("empty")}</div>
              )}
            </div>
            <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-border bg-muted shrink-0">
              <button
                onClick={() => void applyChanges()}
                disabled={applyingChanges || (tab.pendingChanges?.length ?? 0) === 0}
                className="px-3 py-1.5 text-xs font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50 flex items-center gap-1"
              >
                {applyingChanges && <Loader2 size={12} className="animate-spin" />}
                {t("changesetApply")}
              </button>
              <button
                onClick={() => setChangesetOpen(false)}
                className="px-3 py-1.5 text-xs font-medium rounded-md border border-border bg-secondary text-secondary-foreground hover:bg-secondary/80 transition-colors"
              >
                {t("close")}
              </button>
            </div>
          </div>
        </div>
      )}

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


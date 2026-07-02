import { useMemo, useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { AgGridReact } from "ag-grid-react";
import type { ColDef, ICellRendererParams, ITooltipParams } from "ag-grid-community";
import { useUiStore } from "../../stores/uiStore";
import { useConnectionStore } from "../../stores/connectionStore";
import type { QueryResult, QueryTab, UpdateResult } from "../../types";
import { CellDetailModal } from "./CellDetailModal";
import * as queryService from "../../services/queryService";
import { useQueryStore } from "../../stores/queryStore";
import { showSuccess, showError } from "../../stores/toastStore";
import { parseTauriError } from "../../lib/error";

const agGridLocaleText = {
  pageSizeSelectorLabel: "每页条数：",
  ariaPageSizeSelectorLabel: "每页条数",
  page: "第",
  of: "页，共",
  to: "-",
  firstPage: "首页",
  previousPage: "上一页",
  nextPage: "下一页",
  lastPage: "末页",
  noRowsToShow: "暂无数据",
  loadingOoo: "加载中...",
  ariaSkeletonCellLoading: "数据加载中",
  ariaSkeletonCellLoadingFailed: "数据加载失败",
};

function getSystemTheme(): "dark" | "light" {
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

function resolveEffectiveTheme(
  theme: "light" | "dark" | "system",
): "light" | "dark" {
  if (theme === "system") return getSystemTheme();
  return theme;
}

interface DetailCellInfo {
  columnName: string;
  value: unknown;
  rowData: Record<string, unknown>;
}

interface ResultGridProps {
  tab: QueryTab;
}

export function ResultGrid({ tab }: ResultGridProps) {
  const { t } = useTranslation("query");
  const { theme } = useUiStore();
  const activeConnectionId = useConnectionStore((s) => s.activeId);

  const [detailCell, setDetailCell] = useState<DetailCellInfo | null>(null);

  const isQueryResult = tab.isQueryResult;
  const result = tab.result;

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

  const handleCellClick = useCallback(
    (event: { colDef: { field?: string; headerName?: string }; value: unknown; data: unknown }) => {
      setDetailCell({
        columnName: String(event.colDef.headerName ?? event.colDef.field ?? ""),
        value: event.value,
        rowData: (event.data as Record<string, unknown>) ?? {},
      });
    },
    [],
  );

  const handleSave = useCallback(
    async (newValue: string) => {
      if (!detailCell || !tab.editableTable || !activeConnectionId || !isQueryResult || !result) return;

      const qr = result as QueryResult;
      const colName = detailCell.columnName;
      const { database, table } = tab.editableTable;

      const wheres: string[] = [];
      for (const col of qr.columns) {
        if (col.name === colName) continue;
        const val = detailCell.rowData[col.name];
        wheres.push(
          val === null || val === undefined
            ? `\`${col.name}\` IS NULL`
            : `\`${col.name}\` = ${formatSqlValue(val)}`,
        );
      }

      const setClause =
        newValue === ""
          ? `\`${colName}\` = NULL`
          : `\`${colName}\` = ${formatSqlValue(newValue)}`;

      const sql = `UPDATE \`${database}\`.\`${table}\` SET ${setClause} WHERE ${wheres.join(" AND ")} LIMIT 1;`;

      const startTime = performance.now();
      try {
        await queryService.executeUpdate(activeConnectionId, sql, database);
        const elapsedMs = Math.round(performance.now() - startTime);
        useQueryStore.getState().addHistory({
          sql,
          status: "success",
          elapsedMs,
        });
        showSuccess(`Updated \`${table}\`.\`${colName}\``);

        // Refresh the grid by re-executing the original query
        if (tab.sql.trim()) {
          try {
            const freshResult = await queryService.executeQuery(
              activeConnectionId,
              tab.sql,
              undefined,
              tab.selectedDatabase,
            );
            useQueryStore.getState().setTabResult(tab.id, freshResult, true);
          } catch {
            // Grid refresh failed silently — the UPDATE itself succeeded
          }
        }
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
    [detailCell, tab.editableTable, activeConnectionId, isQueryResult, result],
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

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between px-3 py-1 text-xs border-b border-border bg-muted">
        <span>
          {queryResult.totalCount} {t("rows")}{" "}
          {queryResult.truncated && `(${t("truncated")})`}
        </span>
        <span>{queryResult.elapsedMs}ms</span>
      </div>
      <div className={`flex-1 min-h-0 ${resolveEffectiveTheme(theme) === "dark" ? "ag-theme-quartz-dark" : "ag-theme-quartz"}`}>
        <AgGridReact
          columnDefs={columnDefs}
          rowData={rowData}
          pagination={true}
          paginationPageSize={100}
          paginationPageSizeSelector={[50, 100, 200, 500]}
          localeText={agGridLocaleText}
          enableCellTextSelection
          onCellClicked={handleCellClick}
        />
      </div>

      {detailCell && (
        <CellDetailModal
          columnName={detailCell.columnName}
          value={detailCell.value}
          onSave={tab.editableTable ? handleSave : undefined}
          onClose={() => setDetailCell(null)}
        />
      )}
    </div>
  );
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

function formatSqlValue(val: unknown): string {
  if (val === null || val === undefined) return "NULL";
  if (typeof val === "number") return String(val);
  if (typeof val === "bigint") return String(val);
  if (typeof val === "boolean") return val ? "1" : "0";
  const s = String(val);
  return `'${s.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
}

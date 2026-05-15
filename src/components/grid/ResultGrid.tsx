import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { AgGridReact } from "ag-grid-react";
import type { ICellRendererParams, ITooltipParams } from "ag-grid-community";
import { useUiStore } from "../../stores/uiStore";
import type { QueryResult, QueryTab, UpdateResult } from "../../types";
import { CellDetailModal } from "./CellDetailModal";

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

interface ResultGridProps {
  tab: QueryTab;
}

export function ResultGrid({ tab }: ResultGridProps) {
  const { t } = useTranslation("query");
  const { theme } = useUiStore();

  const [detailCell, setDetailCell] = useState<{
    columnName: string;
    value: unknown;
  } | null>(null);

  const isQueryResult = tab.isQueryResult;
  const result = tab.result;

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

  const columnDefs = useMemo(
    () =>
      queryResult.columns.map((col) => ({
        field: col.name,
        headerName: col.name,
        headerTooltip: `${col.name} (${col.dataType})`,
        cellDataType: false,
        flex: 1,
        minWidth: 80,
        filter: getFilterType(col.dataType),
        sortable: true,
        valueFormatter: (params: { value: unknown }) => {
          if (params.value === null || params.value === undefined) {
            return "NULL";
          }
          if (typeof params.value === "boolean") {
            return params.value ? "true" : "false";
          }
          return String(params.value);
        },
        tooltipValueGetter: (params: ITooltipParams) => {
          const formatted = formatCellValue(params.value);
          if (formatted.length <= 200) {
            return formatted;
          }
          return formatted.slice(0, 200) + "...";
        },
        cellRenderer: (params: ICellRendererParams) => {
          const value = params.value;
          const formatted = formatCellValue(value);
          const displayText =
            formatted.length > 50
              ? formatted.slice(0, 50) + "..."
              : formatted;
          return (
            <span
              className="inline-flex items-center gap-1 w-full cursor-pointer hover:underline"
              title={t("clickToViewFullContent")}
            >
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
      })),
    [queryResult.columns],
  );

  const rowData = useMemo(() => {
    return queryResult.rows.map((row) => {
      const obj: Record<string, unknown> = {};
      queryResult.columns.forEach((col, i) => {
        if (i < row.length) {
          obj[col.name] = row[i];
        } else {
          obj[col.name] = null;
        }
      });
      return obj;
    });
  }, [queryResult.rows, queryResult.columns]);

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
          suppressRowClickSelection
          enableCellTextSelection
          onCellClicked={(event) => {
            setDetailCell({
              columnName: String(event.colDef.headerName ?? event.colDef.field ?? ""),
              value: event.value,
            });
          }}
        />
      </div>

      {detailCell && (
        <CellDetailModal
          columnName={detailCell.columnName}
          value={detailCell.value}
          onClose={() => setDetailCell(null)}
        />
      )}
    </div>
  );
}

function formatCellValue(value: unknown): string {
  if (value === null || value === undefined) {
    return "NULL";
  }
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }
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

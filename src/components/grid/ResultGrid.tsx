import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { AgGridReact } from "ag-grid-react";
import { useUiStore } from "../../stores/uiStore";
import type { QueryResult, QueryTab, UpdateResult } from "../../types";

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
          suppressRowClickSelection
          enableCellTextSelection
        />
      </div>
    </div>
  );
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

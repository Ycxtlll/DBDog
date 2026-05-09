import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { AgGridReact } from "ag-grid-react";
import type { QueryTab } from "../../types";

interface ResultGridProps {
  tab: QueryTab;
}

export function ResultGrid({ tab }: ResultGridProps) {
  const { t } = useTranslation("query");

  const isQueryResult = tab.isQueryResult;
  const result = tab.result;

  if (!result) return null;

  if (!isQueryResult) {
    const updateResult = result as {
      rowsAffected: number;
      lastInsertId?: number;
      elapsedMs: number;
    };
    return (
      <div className="h-full flex flex-col items-center justify-center text-muted-foreground">
        <div className="text-lg font-medium">
          {updateResult.rowsAffected} {t("rowsAffected")}
        </div>
        {updateResult.lastInsertId && (
          <div className="text-sm">
            {t("lastInsertId")}: {updateResult.lastInsertId}
          </div>
        )}
        <div className="text-xs">{updateResult.elapsedMs}ms</div>
      </div>
    );
  }

  const queryResult = result as {
    columns: { name: string; dataType: string; nullable: boolean }[];
    rows: unknown[][];
    totalCount: number;
    truncated: boolean;
    elapsedMs: number;
  };

  const columnDefs = useMemo(
    () =>
      queryResult.columns.map((col) => ({
        field: col.name,
        headerName: col.name,
        headerTooltip: `${col.name} (${col.dataType})`,
        flex: 1,
        minWidth: 80,
        filter: getFilterType(col.dataType),
        sortable: true,
      })),
    [queryResult.columns],
  );

  const rowData = useMemo(() => {
    return queryResult.rows.map((row) => {
      const obj: Record<string, unknown> = {};
      queryResult.columns.forEach((col, i) => {
        obj[col.name] = row[i];
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
      <div className="flex-1 min-h-0 ag-theme-quartz-dark">
        <AgGridReact
          columnDefs={columnDefs}
          rowData={rowData}
          pagination={false}
          suppressRowClickSelection
          enableCellTextSelection
        />
      </div>
    </div>
  );
}

function getFilterType(dataType: string): string {
  const upper = dataType.toUpperCase();
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

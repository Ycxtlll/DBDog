import type { ColDef, ICellRendererParams, ITooltipParams } from "ag-grid-community";
import type { QueryResult, TableRelationship } from "../../types";
import { FkJumpButton } from "./FkJumpButton";
import { formatCellValue, getFilterType } from "./gridHelpers";

/**
 * Pure builders for the result grid's AG Grid model. Extracted from
 * ResultGrid so the component stays readable; the cell renderer keeps the
 * NULL / empty-string distinction and the FK jump affordance.
 */
export function buildColumnDefs(
  result: QueryResult,
  fkByColumn: Map<string, TableRelationship>,
): ColDef[] {
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
    ...result.columns.map(
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
}

/** Query rows → objects keyed by column name, plus the INSERT placeholders. */
export function buildRowData(
  result: QueryResult,
  pendingNewRows: Record<string, unknown>[],
): Record<string, unknown>[] {
  const rows = result.rows.map((row) => {
    const obj: Record<string, unknown> = {};
    result.columns.forEach((col, i) => {
      if (i < row.length) {
        obj[col.name] = row[i];
      } else {
        obj[col.name] = null;
      }
    });
    return obj;
  });
  return [...rows, ...pendingNewRows];
}

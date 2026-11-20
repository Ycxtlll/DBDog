import { useTranslation } from "react-i18next";
import type { QueryResult } from "../../types";

interface SelectionStatsBarProps {
  selectedRows: Record<string, unknown>[];
  queryResult: QueryResult;
}

/** Selection stats — instant Σ/μ aggregates over the checked rows. */
export function SelectionStatsBar({ selectedRows, queryResult }: SelectionStatsBarProps) {
  const { t } = useTranslation("query");
  if (selectedRows.length === 0) return null;

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
}

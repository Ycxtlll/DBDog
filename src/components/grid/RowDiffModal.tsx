import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useModalFocus } from "../../lib/useModalFocus";
import { useDelayedUnmount } from "../../lib/useDelayedUnmount";
import { Checkbox } from "../ui/Checkbox";

interface RowDiffModalProps {
  open: boolean;
  left?: Record<string, unknown>;
  right?: Record<string, unknown>;
  tableName?: string;
  onClose: () => void;
}

function cellText(v: unknown): string {
  if (v === null || v === undefined) return "NULL";
  if (typeof v === "object") return JSON.stringify(v);
  const s = String(v);
  return s.length > 200 ? s.slice(0, 200) + "…" : s;
}

/**
 * Side-by-side comparison of two pinned rows: columns union, differing
 * cells highlighted. The quick "这两行差在哪" answer for debuggers.
 */
export function RowDiffModal({ open, left, right, tableName, onClose }: RowDiffModalProps) {
  const { t } = useTranslation("query");
  const panelRef = useRef<HTMLDivElement>(null);
  useModalFocus(panelRef, { active: open });
  const show = useDelayedUnmount(open);
  const closing = show && !open;
  const [onlyDiff, setOnlyDiff] = useState(false);

  // Reset per open pair.
  useEffect(() => {
    if (open) setOnlyDiff(false);
  }, [open, left, right]);

  const allRows = useMemo(() => {
    if (!left || !right) return [];
    const cols = [...new Set([...Object.keys(left), ...Object.keys(right)])];
    return cols.map((col) => {
      const l = left[col];
      const r = right[col];
      return { col, l, r, diff: cellText(l) !== cellText(r) };
    });
  }, [left, right]);
  const diffTotal = allRows.filter((r) => r.diff).length;
  const rows = onlyDiff ? allRows.filter((r) => r.diff) : allRows;

  if (!show || !left || !right) return null;

  return (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 ${closing ? "animate-overlay-out" : "animate-overlay-in"}`}
    >
      <div
        ref={panelRef}
        className={`w-[720px] max-w-[94vw] max-h-[80vh] bg-card border border-border rounded-lg shadow-2xl flex flex-col ${closing ? "animate-modal-out" : "animate-modal-in"}`}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-muted shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-sm font-medium">{t("rowDiffTitle")}</span>
            {tableName && (
              <span className="text-xs font-mono text-primary bg-primary/10 rounded-md px-1.5 py-0.5">
                {tableName}
              </span>
            )}
            <span className="text-xs text-muted-foreground">
              {t("rowDiffSummary", { diff: diffTotal, total: allRows.length })}
            </span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Checkbox
              checked={onlyDiff}
              onChange={(e) => setOnlyDiff(e.target.checked)}
              className="text-xs text-muted-foreground"
            >
              {t("rowDiffOnlyDiff")}
            </Checkbox>
          </div>
        </div>
        <div className="flex-1 overflow-auto">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-muted">
              <tr>
                <th className="text-left font-medium text-muted-foreground px-3 py-1.5 border-b border-border w-[22%]">{t("rowDiffCol")}</th>
                <th className="text-left font-medium text-muted-foreground px-3 py-1.5 border-b border-border">{t("rowDiffLeft")}</th>
                <th className="text-left font-medium text-muted-foreground px-3 py-1.5 border-b border-border">{t("rowDiffRight")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.col} className={row.diff ? "bg-amber-500/5" : ""}>
                  <td className="px-3 py-1.5 border-b border-border/50 font-mono text-muted-foreground align-top">{row.col}</td>
                  <td className={`px-3 py-1.5 border-b border-border/50 font-mono break-all align-top ${row.diff ? "text-foreground" : "text-muted-foreground"}`}>
                    {row.l === null || row.l === undefined ? <span className="italic">NULL</span> : cellText(row.l)}
                  </td>
                  <td className={`px-3 py-1.5 border-b border-border/50 font-mono break-all align-top ${row.diff ? "text-foreground" : "text-muted-foreground"}`}>
                    {row.r === null || row.r === undefined ? <span className="italic">NULL</span> : cellText(row.r)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-end px-4 py-3 border-t border-border bg-muted shrink-0">
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-xs font-medium rounded-md border border-border bg-secondary text-secondary-foreground hover:bg-secondary/80 transition-colors"
          >
            {t("close")}
          </button>
        </div>
      </div>
    </div>
  );
}

import { useTranslation } from "react-i18next";
import { Pin } from "lucide-react";

interface PinnedRowsBarProps {
  pinnedRows: Record<string, unknown>[];
  rowLabel: (row: Record<string, unknown>) => string;
  onOpenDiff: () => void;
  onClear: () => void;
}

/** Pinned rows strip (row diff): up to two rows, compare side by side. */
export function PinnedRowsBar({ pinnedRows, rowLabel, onOpenDiff, onClear }: PinnedRowsBarProps) {
  const { t } = useTranslation("query");
  if (pinnedRows.length === 0) return null;

  return (
    <div className="flex items-center gap-2 px-3 py-1 text-xs border-t border-border bg-muted">
      <Pin size={11} className="text-muted-foreground shrink-0" />
      {pinnedRows.map((r, i) => (
        <span key={i} className="font-mono text-muted-foreground">
          {rowLabel(r)}
        </span>
      ))}
      {pinnedRows.length === 2 && (
        <button onClick={onOpenDiff} className="text-primary hover:underline">
          {t("rowDiffView")}
        </button>
      )}
      <button onClick={onClear} className="text-muted-foreground hover:text-foreground">
        {t("rowDiffClear")}
      </button>
    </div>
  );
}

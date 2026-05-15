import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

interface CellDetailModalProps {
  columnName: string;
  value: unknown;
  onClose: () => void;
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) {
    return "NULL";
  }
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }
  return String(value);
}

export function CellDetailModal({ columnName, value, onClose }: CellDetailModalProps) {
  const { t } = useTranslation("query");
  const contentRef = useRef<HTMLTextAreaElement>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const displayValue = formatValue(value);
  const isNull = value === null || value === undefined;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="w-[800px] max-w-[90vw] max-h-[80vh] bg-card border border-border rounded-lg shadow-2xl overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-muted">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-sm font-medium text-foreground truncate">
              {columnName}
            </span>
            <span className="text-xs text-muted-foreground">
              {displayValue.length} {t("chars")}
            </span>
          </div>
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground transition-colors shrink-0 ml-2"
            aria-label={t("close")}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M18 6 6 18" />
              <path d="m6 6 12 12" />
            </svg>
          </button>
        </div>

        <div className="flex-1 min-h-0 p-4">
          {isNull ? (
            <div className="text-muted-foreground italic">NULL</div>
          ) : (
            <textarea
              ref={contentRef}
              readOnly
              value={displayValue}
              className="w-full h-full min-h-[200px] max-h-[60vh] bg-background text-foreground text-sm font-mono p-3 rounded-md border border-border resize-none outline-none focus:ring-1 focus:ring-ring"
            />
          )}
        </div>

        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-border bg-muted">
          <button
            onClick={() => {
              navigator.clipboard.writeText(displayValue).then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              });
            }}
            className={`px-3 py-1.5 text-xs font-medium rounded-md border transition-colors ${
              copied
                ? "border-green-500 text-green-600 bg-green-500/10"
                : "border-border bg-secondary text-secondary-foreground hover:bg-secondary/80"
            }`}
          >
            {copied ? t("copied") : t("copy")}
          </button>
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-xs font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            {t("close")}
          </button>
        </div>
      </div>
    </div>
  );
}

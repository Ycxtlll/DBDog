import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, Copy, X } from "lucide-react";
import { useModalFocus } from "../../lib/useModalFocus";
import { useDelayedUnmount } from "../../lib/useDelayedUnmount";
import { showSuccess } from "../../stores/toastStore";

interface LargeValueDrawerProps {
  open: boolean;
  columnName?: string;
  tableName?: string;
  value?: unknown;
  onClose: () => void;
}

/**
 * Full-content viewer for LONGTEXT/JSON cells: raw vs formatted (pretty
 * JSON) toggle, complete copy, scrollable monospace body. Read-only —
 * editing happens in the row modal.
 */
export function LargeValueDrawer({ open, columnName, tableName, value, onClose }: LargeValueDrawerProps) {
  const { t } = useTranslation("query");
  const panelRef = useRef<HTMLDivElement>(null);
  useModalFocus(panelRef, { active: open, onEscape: onClose });
  const show = useDelayedUnmount(open);
  const closing = show && !open;

  const raw = value === null || value === undefined ? "" : String(value);
  const parsed = useMemo(() => {
    const trimmed = raw.trim();
    if (!(trimmed.startsWith("{") || trimmed.startsWith("["))) return null;
    try {
      const v = JSON.parse(trimmed);
      return typeof v === "object" && v !== null ? v : null;
    } catch {
      return null;
    }
  }, [raw]);

  const [formatted, setFormatted] = useState(true);
  const [copied, setCopied] = useState(false);

  // Reset the view mode per opened value (JSON defaults to pretty).
  useEffect(() => {
    if (open) {
      setFormatted(parsed !== null);
      setCopied(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset per value
  }, [open, raw]);

  const text = formatted && parsed !== null ? JSON.stringify(parsed, null, 2) : raw;

  const handleCopy = () => {
    navigator.clipboard
      .writeText(text)
      .then(() => {
        setCopied(true);
        showSuccess(t("copiedToast"));
        setTimeout(() => setCopied(false), 1500);
      })
      .catch(() => {});
  };

  if (!show) return null;

  return (
    <div
      ref={panelRef}
      className={`fixed right-0 top-0 bottom-0 w-[560px] max-w-[90vw] bg-card border-l border-border shadow-2xl z-[70] flex flex-col ${closing ? "animate-overlay-out" : "animate-overlay-in"}`}
    >
      <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-muted shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-sm font-medium truncate">{columnName}</span>
          {tableName && (
            <span className="text-xs font-mono text-primary bg-primary/10 rounded-md px-1.5 py-0.5">
              {tableName}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {parsed !== null && (
            <div className="flex items-center rounded-md border border-border overflow-hidden mr-1">
              <button
                onClick={() => setFormatted(false)}
                className={`px-2 py-1 text-xs transition-colors ${!formatted ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-accent/50"}`}
              >
                {t("rawText")}
              </button>
              <button
                onClick={() => setFormatted(true)}
                className={`px-2 py-1 text-xs transition-colors ${formatted ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-accent/50"}`}
              >
                {t("formatted")}
              </button>
            </div>
          )}
          <button
            onClick={handleCopy}
            className={`p-1.5 rounded-md transition-colors ${copied ? "text-green-600" : "text-muted-foreground hover:text-foreground hover:bg-accent"}`}
            title={t("copyFull")}
          >
            {copied ? <Check size={14} /> : <Copy size={14} />}
          </button>
          <button onClick={onClose} className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors" aria-label={t("close")}>
            <X size={16} />
          </button>
        </div>
      </div>
      <div className="flex-1 overflow-auto p-3">
        <pre className="text-xs font-mono whitespace-pre-wrap break-all text-foreground leading-relaxed">{text}</pre>
      </div>
    </div>
  );
}

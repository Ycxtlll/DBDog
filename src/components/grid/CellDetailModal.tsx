import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Loader2 } from "lucide-react";

interface CellDetailModalProps {
  columnName: string;
  value: unknown;
  /** If provided, the modal enables an Edit/Save mode. */
  onSave?: (newValue: string) => Promise<void>;
  onClose: () => void;
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "boolean") return value ? "true" : "false";
  return String(value);
}

export function CellDetailModal({
  columnName,
  value,
  onSave,
  onClose,
}: CellDetailModalProps) {
  const { t } = useTranslation("query");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [copied, setCopied] = useState(false);
  const [saving, setSaving] = useState(false);

  const displayValue = formatValue(value);
  const isNull = value === null || value === undefined;
  const canEdit = !!onSave;

  // Open directly in edit mode for editable cells
  const [editing] = useState(canEdit);
  const [editText, setEditText] = useState(
    canEdit ? (isNull ? "" : displayValue) : "",
  );

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  // Auto-focus the textarea when opening in edit mode
  useEffect(() => {
    if (canEdit) {
      setTimeout(() => textareaRef.current?.focus(), 50);
    }
  }, [canEdit]);

  const handleSave = async () => {
    if (!onSave || saving) return;
    setSaving(true);
    try {
      await onSave(editText);
      onClose();
    } catch {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="w-[700px] max-w-[90vw] max-h-[80vh] bg-card border border-border rounded-lg shadow-2xl overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-muted">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-sm font-medium font-mono truncate">
              {columnName}
            </span>
            {!editing && (
              <span className="text-xs text-muted-foreground shrink-0">
                {displayValue.length} {t("chars")}
              </span>
            )}
            {editing && (
              <span className="text-xs text-amber-500 font-medium shrink-0">
                {t("editing")}
              </span>
            )}
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

        {/* Body */}
        <div className="flex-1 min-h-0 p-4">
          {!editing && isNull && (
            <div className="text-muted-foreground italic">NULL</div>
          )}
          {!editing && !isNull && (
            <textarea
              readOnly
              value={displayValue}
              className="w-full h-full min-h-[200px] max-h-[50vh] bg-background text-foreground text-sm font-mono p-3 rounded-md border border-border resize-none outline-none"
            />
          )}
          {editing && (
            <textarea
              ref={textareaRef}
              value={editText}
              onChange={(e) => setEditText(e.target.value)}
              className="w-full h-full min-h-[200px] max-h-[50vh] bg-background text-foreground text-sm font-mono p-3 rounded-md border border-amber-500/50 resize-none outline-none focus:ring-1 focus:ring-amber-500"
              placeholder="Type value... (NULL for empty)"
            />
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-4 py-3 border-t border-border bg-muted">
          <span className="text-xs text-muted-foreground">
            {editing && (
              <>{editText.length} {t("chars")}</>
            )}
          </span>
          <div className="flex items-center gap-2">
            {!editing && (
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
            )}
            {editing && (
              <>
                <button
                  onClick={onClose}
                  className="px-3 py-1.5 text-xs font-medium rounded-md border border-border bg-secondary text-secondary-foreground hover:bg-secondary/80 transition-colors"
                >
                  {t("cancel")}
                </button>
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="px-3 py-1.5 text-xs font-medium rounded-md bg-amber-500 text-white hover:bg-amber-600 transition-colors disabled:opacity-50 flex items-center gap-1"
                >
                  {saving && <Loader2 size={12} className="animate-spin" />}
                  {t("save")}
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

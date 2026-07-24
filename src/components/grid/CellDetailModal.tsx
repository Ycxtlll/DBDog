import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Loader2 } from "lucide-react";

interface CellDetailModalProps {
  columnName: string;
  value: unknown;
  /** Full row data (all columns → value). */
  rowData: Record<string, unknown>;
  /** If provided, the modal enables edit/save for focused cell. */
  onSave?: (columnName: string, newValue: string) => Promise<void>;
  /** If provided, shows a "Delete Row" button that deletes the entire row. */
  onDeleteRow?: () => Promise<void>;
  onClose: () => void;
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

export function CellDetailModal({
  columnName,
  value: _value,
  rowData,
  onSave,
  onDeleteRow,
  onClose,
}: CellDetailModalProps) {
  const { t } = useTranslation("query");
  const editInputRef = useRef<HTMLInputElement>(null);
  const [copied, setCopied] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Which field is being edited (column name), null = view mode
  const [editingField, setEditingField] = useState<string | null>(null);
  const [editText, setEditText] = useState("");

  const canEdit = !!onSave;
  const columns = Object.keys(rowData);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (editingField) {
          setEditingField(null);
        } else {
          onClose();
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose, editingField]);

  // Focus input when entering edit mode
  useEffect(() => {
    if (editingField) {
      setTimeout(() => editInputRef.current?.focus(), 50);
    }
  }, [editingField]);

  const startEdit = (col: string) => {
    if (!canEdit) return;
    const rawVal = rowData[col];
    setEditingField(col);
    setEditText(rawVal === null || rawVal === undefined ? "" : formatValue(rawVal));
  };

  const handleSave = async () => {
    if (!onSave || !editingField || saving) return;
    setSaving(true);
    try {
      await onSave(editingField, editText);
      setEditingField(null);
    } catch {
      setSaving(false);
    }
  };

  const handleSetNull = async () => {
    if (!onSave || !editingField || saving) return;
    setSaving(true);
    try {
      await onSave(editingField, "");
      setEditingField(null);
    } catch {
      setSaving(false);
    }
  };

  const handleDeleteRow = async () => {
    if (!onDeleteRow || deleting) return;
    const confirmed = window.confirm("确定要删除这一行吗？\n此操作不可撤销。");
    if (!confirmed) return;
    setDeleting(true);
    try {
      await onDeleteRow();
      onClose();
    } catch {
      setDeleting(false);
    }
  };

  const handleCopyRow = () => {
    const text = columns
      .map((col) => `${col}: ${formatValue(rowData[col])}`)
      .join("\n");
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  const isNull = (v: unknown) => v === null || v === undefined;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
    >
      <div
        className="w-[750px] max-w-[92vw] max-h-[85vh] bg-card border border-border rounded-lg shadow-2xl overflow-hidden flex flex-col"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-muted shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-sm font-medium">行数据</span>
            <span className="text-xs text-muted-foreground">
              {columns.length} 列
            </span>
            {editingField && (
              <span className="text-xs text-amber-500 font-medium shrink-0">
                {t("editing")}: {editingField}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={handleCopyRow}
              className={`px-2.5 py-1 text-xs font-medium rounded-md border transition-colors ${
                copied
                  ? "border-green-500 text-green-600 bg-green-500/10"
                  : "border-border bg-secondary text-secondary-foreground hover:bg-secondary/80"
              }`}
            >
              {copied ? t("copied") : t("copy")}
            </button>
            <button
              onClick={onClose}
              className="text-muted-foreground hover:text-foreground transition-colors"
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
        </div>

        {/* Body — scrollable form of all columns */}
        <div className="flex-1 overflow-y-auto p-4 space-y-0.5">
          {columns.map((col) => {
            const val = rowData[col];
            const nullVal = isNull(val);
            const isEditing = editingField === col;
            const isFocused = col === columnName;

            return (
              <div
                key={col}
                className={`flex items-stretch rounded-md transition-colors ${
                  isEditing
                    ? "bg-amber-500/5 ring-1 ring-amber-500/30"
                    : isFocused
                      ? "bg-accent/30"
                      : "hover:bg-accent/10"
                }`}
              >
                {/* Column name label */}
                <button
                  type="button"
                  onClick={() => startEdit(col)}
                  disabled={!canEdit}
                  className="w-[180px] shrink-0 flex items-center gap-1.5 px-3 py-2 text-xs font-mono font-medium text-left truncate border-r border-border/50 hover:bg-accent/20 transition-colors disabled:cursor-default"
                  title={`${col} — 点击编辑`}
                >
                  {col}
                  {isFocused && !isEditing && (
                    <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-500 shrink-0" />
                  )}
                </button>

                {/* Value */}
                <div className="flex-1 min-w-0 px-3 py-2 flex items-center">
                  {isEditing ? (
                    <div className="flex items-center gap-2 w-full">
                      <input
                        ref={editInputRef}
                        type="text"
                        value={editText}
                        onChange={(e) => setEditText(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") handleSave();
                        }}
                        className="flex-1 bg-background text-foreground text-sm font-mono px-2 py-1 rounded border border-amber-500/50 outline-none focus:ring-1 focus:ring-amber-500"
                      />
                      <button
                        onClick={handleSetNull}
                        disabled={saving}
                        className="px-2 py-1 text-xs rounded border border-border text-muted-foreground hover:text-foreground hover:border-muted-foreground/40 transition-colors disabled:opacity-50 shrink-0"
                      >
                        NULL
                      </button>
                      <button
                        onClick={handleSave}
                        disabled={saving}
                        className="px-2 py-1 text-xs font-medium rounded bg-amber-500 text-white hover:bg-amber-600 transition-colors disabled:opacity-50 flex items-center gap-1 shrink-0"
                      >
                        {saving && <Loader2 size={11} className="animate-spin" />}
                        保存
                      </button>
                    </div>
                  ) : (
                    <span
                      className={`text-sm font-mono truncate ${
                        nullVal
                          ? "text-muted-foreground italic"
                          : "text-foreground"
                      } ${canEdit ? "cursor-pointer hover:underline" : ""}`}
                      onClick={() => startEdit(col)}
                      title={nullVal ? "NULL" : formatValue(val)}
                    >
                      {nullVal ? "NULL" : formatValue(val)}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-4 py-3 border-t border-border bg-muted shrink-0">
          <span className="text-xs text-muted-foreground">
            {editingField
              ? `编辑 ${editingField} — Enter 保存，Esc 取消`
              : canEdit
                ? "点击列值可编辑"
                : ""}
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="px-3 py-1.5 text-xs font-medium rounded-md border border-border bg-secondary text-secondary-foreground hover:bg-secondary/80 transition-colors"
            >
              {t("close")}
            </button>
            {onDeleteRow && (
              <button
                onClick={handleDeleteRow}
                disabled={saving || deleting}
                className="px-3 py-1.5 text-xs font-medium rounded-md bg-destructive/90 text-destructive-foreground hover:bg-destructive transition-colors disabled:opacity-50 flex items-center gap-1"
              >
                {deleting && <Loader2 size={12} className="animate-spin" />}
                删除行
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

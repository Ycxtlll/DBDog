import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Copy, Loader2, Rows3 } from "lucide-react";
import { confirmDialog } from "../../lib/confirm";
import { useModalFocus } from "../../lib/useModalFocus";
import { useDelayedUnmount } from "../../lib/useDelayedUnmount";
import { FkJumpButton } from "./FkJumpButton";
import type { TableRelationship } from "../../types";
import { LargeValueDrawer } from "./LargeValueDrawer";

interface CellDetailModalProps {
  /** Stays mounted while the exit animation plays; controls visibility. */
  open: boolean;
  /** Table the row belongs to — shown as a badge in the header (the FK
   *  jump shows the PARENT table, plain row view shows the browsed one). */
  title?: string;
  /** Logical FK links for the displayed table — FK columns render a jump
   *  button (same look/size as the grid cells). */
  relationships?: TableRelationship[];
  onFkJump?: (rel: TableRelationship, value: unknown) => void;
  columnName?: string;
  value?: unknown;
  /** Full row data (all columns → value). */
  rowData?: Record<string, unknown>;
  /** If provided, the modal enables edit/save for focused cell.
   *  `null` = set the column to NULL; a string (including "") is saved
   *  literally — NULL and the empty string are distinct values (M3). */
  onSave?: (columnName: string, newValue: string | null) => Promise<void>;
  /** If provided, shows a "Delete Row" button that deletes the entire row. */
  onDeleteRow?: () => Promise<void>;
  onClose: () => void;
}

interface CellDetailSnapshot {
  columnName: string;
  value: unknown;
  rowData: Record<string, unknown>;
}

interface RowContextMenu {
  x: number;
  y: number;
  col: string;
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

export function CellDetailModal({
  open,
  title,
  relationships = [],
  onFkJump,
  columnName,
  value: _value,
  rowData,
  onSave,
  onDeleteRow,
  onClose,
}: CellDetailModalProps) {
  const { t } = useTranslation("query");
  const editInputRef = useRef<HTMLTextAreaElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [rowMenu, setRowMenu] = useState<RowContextMenu | null>(null);

  // The parent keeps this mounted for the exit animation after the row is
  // cleared — serve the last visible row from a snapshot while closing.
  const snapshotRef = useRef<CellDetailSnapshot>({ columnName: "", value: null, rowData: {} });
  if (open && rowData && Object.keys(rowData).length > 0) {
    snapshotRef.current = { columnName: columnName ?? "", value: _value ?? null, rowData };
  }
  const snapshot = snapshotRef.current;

  // Esc is handled by the modal itself (exit edit mode first); the hook
  // provides initial focus + Tab trapping. The component stays mounted for
  // the exit animation, so the hook must be gated on `open`.
  useModalFocus(panelRef, { active: open });

  // Which field is being edited (column name), null = view mode
  const [editingField, setEditingField] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  /** Long-value viewer (M3 大值抽屉). */
  const [largeValue, setLargeValue] = useState<{ col: string; value: unknown } | null>(null);

  // Reset transient edit state on (re)open — the component stays mounted.
  useEffect(() => {
    if (open) {
      setEditingField(null);
      setCopied(false);
      setSaving(false);
      setDeleting(false);
      setRowMenu(null);
      setLargeValue(null);
    }
  }, [open]);

  const canEdit = !!onSave;
  const columns = Object.keys(snapshot.rowData);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (largeValue) {
          // Drawer first — closing the whole modal out from under it would
          // leave a floating orphan panel.
          setLargeValue(null);
        } else if (rowMenu) {
          setRowMenu(null);
        } else if (editingField) {
          setEditingField(null);
        } else {
          onClose();
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose, editingField, rowMenu, largeValue]);

  // Close the row context menu on any left click
  useEffect(() => {
    if (!rowMenu) return;
    const close = () => setRowMenu(null);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [rowMenu]);

  // Focus input when entering edit mode
  useEffect(() => {
    if (editingField) {
      setTimeout(() => editInputRef.current?.focus(), 50);
    }
  }, [editingField]);

  const startEdit = (col: string) => {
    if (!canEdit) return;
    const rawVal = snapshot.rowData[col];
    setEditingField(col);
    setEditText(rawVal === null || rawVal === undefined ? "" : formatValue(rawVal));
  };

  const handleSave = async () => {
    if (!onSave || !editingField || saving) return;
    setSaving(true);
    try {
      // editText is saved literally — "" stores an empty string, which is a
      // different value from NULL. NULL has its own explicit action.
      await onSave(editingField, editText);
      setEditingField(null);
      onClose();
    } catch {
      // Error already surfaced by the caller; stay in edit mode.
    } finally {
      setSaving(false);
    }
  };

  const handleSetNull = async () => {
    if (!onSave || !editingField || saving) return;
    setSaving(true);
    try {
      await onSave(editingField, null);
      setEditingField(null);
      onClose();
    } catch {
      // Error already surfaced by the caller; stay in edit mode.
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteRow = async () => {
    if (!onDeleteRow || deleting) return;
    const confirmed = await confirmDialog(
      t("confirmDeleteRow"),
      t("deleteRow"),
    );
    if (!confirmed) return;
    setDeleting(true);
    try {
      await onDeleteRow();
      onClose();
    } catch {
      setDeleting(false);
    }
  };

  const copyText = (text: string) => {
    navigator.clipboard
      .writeText(text)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      })
      .catch(() => {});
  };

  const handleCopyRow = () => {
    copyText(
      columns
        .map((col) => `${col}: ${formatValue(snapshot.rowData[col])}`)
        .join("\n"),
    );
  };

  const handleCopyCell = (col: string) => {
    const val = snapshot.rowData[col];
    copyText(isNull(val) ? "NULL" : formatValue(val));
  };

  const handleRowContextMenu = (e: React.MouseEvent, col: string) => {
    e.preventDefault();
    setRowMenu({ x: e.clientX, y: e.clientY, col });
  };

  const isNull = (v: unknown) => v === null || v === undefined;

  // Editing helpers: long/newline values get a tall textarea with Enter kept
  // for newlines; JSON-looking text gets a format button + validity hint.
  const isMultiline = editText.length > 60 || editText.includes("\n");
  const trimmedJson = editText.trim();
  const looksJson = trimmedJson.startsWith("{") || trimmedJson.startsWith("[");
  let parsedJson: unknown = null;
  let jsonInvalid = false;
  if (looksJson) {
    try {
      parsedJson = JSON.parse(trimmedJson);
    } catch {
      jsonInvalid = true;
    }
  }
  const formatJson = () => {
    if (looksJson && !jsonInvalid && parsedJson !== null) {
      setEditText(JSON.stringify(parsedJson, null, 2));
    }
  };

  const show = useDelayedUnmount(open);
  const closing = show && !open;
  if (!show) return null;

  return (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 ${closing ? "animate-overlay-out" : "animate-overlay-in"}`}
    >
      <div
        ref={panelRef}
        className={`w-[750px] max-w-[92vw] max-h-[85vh] bg-card border border-border rounded-lg shadow-2xl overflow-hidden flex flex-col ${closing ? "animate-modal-out" : "animate-modal-in"}`}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-muted shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-sm font-medium">{t("rowData")}</span>
            {title && (
              <span className="text-xs font-mono text-primary bg-primary/10 rounded-md px-1.5 py-0.5">
                {title}
              </span>
            )}
            <span className="text-xs text-muted-foreground">
              {t("columnCount", { count: columns.length })}
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
            const val = snapshot.rowData[col];
            const nullVal = isNull(val);
            const isEditing = editingField === col;
            const isFocused = col === snapshot.columnName;

            return (
              <div
                key={col}
                onContextMenu={(e) => handleRowContextMenu(e, col)}
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
                  title={`${col} — ${t("clickToEdit")}`}
                >
                  {col}
                  {isFocused && !isEditing && (
                    <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-500 shrink-0" />
                  )}
                </button>

                {/* Value */}
                <div className="flex-1 min-w-0 px-3 py-2 flex items-center">
                  {isEditing ? (
                    <div className="flex flex-col gap-1.5 w-full">
                      <textarea
                        ref={editInputRef}
                        value={editText}
                        onChange={(e) => setEditText(e.target.value)}
                        onKeyDown={(e) => {
                          // Single-line edits save on Enter; multiline keeps
                          // Enter for newlines and saves on Ctrl+Enter.
                          if (e.key === "Enter" && (!e.shiftKey && (e.ctrlKey || e.metaKey || !isMultiline))) {
                            e.preventDefault();
                            handleSave();
                          }
                        }}
                        rows={isMultiline ? 6 : 2}
                        className="w-full bg-background text-foreground text-sm font-mono px-2 py-1 rounded-md border border-amber-500/50 outline-none focus:ring-1 focus:ring-amber-500 resize-y"
                      />
                      <div className="flex items-center gap-2 flex-wrap">
                        {looksJson && !jsonInvalid && (
                          <button
                            onClick={formatJson}
                            className="px-2 py-0.5 text-xs rounded-md border border-border text-muted-foreground hover:text-foreground hover:border-muted-foreground/40 transition-colors"
                          >
                            {t("jsonFormat")}
                          </button>
                        )}
                        {jsonInvalid && (
                          <span className="text-xs text-destructive">{t("jsonInvalid")}</span>
                        )}
                        <span className="text-xs text-muted-foreground/70">
                          {isMultiline ? t("multilineHint") : t("singlelineHint")}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={handleSave}
                          disabled={saving}
                          className="px-2 py-1 text-xs font-medium rounded-md bg-amber-500 text-white hover:bg-amber-600 transition-colors disabled:opacity-50 flex items-center gap-1 shrink-0"
                        >
                          {saving && <Loader2 size={11} className="animate-spin" />}
                          {t("save")}
                        </button>
                        <button
                          onClick={handleSetNull}
                          disabled={saving}
                          className="px-2 py-1 text-xs rounded-md border border-border text-muted-foreground hover:text-foreground hover:border-muted-foreground/40 transition-colors disabled:opacity-50 shrink-0"
                        >
                          {t("setNullAction")}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 min-w-0 w-full">
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
                      {(() => {
                        // FK jump button — same pill as the grid cells.
                        const rel = relationships.find((r) => r.childColumn === col);
                        const v = val;
                        if (
                          !rel ||
                          !onFkJump ||
                          v === null ||
                          v === undefined ||
                          v === 0 ||
                          v === "0" ||
                          v === ""
                        ) {
                          return null;
                        }
                        return (
                          <FkJumpButton
                            rel={rel}
                            onClick={(e) => {
                              e.stopPropagation();
                              onFkJump(rel, v);
                            }}
                          />
                        );
                      })()}
                      {!nullVal && formatValue(val).length > 120 && (
                        <button
                          onClick={() => setLargeValue({ col, value: val })}
                          className="shrink-0 text-xs text-primary hover:underline"
                        >
                          {t("viewFullValue")}
                        </button>
                      )}
                    </div>
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
              ? t("editingHint", { field: editingField })
              : canEdit
                ? t("clickValueToEdit")
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
                {t("deleteRow")}
              </button>
            )}
          </div>
        </div>
      </div>

      <LargeValueDrawer
        open={!!largeValue}
        columnName={largeValue?.col}
        tableName={title}
        value={largeValue?.value}
        onClose={() => setLargeValue(null)}
      />

      {/* Right-click context menu on a field row */}
      {rowMenu && (
        <div
          className="fixed z-[60] min-w-[150px] py-1 bg-card border border-border rounded-lg shadow-xl animate-menu-in"
          style={{
            left: Math.min(rowMenu.x, window.innerWidth - 170),
            top: Math.min(rowMenu.y, window.innerHeight - 100),
          }}
        >
          <button
            type="button"
            onClick={() => {
              handleCopyCell(rowMenu.col);
              setRowMenu(null);
            }}
            className="w-full px-3 py-2 text-sm text-foreground hover:bg-accent transition-colors text-left flex items-center gap-2"
          >
            <Copy size={14} className="text-muted-foreground" />
            {t("copyValue")}
          </button>
          <button
            type="button"
            onClick={() => {
              handleCopyRow();
              setRowMenu(null);
            }}
            className="w-full px-3 py-2 text-sm text-foreground hover:bg-accent transition-colors text-left flex items-center gap-2"
          >
            <Rows3 size={14} className="text-muted-foreground" />
            {t("copyRow")}
          </button>
        </div>
      )}
    </div>
  );
}

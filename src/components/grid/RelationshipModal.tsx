import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, ChevronRight, Loader2 } from "lucide-react";
import * as schemaService from "../../services/schemaService";
import * as relationshipService from "../../services/relationshipService";
import { useModalFocus } from "../../lib/useModalFocus";
import { useDelayedUnmount } from "../../lib/useDelayedUnmount";
import { showSuccess, showError } from "../../stores/toastStore";
import { parseTauriError } from "../../lib/error";
import type { Column, Table, TableRelationship } from "../../types";

interface RelationshipModalProps {
  open: boolean;
  connectionId: string | null;
  database?: string;
  childTable?: string;
  childColumn?: string;
  /** Current link on this column (declared/adjudicated/inferred), if any. */
  existing?: TableRelationship | null;
  /** Called after a link is saved or removed so the grid reloads. */
  onChanged?: () => void;
  onClose: () => void;
}

const selectClass =
  "w-full bg-background border border-border rounded-md px-1.5 py-1 text-xs outline-none hover:border-primary/50 focus:border-primary focus:ring-2 focus:ring-primary/30 transition-colors disabled:opacity-50";

/**
 * Manual relationship editor for one column: pick a parent table + column
 * and pin the link (adjudication), remove/veto the current one, or bulk
 * import a bitanswer-style relationship list.
 */
export function RelationshipModal({
  open,
  connectionId,
  database,
  childTable,
  childColumn,
  existing,
  onChanged,
  onClose,
}: RelationshipModalProps) {
  const { t } = useTranslation("query");
  const panelRef = useRef<HTMLDivElement>(null);
  useModalFocus(panelRef, { active: open });
  const show = useDelayedUnmount(open);
  const closing = show && !open;

  const [tables, setTables] = useState<Table[]>([]);
  const [parentTable, setParentTable] = useState("");
  const [columns, setColumns] = useState<Column[]>([]);
  const [parentColumn, setParentColumn] = useState("");
  const [loadingCols, setLoadingCols] = useState(false);
  const [saving, setSaving] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState("");
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<string | null>(null);

  // Reset transient state and preload the table list on (re)open.
  useEffect(() => {
    if (!open) return;
    setParentTable(existing?.parentTable ?? "");
    setParentColumn(existing?.parentColumn ?? "");
    setColumns([]);
    setImportOpen(false);
    setImportText("");
    setImportResult(null);
    if (connectionId && database) {
      schemaService
        .getTables(connectionId, database)
        .then(setTables)
        .catch((err) => showError(parseTauriError(err)));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset on open only
  }, [open]);

  // Parent columns follow the parent table choice.
  useEffect(() => {
    if (!open || !connectionId || !database || !parentTable) {
      setColumns([]);
      return;
    }
    let cancelled = false;
    setLoadingCols(true);
    schemaService
      .getTableDetails(connectionId, database, parentTable)
      .then((d) => {
        if (!cancelled) setColumns(d.columns);
      })
      .catch((err) => showError(parseTauriError(err)))
      .finally(() => {
        if (!cancelled) setLoadingCols(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- follow table choice only
  }, [parentTable]);

  const handleSave = async () => {
    if (!connectionId || !childTable || !childColumn || !parentTable || !parentColumn || saving) return;
    setSaving(true);
    try {
      await relationshipService.adjudicateRelationship(
        connectionId,
        { childTable, childColumn, parentTable, parentColumn },
        true,
      );
      showSuccess(t("relSaved"));
      onChanged?.();
      onClose();
    } catch (err) {
      showError(parseTauriError(err));
    } finally {
      setSaving(false);
    }
  };

  const handleRemove = async () => {
    if (!connectionId || !childTable || !childColumn || saving) return;
    const link = existing ?? { childTable, childColumn, parentTable, parentColumn };
    if (!link.parentTable || !link.parentColumn) return;
    setSaving(true);
    try {
      await relationshipService.adjudicateRelationship(
        connectionId,
        {
          childTable: link.childTable,
          childColumn: link.childColumn,
          parentTable: link.parentTable,
          parentColumn: link.parentColumn,
        },
        false,
      );
      showSuccess(t("relSaved"));
      onChanged?.();
      onClose();
    } catch (err) {
      showError(parseTauriError(err));
    } finally {
      setSaving(false);
    }
  };

  const handleImport = async () => {
    if (!connectionId || !importText.trim() || importing) return;
    setImporting(true);
    setImportResult(null);
    try {
      const r = await relationshipService.importRelationships(connectionId, importText);
      let msg = t("relImportDone", { imported: r.imported, skipped: r.skipped });
      if (r.errors.length > 0) msg += ` · ${t("relImportErrors", { count: r.errors.length })}`;
      setImportResult(msg);
      onChanged?.();
    } catch (err) {
      showError(parseTauriError(err));
    } finally {
      setImporting(false);
    }
  };

  if (!show) return null;

  const canRemove = !!existing || (!!parentTable && !!parentColumn);

  return (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 ${closing ? "animate-overlay-out" : "animate-overlay-in"}`}
    >
      <div
        ref={panelRef}
        className={`w-[440px] max-w-[92vw] bg-card border border-border rounded-lg shadow-2xl ${closing ? "animate-modal-out" : "animate-modal-in"}`}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-muted">
          <span className="text-sm font-medium">{t("relTitle")}</span>
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground transition-colors"
            aria-label={t("close")}
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 6 6 18" />
              <path d="m6 6 12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="p-4 space-y-3">
          <div>
            <div className="text-xs text-muted-foreground mb-1">{t("relChildColumn")}</div>
            <div className="text-xs font-mono bg-muted rounded-md px-2 py-1.5">
              {childTable}.{childColumn}
              {existing && (
                <span className="ml-2 font-sans text-muted-foreground">
                  ({t(`source_${existing.source}`)} · {Math.round(existing.confidence * 100)}%)
                </span>
              )}
            </div>
          </div>

          <div>
            <div className="text-xs text-muted-foreground mb-1">{t("relParentTable")}</div>
            <select
              className={selectClass}
              value={parentTable}
              onChange={(e) => {
                setParentTable(e.target.value);
                setParentColumn("");
              }}
            >
              <option value="">{t("relSelectTable")}</option>
              {tables.map((tb) => (
                <option key={tb.name} value={tb.name}>
                  {tb.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <div className="text-xs text-muted-foreground mb-1">{t("relParentColumn")}</div>
            <select
              className={selectClass}
              value={parentColumn}
              disabled={!parentTable || loadingCols}
              onChange={(e) => setParentColumn(e.target.value)}
            >
              <option value="">
                {loadingCols ? t("relLoadingCols") : t("relSelectColumn")}
              </option>
              {columns.map((c) => (
                <option key={c.name} value={c.name}>
                  {c.name}
                  {c.isPrimaryKey ? "（PK）" : ""}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleSave}
              disabled={!parentTable || !parentColumn || saving}
              className="px-3 py-1.5 text-xs font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50 flex items-center gap-1"
            >
              {saving && <Loader2 size={12} className="animate-spin" />}
              {t("relSave")}
            </button>
            <button
              onClick={handleRemove}
              disabled={!canRemove || saving}
              className="px-3 py-1.5 text-xs font-medium rounded-md border border-border bg-secondary text-secondary-foreground hover:bg-secondary/80 transition-colors disabled:opacity-50"
              title={existing ? t("relRemove") : t("relVetoInfer")}
            >
              {existing ? t("relRemove") : t("relVetoInfer")}
            </button>
          </div>

          {/* Bulk import */}
          <div className="border-t border-border pt-3">
            <button
              type="button"
              onClick={() => setImportOpen((v) => !v)}
              className="text-xs text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1"
            >
              {importOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
              {t("relImport")}
            </button>
            {importOpen && (
              <div className="mt-2 space-y-2">
                <textarea
                  className="w-full h-28 bg-background border border-border rounded-md px-2 py-1.5 text-xs font-mono outline-none hover:border-primary/50 focus:border-primary focus:ring-2 focus:ring-primary/30 transition-colors resize-y"
                  placeholder={t("relImportPlaceholder")}
                  value={importText}
                  onChange={(e) => setImportText(e.target.value)}
                />
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleImport}
                    disabled={!importText.trim() || importing}
                    className="px-3 py-1 text-xs font-medium rounded-md border border-border bg-secondary text-secondary-foreground hover:bg-secondary/80 transition-colors disabled:opacity-50 flex items-center gap-1"
                  >
                    {importing && <Loader2 size={11} className="animate-spin" />}
                    {t("relImportBtn")}
                  </button>
                  {importResult && <span className="text-xs text-muted-foreground">{importResult}</span>}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

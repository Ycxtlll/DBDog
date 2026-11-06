import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, Loader2 } from "lucide-react";
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
  /** Sample values of the child column from the loaded page — powers the
   *  live hit-rate probe (≤50 distinct non-null values). */
  samples?: unknown[];
  /** Called after a link is saved or removed so the grid reloads. */
  onChanged?: () => void;
  onClose: () => void;
}

const selectClass =
  "w-full bg-background border border-border rounded-md px-1.5 py-1 text-xs outline-none hover:border-primary/50 focus:border-primary focus:ring-2 focus:ring-primary/30 transition-colors disabled:opacity-50";

interface ProbeState {
  state: "idle" | "probing" | "done" | "fail";
  rate?: number;
}

/**
 * Manual relationship editor for one column: searchable parent-table picker,
 * auto-selected parent primary key, and a live value-probe badge that tells
 * the user whether the chosen link is real before they save it.
 */
export function RelationshipModal({
  open,
  connectionId,
  database,
  childTable,
  childColumn,
  existing,
  samples,
  onChanged,
  onClose,
}: RelationshipModalProps) {
  const { t } = useTranslation("query");
  const panelRef = useRef<HTMLDivElement>(null);
  useModalFocus(panelRef, { active: open });
  const show = useDelayedUnmount(open);
  const closing = show && !open;

  const [tables, setTables] = useState<Table[]>([]);
  const [tableFilter, setTableFilter] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [parentTable, setParentTable] = useState("");
  const [columns, setColumns] = useState<Column[]>([]);
  const [parentColumn, setParentColumn] = useState("");
  const [loadingCols, setLoadingCols] = useState(false);
  const [saving, setSaving] = useState(false);
  const [probe, setProbe] = useState<ProbeState>({ state: "idle" });

  // Reset transient state and preload the table list on (re)open.
  useEffect(() => {
    if (!open) return;
    setParentTable(existing?.parentTable ?? "");
    setTableFilter(existing?.parentTable ?? "");
    setParentColumn(existing?.parentColumn ?? "");
    setColumns([]);
    setPickerOpen(false);
    setProbe({ state: "idle" });
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

  // Smart default: with a single primary key, pick it — the overwhelmingly
  // common case needs zero clicks on the column dropdown.
  useEffect(() => {
    if (parentColumn || loadingCols || columns.length === 0) return;
    const pks = columns.filter((c) => c.isPrimaryKey);
    if (pks.length === 1) setParentColumn(pks[0].name);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- default only when empty
  }, [columns, loadingCols]);

  // Live probe: whatever the user picked is verified against the sampled
  // child values before they commit to it.
  useEffect(() => {
    if (!open || !connectionId || !database || !parentTable || !parentColumn) {
      setProbe({ state: "idle" });
      return;
    }
    if (!samples || samples.length === 0) {
      setProbe({ state: "idle" });
      return;
    }
    let stale = false;
    setProbe({ state: "probing" });
    const timer = setTimeout(() => {
      relationshipService
        .probeRelationship(connectionId, database, parentTable, parentColumn, samples)
        .then((rate) => {
          if (!stale) setProbe({ state: rate === null ? "fail" : "done", rate: rate ?? undefined });
        })
        .catch(() => {
          if (!stale) setProbe({ state: "fail" });
        });
    }, 350);
    return () => {
      stale = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-probe on pick changes
  }, [parentTable, parentColumn, samples, open]);

  const chooseTable = (name: string) => {
    setParentTable(name);
    setTableFilter(name);
    setParentColumn("");
    setPickerOpen(false);
  };

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

  if (!show) return null;

  const canRemove = !!existing || (!!parentTable && !!parentColumn);
  const needle = tableFilter.trim().toLowerCase();
  const filteredTables = needle
    ? tables.filter((tb) => tb.name.toLowerCase().includes(needle))
    : tables;
  const probeBadge = (() => {
    if (probe.state === "probing") {
      return (
        <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
          <Loader2 size={11} className="animate-spin" />
          {t("relProbing")}
        </span>
      );
    }
    if (probe.state === "idle") return null;
    if (probe.state === "fail") {
      return <span className="text-xs text-muted-foreground">{t("relProbeFail")}</span>;
    }
    const percent = Math.round((probe.rate ?? 0) * 100);
    const matched = Math.round((probe.rate ?? 0) * (samples?.length ?? 0));
    const total = samples?.length ?? 0;
    if (percent >= 80) {
      return (
        <span className="inline-flex items-center gap-1 text-xs text-green-600">
          <Check size={12} />
          {t("relProbeHit", { matched, total, percent })}
        </span>
      );
    }
    if (percent >= 20) {
      return (
        <span className="text-xs text-amber-500">
          {t("relProbePartial", { matched, total, percent })}
        </span>
      );
    }
    return (
      <span className="text-xs text-destructive">
        {t("relProbeMiss", { matched, total, percent })}
      </span>
    );
  })();

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
            <div className="relative">
              <input
                className={selectClass}
                placeholder={t("relSelectTable")}
                value={tableFilter}
                onChange={(e) => {
                  setTableFilter(e.target.value);
                  setPickerOpen(true);
                }}
                onFocus={() => setPickerOpen(true)}
                onBlur={() => setPickerOpen(false)}
              />
              {pickerOpen && (
                <div className="absolute left-0 right-0 top-full mt-1 max-h-52 overflow-y-auto bg-card border border-border rounded-md shadow-xl z-10">
                  {filteredTables.length === 0 && (
                    <div className="px-2 py-2 text-xs text-muted-foreground">{t("relNoTables")}</div>
                  )}
                  {filteredTables.map((tb) => (
                    <div
                      key={tb.name}
                      onMouseDown={(e) => {
                        e.preventDefault(); // beat the input blur
                        chooseTable(tb.name);
                      }}
                      className={`px-2 py-1.5 text-xs font-mono cursor-pointer hover:bg-accent transition-colors ${
                        tb.name === parentTable ? "text-primary" : "text-foreground"
                      }`}
                    >
                      {tb.name}
                    </div>
                  ))}
                </div>
              )}
            </div>
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

          {/* Live value validation */}
          <div className="min-h-[20px] flex items-center">{probeBadge}</div>

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
        </div>
      </div>
    </div>
  );
}

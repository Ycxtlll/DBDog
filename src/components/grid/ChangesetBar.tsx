import { useTranslation } from "react-i18next";
import { Loader2, X } from "lucide-react";
import type { QueryTab } from "../../types";
import { useQueryStore } from "../../stores/queryStore";

interface ChangesetBarProps {
  tab: QueryTab;
  applyingChanges: boolean;
  changesetOpen: boolean;
  onApply: () => void;
  onDiscard: () => void;
  onUndo: () => void;
  setChangesetOpen: (open: boolean) => void;
}

/**
 * Changeset bar (M4): staged modifications apply as one transaction. Shows
 * the pending count, apply/discard, and Ctrl+Z undo of the last applied
 * batch. Renders nothing while there is nothing staged or undoable.
 */
export function ChangesetBar({
  tab,
  applyingChanges,
  changesetOpen,
  onApply,
  onDiscard,
  onUndo,
  setChangesetOpen,
}: ChangesetBarProps) {
  const { t } = useTranslation("query");
  const pendingCount = tab.pendingChanges?.length ?? 0;
  const hasRollbacks = !!tab.lastAppliedRollbacks?.length;
  if (pendingCount === 0 && !hasRollbacks) return null;

  return (
    <div className="flex items-center justify-between gap-2 px-3 py-1 text-xs border-t border-border bg-muted">
      <span className="text-amber-600 dark:text-amber-400 font-medium flex items-center gap-1">
        <Loader2 size={11} className={applyingChanges ? "animate-spin" : "hidden"} />
        {pendingCount > 0 && t("changesetBar", { count: pendingCount })}
      </span>
      <div className="flex items-center gap-2">
        {pendingCount > 0 && (
          <>
            <button onClick={() => setChangesetOpen(true)} className="text-primary hover:underline">
              {t("changesetView")}
            </button>
            <button
              onClick={onApply}
              disabled={applyingChanges || tab.isExecuting}
              className="px-2 py-0.5 font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50 flex items-center gap-1"
            >
              {t("changesetApply")}
            </button>
            <button
              onClick={onDiscard}
              className="text-muted-foreground hover:text-foreground"
            >
              {t("changesetDiscard")}
            </button>
          </>
        )}
        {hasRollbacks && (
          <button
            onClick={onUndo}
            disabled={applyingChanges || tab.isExecuting}
            className="text-muted-foreground hover:text-foreground disabled:opacity-50"
            title="Ctrl+Z"
          >
            {t("undoLast")}
          </button>
        )}
      </div>
      {changesetOpen && (
        <ChangesetReviewPanel
          tab={tab}
          applyingChanges={applyingChanges}
          onApply={onApply}
          onClose={() => setChangesetOpen(false)}
        />
      )}
    </div>
  );
}

/** Changeset review panel: every staged statement, then one-transaction apply. */
function ChangesetReviewPanel({
  tab,
  applyingChanges,
  onApply,
  onClose,
}: {
  tab: QueryTab;
  applyingChanges: boolean;
  onApply: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation("query");
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 animate-overlay-in">
      <div className="w-[680px] max-w-[94vw] max-h-[80vh] bg-card border border-border rounded-lg shadow-2xl flex flex-col animate-modal-in">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-muted shrink-0">
          <span className="text-sm font-medium">
            {t("changesetTitle")} · {t("changesetBar", { count: tab.pendingChanges?.length ?? 0 })}
          </span>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground" aria-label={t("close")}>
            <X size={16} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          {(tab.pendingChanges ?? []).map((c, i) => (
            <div key={c.id} className="border border-border rounded-md p-2">
              <div className="flex items-center justify-between mb-1">
                <span className={`text-xs font-medium ${c.kind === "delete" ? "text-destructive" : "text-amber-600 dark:text-amber-400"}`}>
                  {i + 1}. {c.kind.toUpperCase()} · {c.table}
                </span>
                <button
                  onClick={() => useQueryStore.getState().removePendingChange(tab.id, c.id)}
                  className="p-0.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                  aria-label={t("changesetRemove")}
                >
                  <X size={12} />
                </button>
              </div>
              <pre className="text-xs font-mono whitespace-pre-wrap break-all text-foreground/90 bg-muted rounded-md px-2 py-1.5">{c.sql}</pre>
            </div>
          ))}
          {(tab.pendingChanges?.length ?? 0) === 0 && (
            <div className="text-xs text-muted-foreground px-1 py-2">{t("empty")}</div>
          )}
        </div>
        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-border bg-muted shrink-0">
          <button
            onClick={onApply}
            disabled={applyingChanges || (tab.pendingChanges?.length ?? 0) === 0}
            className="px-3 py-1.5 text-xs font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50 flex items-center gap-1"
          >
            {applyingChanges && <Loader2 size={12} className="animate-spin" />}
            {t("changesetApply")}
          </button>
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

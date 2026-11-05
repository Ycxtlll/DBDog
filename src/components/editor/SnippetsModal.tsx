import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { X, Plus, Trash2, ClipboardCopy, Copy, Check } from "lucide-react";
import { useSnippetsStore } from "../../stores/snippetsStore";
import { useQueryStore } from "../../stores/queryStore";
import { showSuccess } from "../../stores/toastStore";
import { useDelayedUnmount } from "../../lib/useDelayedUnmount";
import type { Snippet } from "../../types";

interface SnippetsModalProps {
  open: boolean;
  onClose: () => void;
}

/** Extract the unique {{param}} tokens of a snippet. */
function extractParams(sql: string): string[] {
  const seen = new Set<string>();
  for (const m of sql.matchAll(/\{\{(\w+)\}\}/g)) seen.add(m[1]!);
  return [...seen];
}

function fillParams(sql: string, values: Record<string, string>): string {
  return sql.replace(/\{\{(\w+)\}\}/g, (_, name: string) => values[name] ?? "");
}

export function SnippetsModal({ open, onClose }: SnippetsModalProps) {
  const { t } = useTranslation("editor");
  const { snippets, add, remove } = useSnippetsStore();
  const activeSql =
    useQueryStore((s) => s.tabs.find((tb) => tb.id === s.activeTabId)?.sql) ?? "";
  const panelRef = useRef<HTMLDivElement>(null);
  const show = useDelayedUnmount(open);

  const [name, setName] = useState("");
  const [paramValues, setParamValues] = useState<Record<string, Record<string, string>>>({});
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Reset transient state whenever the modal opens.
  useEffect(() => {
    if (open) {
      setName("");
      setParamValues({});
      setCopiedId(null);
    }
  }, [open]);

  if (!show) return null;
  const closing = show && !open;

  const appendToActiveTab = (sql: string) => {
    const store = useQueryStore.getState();
    const tab = store.tabs.find((tb) => tb.id === store.activeTabId) ?? null;
    if (!tab) {
      const newId = store.newTab();
      store.setTabSql(newId, sql);
      return;
    }
    store.setTabSql(tab.id, tab.sql.trim() ? `${tab.sql.trimEnd()}\n\n${sql}` : sql);
  };

  const handleInsert = (snippet: Snippet) => {
    const params = extractParams(snippet.sql);
    const finalSql =
      params.length > 0
        ? fillParams(snippet.sql, paramValues[snippet.id] ?? {})
        : snippet.sql;
    appendToActiveTab(finalSql);
    showSuccess(t("snippetInserted", { name: snippet.name }));
  };

  const handleSaveCurrent = () => {
    const sql = activeSql.trim();
    if (!sql) return;
    add(name.trim() || sql.split("\n")[0].slice(0, 30), sql);
    setName("");
    showSuccess(t("snippetSaved"));
  };

  const handleCopy = async (snippet: Snippet) => {
    try {
      await navigator.clipboard.writeText(snippet.sql);
      setCopiedId(snippet.id);
      setTimeout(() => setCopiedId((id) => (id === snippet.id ? null : id)), 1500);
    } catch {
      /* clipboard unavailable */
    }
  };

  return (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 ${closing ? "animate-overlay-out" : "animate-overlay-in"}`}
    >
      <div
        ref={panelRef}
        className={`w-[600px] max-w-[92vw] max-h-[80vh] bg-card border border-border rounded-lg shadow-2xl overflow-hidden flex flex-col ${closing ? "animate-modal-out" : "animate-modal-in"}`}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border bg-muted">
          <h3 className="text-base font-semibold text-foreground">{t("snippetsTitle")}</h3>
          <button
            onClick={onClose}
            className="p-1 rounded-md hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
            aria-label={t("close")}
          >
            <X size={18} />
          </button>
        </div>

        {/* Save current SQL */}
        <div className="px-5 py-3 border-b border-border">
          <div className="flex gap-2">
            <input
              className="flex-1 bg-background border border-border rounded-md px-2 py-1.5 text-xs outline-none hover:border-primary/50 focus:border-primary focus:ring-2 focus:ring-primary/30 transition-colors"
              placeholder={t("snippetNamePlaceholder")}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <button
              className="flex items-center gap-1 px-3 py-1.5 text-xs bg-primary text-primary-foreground hover:bg-primary/90 rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              onClick={handleSaveCurrent}
              disabled={!activeSql.trim()}
            >
              <Plus size={12} />
              {t("saveCurrentSql")}
            </button>
          </div>
          <div className="text-xs text-muted-foreground mt-1">{t("paramHint")}</div>
        </div>

        {/* Snippet list */}
        <div className="flex-1 min-h-0 overflow-auto">
          {snippets.length === 0 && (
            <div className="px-5 py-6 text-xs text-muted-foreground text-center">
              {t("noSnippets")}
            </div>
          )}
          {snippets.map((snippet) => {
            const params = extractParams(snippet.sql);
            const values = paramValues[snippet.id] ?? {};
            return (
              <div key={snippet.id} className="px-5 py-2.5 border-b border-border/50">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium truncate flex-1">{snippet.name}</span>
                  <button
                    className="p-1 rounded-md hover:bg-accent text-muted-foreground"
                    title={t("copy")}
                    onClick={() => void handleCopy(snippet)}
                  >
                    {copiedId === snippet.id ? <Check size={13} className="text-green-500" /> : <ClipboardCopy size={13} />}
                  </button>
                  <button
                    className="p-1 rounded-md hover:bg-accent text-muted-foreground hover:text-destructive"
                    title={t("delete")}
                    onClick={() => {
                      remove(snippet.id);
                      showSuccess(t("snippetDeleted"));
                    }}
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
                <pre className="text-xs font-mono text-muted-foreground mt-1 max-h-[60px] overflow-hidden whitespace-pre-wrap break-all">
                  {snippet.sql}
                </pre>
                {params.length > 0 && (
                  <div className="flex flex-wrap items-center gap-2 mt-1.5">
                    {params.map((p) => (
                      <label key={p} className="flex items-center gap-1 text-xs">
                        <span className="font-mono text-primary">{p}</span>
                        <input
                          className="w-[120px] bg-background border border-border rounded-md px-1.5 py-0.5 outline-none hover:border-primary/50 focus:border-primary focus:ring-2 focus:ring-primary/30 transition-colors"
                          value={values[p] ?? ""}
                          onChange={(e) =>
                            setParamValues((prev) => ({
                              ...prev,
                              [snippet.id]: { ...(prev[snippet.id] ?? {}), [p]: e.target.value },
                            }))
                          }
                        />
                      </label>
                    ))}
                    <button
                      className="flex items-center gap-1 px-2 py-1 text-xs bg-primary text-primary-foreground hover:bg-primary/90 rounded-md transition-colors"
                      onClick={() => handleInsert(snippet)}
                    >
                      <Copy size={11} />
                      {t("insert")}
                    </button>
                  </div>
                )}
                {params.length === 0 && (
                  <button
                    className="mt-1.5 px-2 py-1 text-xs border border-border hover:bg-accent rounded-md transition-colors"
                    onClick={() => handleInsert(snippet)}
                  >
                    {t("insert")}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

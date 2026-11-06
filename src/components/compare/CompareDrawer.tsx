import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { X, Copy, Check, ChevronDown, ChevronRight, FileOutput } from "lucide-react";
import { useLayoutStore } from "../../stores/layoutStore";
import { useConnectionStore } from "../../stores/connectionStore";
import { useQueryStore } from "../../stores/queryStore";
import * as compareService from "../../services/compareService";
import * as schemaService from "../../services/schemaService";
import { buildAlterStatements } from "../../lib/sql";
import { parseTauriError } from "../../lib/error";
import { showSuccess, showError } from "../../stores/toastStore";
import type { CompareColumnDiff, CompareTableDiff, StructureDiffReport } from "../../types";
import { SkeletonLines } from "../ui/Skeleton";

interface Side {
  connId: string;
  db: string;
}

export function CompareDrawer({ connectionId }: { connectionId: string | null }) {
  const { t } = useTranslation("compare");
  const { drawer, closeDrawer } = useLayoutStore();
  const open = drawer.type === "compare";
  const configs = useConnectionStore((s) => s.configs);
  const mysqlConfigs = configs.filter((c) => c.type === "mysql");

  const [source, setSource] = useState<Side>({ connId: "", db: "" });
  const [target, setTarget] = useState<Side>({ connId: "", db: "" });
  const [dbOptions, setDbOptions] = useState<Record<string, string[]>>({});
  const [dbLoadError, setDbLoadError] = useState<Record<string, boolean>>({});
  const [report, setReport] = useState<StructureDiffReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  // Default the source side to the active connection once.
  useEffect(() => {
    if (!open || source.connId) return;
    const fallback =
      (connectionId && configs.find((c) => c.id === connectionId && c.type === "mysql")?.id) ||
      mysqlConfigs[0]?.id ||
      "";
    if (fallback) setSource((s) => ({ ...s, connId: fallback }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, connectionId]);

  // Load the database list whenever either side's connection changes. The
  // schema API needs a live pool — connect silently first when the side was
  // never connected (e.g. a pure comparison target); failures surface as a
  // hint on the dropdown instead of a silently empty list.
  useEffect(() => {
    for (const connId of [source.connId, target.connId]) {
      if (!connId || dbOptions[connId] !== undefined) continue;
      const key = connId;
      (async () => {
        try {
          const status = useConnectionStore.getState().statusMap[key];
          if (status !== "connected") {
            await useConnectionStore.getState().connect(key);
          }
          const dbs = await schemaService.getDatabases(key);
          setDbOptions((prev) => ({ ...prev, [key]: dbs.map((d) => d.name) }));
          setDbLoadError((prev) => ({ ...prev, [key]: false }));
        } catch {
          setDbOptions((prev) => ({ ...prev, [key]: [] }));
          setDbLoadError((prev) => ({ ...prev, [key]: true }));
        }
      })();
    }
  }, [source.connId, target.connId, dbOptions]);

  const runCompare = useCallback(async () => {
    if (!source.connId || !source.db || !target.connId || !target.db) return;
    setError(null);
    setLoading(true);
    setReport(null);
    setExpanded(new Set());
    try {
      setReport(
        await compareService.compareTableStructure(
          source.connId,
          source.db,
          target.connId,
          target.db,
        ),
      );
    } catch (err) {
      showError(parseTauriError(err));
    } finally {
      setLoading(false);
    }
  }, [source, target]);

  const copyText = async (key: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      setTimeout(() => setCopiedKey((k) => (k === key ? null : k)), 1500);
    } catch {
      showError(t("copyFailed"));
    }
  };

  const loadIntoEditor = (sqls: string[]) => {
    const store = useQueryStore.getState();
    const tab = store.tabs.find((t2) => t2.id === store.activeTabId);
    if (tab) {
      store.setTabSql(tab.id, sqls.join("\n\n"));
      showSuccess(t("loadedIntoEditor"));
    }
  };

  if (!open) return null;

  const selectClass =
    "w-full bg-background border border-border rounded-md px-1.5 py-1 text-xs outline-none hover:border-primary/50 focus:border-primary focus:ring-2 focus:ring-primary/30 transition-colors";
  const headCell = "text-left text-xs text-muted-foreground font-medium px-2 py-1 border-b border-border select-none";
  const cell = "px-2 py-1 text-xs border-b border-border/50 align-top";

  const renderSideSelect = (
    label: string,
    side: Side,
    onChange: (s: Side) => void,
  ) => (
    <div className="flex-1 min-w-0">
      <div className="text-xs text-muted-foreground mb-1">{label}</div>
      <div className="flex flex-col gap-1">
        <select
          className={selectClass}
          value={side.connId}
          onChange={(e) => onChange({ connId: e.target.value, db: "" })}
        >
          <option value="">{t("selectConnection")}</option>
          {mysqlConfigs.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <select
          className={selectClass}
          value={side.db}
          disabled={!side.connId}
          onChange={(e) => onChange({ ...side, db: e.target.value })}
        >
          <option value="">
            {side.connId && dbLoadError[side.connId] ? t("databaseLoadFailed") : t("selectDatabase")}
          </option>
          {(dbOptions[side.connId] ?? []).map((db) => (
            <option key={db} value={db}>
              {db}
            </option>
          ))}
        </select>
      </div>
    </div>
  );

  const renderColumnDiff = (c: CompareColumnDiff) => {
    const color =
      c.kind === "added" ? "text-green-600" : c.kind === "removed" ? "text-red-500" : "text-primary";
    return (
      <tr key={c.name}>
        <td className={`${cell} font-mono`}>{c.name}</td>
        <td className={`${cell} ${color}`}>{t(`kind${c.kind[0]!.toUpperCase()}${c.kind.slice(1)}`)}</td>
        <td className={`${cell} font-mono`}>{c.sourceType ?? "—"}</td>
        <td className={`${cell} font-mono`}>{c.targetType ?? "—"}</td>
      </tr>
    );
  };

  const renderChangedTable = (diff: CompareTableDiff) => {
    const isOpen = expanded.has(diff.table);
    const alters = buildAlterStatements(report?.targetDatabase ?? "", diff);
    const copyKey = `table:${diff.table}`;
    return (
      <div key={diff.table} className="border-b border-border/50">
        <button
          className="w-full flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-accent/50 text-left"
          onClick={() =>
            setExpanded((prev) => {
              const next = new Set(prev);
              if (next.has(diff.table)) next.delete(diff.table);
              else next.add(diff.table);
              return next;
            })
          }
        >
          {isOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          <span className="font-mono font-medium">{diff.table}</span>
          <span className="text-muted-foreground">
            {diff.sourceRows ?? "?"} → {diff.targetRows ?? "?"} {t("rows")}
          </span>
          <span className="text-muted-foreground ml-auto">
            {diff.columnDiffs.length + diff.indexDiffs.length} {t("changes")}
          </span>
        </button>
        {isOpen && (
          <div className="px-3 pb-2">
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  <th className={headCell}>{t("colColumn")}</th>
                  <th className={headCell}>{t("colChange")}</th>
                  <th className={headCell}>{t("colSource")}</th>
                  <th className={headCell}>{t("colTarget")}</th>
                </tr>
              </thead>
              <tbody>{diff.columnDiffs.map(renderColumnDiff)}</tbody>
            </table>
            {diff.indexDiffs.length > 0 && (
              <div className="mt-1 text-xs">
                <div className="text-muted-foreground mb-0.5">{t("indexes")}</div>
                {diff.indexDiffs.map((ix) => (
                  <div key={ix.name} className="font-mono truncate" title={`${ix.sourceColumns.join(",")} → ${ix.targetColumns.join(",")}`}>
                    <span
                      className={
                        ix.kind === "added"
                          ? "text-green-600"
                          : ix.kind === "removed"
                            ? "text-red-500"
                            : "text-primary"
                      }
                    >
                      {t(`kind${ix.kind[0]!.toUpperCase()}${ix.kind.slice(1)}`)}
                    </span>{" "}
                    {ix.name} [{ix.sourceColumns.join(", ") || ix.targetColumns.join(", ")}]
                  </div>
                ))}
              </div>
            )}
            {alters.length > 0 && (
              <div className="mt-2">
                <div className="flex items-center justify-between mb-0.5">
                  <span className="text-xs text-muted-foreground">{t("alterHint")}</span>
                  <div className="flex items-center gap-1">
                    <button
                      className="flex items-center gap-1 text-xs text-primary hover:underline"
                      onClick={() => void copyText(copyKey, alters.join("\n"))}
                    >
                      {copiedKey === copyKey ? <Check size={12} /> : <Copy size={12} />}
                      {copiedKey === copyKey ? t("copied") : t("copy")}
                    </button>
                    <button
                      className="flex items-center gap-1 text-xs text-primary hover:underline"
                      onClick={() => loadIntoEditor(alters)}
                    >
                      <FileOutput size={12} />
                      {t("loadIntoEditor")}
                    </button>
                  </div>
                </div>
                <pre className="text-xs font-mono bg-muted rounded-md p-2 overflow-auto max-h-[160px] whitespace-pre-wrap break-words">
                  {alters.join("\n")}
                </pre>
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="absolute right-0 top-0 bottom-6 w-[520px] bg-card border-l border-border shadow-xl z-40 flex flex-col">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border">
        <div className="font-semibold text-sm">{t("title")}</div>
        <button className="p-1 rounded-md hover:bg-accent" onClick={closeDrawer}>
          <X size={14} className="text-muted-foreground" />
        </button>
      </div>

      <div className="px-3 py-2 border-b border-border">
        <div className="flex items-end gap-2">
          {renderSideSelect(t("source"), source, setSource)}
          {renderSideSelect(t("target"), target, setTarget)}
        </div>
        <button
          className="mt-2 w-full py-1 text-xs bg-primary text-primary-foreground hover:bg-primary/90 rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          disabled={
            loading ||
            !source.connId ||
            !source.db ||
            !target.connId ||
            !target.db
          }
          onClick={() => void runCompare()}
        >
          {t("compare")}
        </button>
      </div>

      {error && (
        <div className="px-3 py-2 text-xs text-destructive bg-destructive/10 border-b border-border">
          {error}
        </div>
      )}

      <div className="flex-1 overflow-auto">
        {loading && (
          <div className="p-3">
            <SkeletonLines lines={8} />
          </div>
        )}
        {!loading && !report && (
          <div className="p-3 text-xs text-muted-foreground">{t("hint")}</div>
        )}
        {!loading && report && (
          <div>
            <div className="px-3 py-1.5 text-xs border-b border-border bg-muted flex flex-wrap gap-x-3 gap-y-0.5">
              <span className="text-green-600">{t("identicalCount", { count: report.identicalTables.length })}</span>
              <span className="text-primary">
                {t("changedCount", { count: report.changedTables.length })}
              </span>
              <span className="text-muted-foreground">
                {t("onlyInSourceCount", { count: report.tablesOnlyInSource.length })}
              </span>
              <span className="text-muted-foreground">
                {t("onlyInTargetCount", { count: report.tablesOnlyInTarget.length })}
              </span>
            </div>

            {report.tablesOnlyInSource.length > 0 && (
              <div className="px-3 py-2 border-b border-border/50">
                <div className="text-xs text-muted-foreground mb-1">{t("onlyInSource")}</div>
                <div className="flex flex-wrap gap-1">
                  {report.tablesOnlyInSource.map((name) => (
                    <span key={name} className="text-xs font-mono px-1.5 py-0.5 rounded-full bg-muted">
                      {name}
                    </span>
                  ))}
                </div>
              </div>
            )}
            {report.tablesOnlyInTarget.length > 0 && (
              <div className="px-3 py-2 border-b border-border/50">
                <div className="text-xs text-muted-foreground mb-1">{t("onlyInTarget")}</div>
                <div className="flex flex-wrap gap-1">
                  {report.tablesOnlyInTarget.map((name) => (
                    <span key={name} className="text-xs font-mono px-1.5 py-0.5 rounded-full bg-muted">
                      {name}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {report.changedTables.map(renderChangedTable)}
          </div>
        )}
      </div>
    </div>
  );
}

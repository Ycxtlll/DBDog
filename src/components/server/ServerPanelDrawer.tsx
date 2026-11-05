import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { RefreshCw, X, Ban } from "lucide-react";
import { useLayoutStore } from "../../stores/layoutStore";
import * as serverService from "../../services/serverService";
import { parseTauriError } from "../../lib/error";
import { confirmDialog } from "../../lib/confirm";
import type { ProcessRow, ServerVariable } from "../../types";
import { SkeletonTable } from "../ui/Skeleton";

interface ServerPanelDrawerProps {
  connectionId: string | null;
}

type PanelTab = "processes" | "variables" | "status";

export function ServerPanelDrawer({ connectionId }: ServerPanelDrawerProps) {
  const { t } = useTranslation("server");
  const { drawer, closeDrawer } = useLayoutStore();
  const open = drawer.type === "serverPanel";

  const [tab, setTab] = useState<PanelTab>("processes");
  const [processes, setProcesses] = useState<ProcessRow[]>([]);
  const [variables, setVariables] = useState<ServerVariable[]>([]);
  const [status, setStatus] = useState<ServerVariable[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");

  const load = useCallback(async () => {
    if (!connectionId) return;
    setError(null);
    setLoading(true);
    try {
      if (tab === "processes") {
        setProcesses(await serverService.getProcesslist(connectionId));
      } else if (tab === "variables") {
        setVariables(await serverService.getServerVariables(connectionId));
      } else {
        setStatus(await serverService.getServerStatus(connectionId));
      }
    } catch (err) {
      setError(parseTauriError(err));
    } finally {
      setLoading(false);
    }
  }, [connectionId, tab]);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  if (!open) return null;

  const handleKill = async (row: ProcessRow) => {
    if (!connectionId) return;
    const ok = await confirmDialog(
      t("killConfirm", { id: row.id, user: row.user, host: row.host }),
      t("kill"),
    );
    if (!ok) return;
    try {
      await serverService.killProcess(connectionId, row.id);
      void load();
    } catch (err) {
      setError(parseTauriError(err));
    }
  };

  const needle = filter.trim().toLowerCase();
  const filteredKv = (rows: ServerVariable[]) =>
    needle
      ? rows.filter((r) => r.name.toLowerCase().includes(needle) || (r.value ?? "").toLowerCase().includes(needle))
      : rows;
  const filteredProcesses = needle
    ? processes.filter((p) =>
        [p.user, p.host, p.db, p.command, p.state, p.info]
          .filter(Boolean)
          .some((v) => String(v).toLowerCase().includes(needle)),
      )
    : processes;

  const tableHead = "text-left text-xs text-muted-foreground font-medium px-2 py-1.5 border-b border-border select-none";
  const tableCell = "px-2 py-1 text-xs border-b border-border/50 align-top";

  return (
    <div className="absolute right-0 top-0 bottom-6 w-[440px] bg-card border-l border-border shadow-xl z-40 flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border">
        <div className="font-semibold text-sm">{t("title")}</div>
        <div className="flex items-center gap-1">
          <button
            className="p-1 rounded-md hover:bg-accent"
            title={t("refresh")}
            onClick={() => void load()}
            disabled={loading}
          >
            <RefreshCw size={14} className={loading ? "animate-spin text-muted-foreground" : "text-muted-foreground"} />
          </button>
          <button className="p-1 rounded-md hover:bg-accent" onClick={closeDrawer}>
            <X size={14} className="text-muted-foreground" />
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-border">
        {(["processes", "variables", "status"] as PanelTab[]).map((key) => (
          <button
            key={key}
            className={`px-3 py-1.5 text-xs border-b-2 -mb-px transition-colors ${
              tab === key
                ? "border-primary text-foreground font-medium"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
            onClick={() => {
              setTab(key);
              setFilter("");
            }}
          >
            {t(`tab${key[0]!.toUpperCase()}${key.slice(1)}`)}
          </button>
        ))}
      </div>

      {/* Filter */}
      <div className="px-3 py-1.5 border-b border-border">
        <input
          className="w-full bg-background border border-border rounded-md px-1.5 py-1 text-xs outline-none hover:border-primary/50 focus:border-primary focus:ring-2 focus:ring-primary/30 transition-colors"
          placeholder={t("filterPlaceholder")}
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
      </div>

      {error && (
        <div className="px-3 py-2 text-xs text-destructive bg-destructive/10 border-b border-border">
          {error}
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-auto">
        {loading ? (
          <SkeletonTable rows={8} cols={4} />
        ) : tab === "processes" ? (
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <th className={tableHead}>{t("colId")}</th>
                <th className={tableHead}>{t("colUser")}</th>
                <th className={tableHead}>{t("colHost")}</th>
                <th className={tableHead}>{t("colCommand")}</th>
                <th className={tableHead}>{t("colTime")}</th>
                <th className={`${tableHead} w-8`}></th>
              </tr>
            </thead>
            <tbody>
              {filteredProcesses.map((p) => (
                <tr
                  key={p.id}
                  className="hover:bg-accent/50"
                  title={`${t("colDb")}: ${p.db ?? "-"}\n${t("colState")}: ${p.state ?? "-"}\n${t("colInfo")}: ${p.info ?? "-"}`}
                >
                  <td className={`${tableCell} tabular-nums`}>{p.id}</td>
                  <td className={tableCell}>{p.user}</td>
                  <td className={`${tableCell} max-w-[110px] truncate`}>{p.host}</td>
                  <td className={tableCell}>{p.command}</td>
                  <td className={`${tableCell} tabular-nums`}>{p.timeSecs}s</td>
                  <td className={tableCell}>
                    <button
                      className="p-0.5 rounded-md hover:bg-accent text-muted-foreground hover:text-destructive"
                      title={t("kill")}
                      onClick={() => void handleKill(p)}
                    >
                      <Ban size={12} />
                    </button>
                  </td>
                </tr>
              ))}
              {filteredProcesses.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-2 py-3 text-xs text-muted-foreground text-center">
                    {t("empty")}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        ) : (
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <th className={tableHead}>{t("colName")}</th>
                <th className={tableHead}>{t("colValue")}</th>
              </tr>
            </thead>
            <tbody>
              {filteredKv(tab === "variables" ? variables : status).map((v) => (
                <tr key={v.name} className="hover:bg-accent/50">
                  <td className={`${tableCell} font-mono whitespace-nowrap`}>{v.name}</td>
                  <td className={`${tableCell} font-mono break-all`}>{v.value ?? "NULL"}</td>
                </tr>
              ))}
              {filteredKv(tab === "variables" ? variables : status).length === 0 && (
                <tr>
                  <td colSpan={2} className="px-2 py-3 text-xs text-muted-foreground text-center">
                    {t("empty")}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

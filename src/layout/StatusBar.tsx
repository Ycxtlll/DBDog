import { useState, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { CircleHelp, Settings } from "lucide-react";
import { useConnectionStore } from "../stores/connectionStore";
import { useQueryStore } from "../stores/queryStore";
import { SettingsModal } from "../components/settings/SettingsModal";
import { HelpModal } from "../components/help/HelpModal";

const TYPE_LABEL: Record<string, string> = {
  mysql: "MySQL",
  memcached: "Memcached",
  zookeeper: "ZooKeeper",
};

export function StatusBar() {
  const { t } = useTranslation("query");
  const [showSettings, setShowSettings] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const activeId = useConnectionStore((s) => s.activeId);
  const configs = useConnectionStore((s) => s.configs);
  const serverInfoMap = useConnectionStore((s) => s.serverInfoMap);
  const statusMap = useConnectionStore((s) => s.statusMap);
  const activeTab = useQueryStore((s) =>
    s.tabs.find((t) => t.id === s.activeTabId),
  );
  const serverInfo = activeId ? serverInfoMap[activeId] : null;
  const status = activeId ? statusMap[activeId] : null;

  const typeLabel = useMemo(() => {
    if (!activeId) return "";
    const config = configs.find((c) => c.id === activeId);
    return config ? (TYPE_LABEL[config.type] ?? config.type) : "";
  }, [activeId, configs]);

  const serverLabel = useMemo(() => {
    if (!activeId) return "";
    const config = configs.find((c) => c.id === activeId);
    return config ? `${typeLabel} · ${config.name}` : "";
  }, [activeId, configs, typeLabel]);

  return (
    <>
      <div className="h-6 flex items-center px-3 text-xs border-t border-border bg-muted text-muted-foreground select-none gap-3">
      {serverInfo && status === "connected" ? (
        <>
          <span className="flex items-center gap-1.5">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-60 animate-ping" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
            </span>
            <span className="font-medium text-foreground/80">{serverLabel}</span>
          </span>
          {serverInfo.version && (
            <span className="px-1.5 py-0.5 rounded-md border border-border bg-background/60">
              {serverInfo.version}
            </span>
          )}
          <span className="hidden md:inline">{serverInfo.connectionId}</span>
        </>
      ) : (
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-muted-foreground/40" />
          {t("disconnected")}
        </span>
      )}
      {activeTab?.result && (
        <>
          <span>
            {activeTab.isQueryResult
              ? `${activeTab.tableBrowse?.totalRows ?? (activeTab.result as { totalCount: number }).totalCount ?? 0} ${t("rows")}`
              : `${(activeTab.result as { rowsAffected: number }).rowsAffected ?? 0} ${t("rowsAffected")}`}
          </span>
          <span>{activeTab.result.elapsedMs}ms</span>
        </>
      )}
      {activeTab?.isExecuting && (
        <span className="text-primary animate-pulse">{t("executing")}</span>
      )}
      {activeTab?.isCancelled && (
        <span className="text-yellow-500">{t("cancelled")}</span>
      )}
      {activeTab?.error && (
        <span className="text-destructive flex items-center gap-1">
          <span className="w-1.5 h-1.5 rounded-full bg-destructive" />
          {t("error")}
        </span>
      )}
        <div className="flex-1" />
        <button
          className="p-0.5 rounded-md hover:bg-accent hover:text-foreground transition-colors"
          onClick={() => setShowHelp(true)}
          title={t("help:title", { ns: "help" })}
        >
          <CircleHelp size={14} />
        </button>
        <button
          className="p-0.5 rounded-md hover:bg-accent hover:text-foreground transition-colors"
          onClick={() => setShowSettings(true)}
          title={t("settings:settings", { ns: "settings" })}
        >
          <Settings size={14} />
        </button>
      </div>
      <HelpModal isOpen={showHelp} onClose={() => setShowHelp(false)} />
      <SettingsModal isOpen={showSettings} onClose={() => setShowSettings(false)} />
    </>
  );
}

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Settings } from "lucide-react";
import { useConnectionStore } from "../stores/connectionStore";
import { useQueryStore } from "../stores/queryStore";
import { SettingsModal } from "../components/settings/SettingsModal";

export function StatusBar() {
  const { t } = useTranslation("query");
  const [showSettings, setShowSettings] = useState(false);
  const activeId = useConnectionStore((s) => s.activeId);
  const serverInfoMap = useConnectionStore((s) => s.serverInfoMap);
  const statusMap = useConnectionStore((s) => s.statusMap);
  const activeTab = useQueryStore((s) =>
    s.tabs.find((t) => t.id === s.activeTabId),
  );
  const serverInfo = activeId ? serverInfoMap[activeId] : null;
  const status = activeId ? statusMap[activeId] : null;

  return (
    <>
      <div className="h-6 flex items-center px-3 text-xs border-t border-border bg-muted text-muted-foreground select-none gap-4">
      {serverInfo && status === "connected" ? (
        <>
          <span>MySQL {serverInfo.version}</span>
          <span>{serverInfo.connectionId}</span>
        </>
      ) : (
        <span>{t("disconnected")}</span>
      )}
      {activeTab?.result && (
        <>
          <span>
            {activeTab.isQueryResult
              ? `${(activeTab.result as { totalCount: number }).totalCount ?? 0} ${t("rows")}`
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
          className="p-0.5 rounded hover:bg-accent hover:text-foreground transition-colors"
          onClick={() => setShowSettings(true)}
          title={t("settings:settings", { ns: "settings" })}
        >
          <Settings size={14} />
        </button>
      </div>
      <SettingsModal isOpen={showSettings} onClose={() => setShowSettings(false)} />
    </>
  );
}

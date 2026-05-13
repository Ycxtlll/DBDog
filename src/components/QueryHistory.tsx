import { useTranslation } from "react-i18next";
import { ChevronUp, ChevronDown, Clock, Check, X } from "lucide-react";
import { useQueryStore } from "../stores/queryStore";
import { formatElapsed } from "../lib/utils";

export function QueryHistory() {
  const { t } = useTranslation("query");
  const { history, historyExpanded, toggleHistory } = useQueryStore();

  const latest = history[0];

  return (
    <div className="border-t border-border bg-card">
      <button
        className="w-full flex items-center justify-between px-3 py-1 text-xs text-muted-foreground hover:bg-accent/50"
        onClick={toggleHistory}
      >
        <div className="flex items-center gap-2">
          <Clock size={12} />
          {latest ? (
            <span className="truncate max-w-[400px]">{latest.sql}</span>
          ) : (
            <span>{t("noHistory")}</span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {historyExpanded ? (
            <ChevronDown size={12} />
          ) : (
            <ChevronUp size={12} />
          )}
        </div>
      </button>
      {historyExpanded && (
        <div className="max-h-[200px] overflow-auto">
          {history.map((item, idx) => (
            <div
              key={idx}
              className="px-3 py-1.5 text-xs border-t border-border/50 hover:bg-accent/50 cursor-pointer flex items-center gap-2"
              title={item.error}
              onClick={() => {
                const store = useQueryStore.getState();
                const tab = store.tabs.find((t) => t.id === store.activeTabId);
                if (tab) {
                  store.setTabSql(tab.id, item.sql);
                }
              }}
            >
              {item.status === "success" ? (
                <Check size={12} className="text-green-500 shrink-0" />
              ) : (
                <X size={12} className="text-red-500 shrink-0" />
              )}
              <span className="truncate flex-1 font-mono">{item.sql}</span>
              {item.elapsedMs !== undefined && (
                <span className="text-muted-foreground shrink-0">
                  {item.elapsedMs}ms
                </span>
              )}
              <span className="text-muted-foreground shrink-0">
                {formatElapsed(Date.now() - item.timestamp)} ago
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

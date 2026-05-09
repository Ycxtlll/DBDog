import { useTranslation } from "react-i18next";
import { Plus, X, Play, Square, AlignLeft, Zap } from "lucide-react";
import { useQueryStore } from "../../stores/queryStore";
import { useConnectionStore } from "../../stores/connectionStore";
import { useUiStore } from "../../stores/uiStore";

export function EditorTabBar() {
  const { t } = useTranslation("editor");
  const { tabs, activeTabId, newTab, closeTab, setActiveTab, execute, cancel } =
    useQueryStore();
  const activeConnectionId = useConnectionStore((s) => s.activeId);
  const { query } = useUiStore();

  const handleExecute = () => {
    if (!activeTabId || !activeConnectionId) return;
    execute(activeConnectionId, activeTabId, query.defaultLimit);
  };

  const handleCancel = () => {
    if (!activeTabId || !activeConnectionId) return;
    // Note: threadId is not tracked in this simplified implementation
    // In production, we'd get threadId from SELECT CONNECTION_ID()
    cancel(activeConnectionId, activeTabId, 0);
  };

  const activeTab = tabs.find((t) => t.id === activeTabId);

  return (
    <div className="flex items-center border-b border-border bg-card">
      <div className="flex-1 flex items-center overflow-x-auto">
        {tabs.map((tab) => (
          <div
            key={tab.id}
            className={`flex items-center gap-1 px-3 py-1.5 text-sm border-r border-border cursor-pointer select-none min-w-[100px] max-w-[200px] ${
              tab.id === activeTabId
                ? "bg-background text-foreground"
                : "text-muted-foreground hover:bg-accent/50"
            }`}
            onClick={() => setActiveTab(tab.id)}
          >
            <span className="truncate flex-1">{tab.name || t("newQuery")}</span>
            {tab.isExecuting && (
              <span className="w-2 h-2 rounded-full bg-yellow-500 animate-pulse" />
            )}
            <button
              className="p-0.5 rounded hover:bg-accent opacity-0 group-hover:opacity-100"
              onClick={(e) => {
                e.stopPropagation();
                closeTab(tab.id);
              }}
            >
              <X size={12} />
            </button>
          </div>
        ))}
        <button className="p-1.5 hover:bg-accent" onClick={newTab}>
          <Plus size={14} />
        </button>
      </div>
      <div className="flex items-center gap-1 px-2 border-l border-border">
        <button
          className="p-1.5 hover:bg-accent text-primary disabled:opacity-50"
          disabled={
            !activeConnectionId || !activeTabId || activeTab?.isExecuting
          }
          onClick={handleExecute}
          title={t("execute")}
        >
          <Play size={14} />
        </button>
        {activeTab?.isExecuting && (
          <button
            className="p-1.5 hover:bg-accent text-destructive"
            onClick={handleCancel}
            title={t("cancel")}
          >
            <Square size={14} />
          </button>
        )}
        <button
          className="p-1.5 hover:bg-accent disabled:opacity-50"
          disabled={!activeTabId}
          onClick={() => {
            if (activeTab) {
              import("sql-formatter").then(({ format }) => {
                const formatted = format(activeTab.sql, { language: "mysql" });
                useQueryStore.getState().setTabSql(activeTab.id, formatted);
              });
            }
          }}
          title={t("format")}
        >
          <AlignLeft size={14} />
        </button>
        <button
          className="p-1.5 hover:bg-accent disabled:opacity-50"
          disabled={!activeConnectionId || !activeTabId}
          onClick={() => {
            if (activeTab && activeConnectionId) {
              const sql = `EXPLAIN ${activeTab.sql}`;
              useQueryStore.getState().setTabSql(activeTab.id, sql);
              useQueryStore
                .getState()
                .execute(activeConnectionId, activeTab.id, query.defaultLimit);
            }
          }}
          title={t("explain")}
        >
          <Zap size={14} />
        </button>
      </div>
    </div>
  );
}

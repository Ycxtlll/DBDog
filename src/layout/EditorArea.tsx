import { useTranslation } from "react-i18next";
import { useQueryStore } from "../stores/queryStore";
import { useConnectionStore } from "../stores/connectionStore";
import { useZookeeperStore } from "../stores/zookeeperStore";
import { useMemcachedStore } from "../stores/memcachedStore";
import { EditorTabBar } from "../components/editor/EditorTabBar";
import { SqlEditor } from "../components/editor/SqlEditor";
import { ResultGrid } from "../components/grid/ResultGrid";
import { TableStructureDrawer } from "../components/drawer/TableStructureDrawer";
import { QueryHistory } from "../components/QueryHistory";
import { ZkNodeViewer } from "../components/zookeeper/ZkNodeViewer";
import { MemoEntryViewer } from "../components/memcached/MemoEntryViewer";

export function EditorArea() {
  const { t } = useTranslation(["common", "zookeeper", "memcached"]);
  const configs = useConnectionStore((s) => s.configs);
  const activeConnectionId = useConnectionStore((s) => s.activeId);

  const activeConfig = activeConnectionId
    ? configs.find((c) => c.id === activeConnectionId)
    : null;

  const activeTab = useQueryStore((s) =>
    s.tabs.find((t) => t.id === s.activeTabId),
  );

  const zkSelectedNode = useZookeeperStore((s) => s.selectedNode);
  const mcSelectedKey = useMemcachedStore((s) => s.selectedKey);

  return (
    <div className="flex-1 flex flex-col min-w-0 bg-background">
      {/* MySQL: tabs + editor + grid */}
      {activeConfig?.type === "mysql" && (
        <>
          <EditorTabBar />
          <div className="flex-1 flex flex-col min-h-0">
            {activeTab && (
              <>
                <div className="flex-1 min-h-0">
                  <SqlEditor
                    tabId={activeTab.id}
                    sql={activeTab.sql}
                    onChange={(sql) =>
                      useQueryStore.getState().setTabSql(activeTab.id, sql)
                    }
                    onExecute={() => {
                      if (activeConnectionId) {
                        useQueryStore
                          .getState()
                          .execute(activeConnectionId, activeTab.id);
                      }
                    }}
                    onExecuteSelection={(selectedSql) => {
                      if (activeConnectionId) {
                        useQueryStore
                          .getState()
                          .execute(activeConnectionId, activeTab.id, undefined, selectedSql);
                      }
                    }}
                  />
                </div>
                {activeTab.result && (
                  <div className="flex-[3] min-h-0 border-t border-border">
                    <ResultGrid tab={activeTab} />
                  </div>
                )}
              </>
            )}
          </div>
          <QueryHistory />
        </>
      )}

      {/* ZooKeeper: node viewer in right panel */}
      {activeConfig?.type === "zookeeper" && zkSelectedNode && (
        <ZkNodeViewer node={zkSelectedNode} />
      )}
      {activeConfig?.type === "zookeeper" && !zkSelectedNode && (
        <div className="flex items-center justify-center h-full text-xs text-muted-foreground">
          {t("zookeeper:selectNodeHint")}
        </div>
      )}

      {/* Memcached: entry viewer in right panel */}
      {activeConfig?.type === "memcached" && activeConnectionId && mcSelectedKey && (
        <MemoEntryViewer
          connectionId={activeConnectionId}
          keyName={mcSelectedKey}
        />
      )}
      {activeConfig?.type === "memcached" && !mcSelectedKey && (
        <div className="flex items-center justify-center h-full text-xs text-muted-foreground">
          {t("memcached:selectKeyHint")}
        </div>
      )}

      {/* No connection selected */}
      {!activeConfig && (
        <div className="flex items-center justify-center h-full text-xs text-muted-foreground">
          {t("common:connectToStart")}
        </div>
      )}

      <TableStructureDrawer connectionId={activeConnectionId} />
    </div>
  );
}

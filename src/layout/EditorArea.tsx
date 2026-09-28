import { useCallback, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Database, Network, Cpu } from "lucide-react";
import { useQueryStore } from "../stores/queryStore";
import { useConnectionStore } from "../stores/connectionStore";
import { useZookeeperStore } from "../stores/zookeeperStore";
import { useMemcachedStore } from "../stores/memcachedStore";
import { useUiStore } from "../stores/uiStore";
import { EditorTabBar } from "../components/editor/EditorTabBar";
import { SqlEditor } from "../components/editor/SqlEditor";
import { WelcomeGuide } from "../components/editor/WelcomeGuide";
import type { SqlEditorHandle } from "../components/editor/SqlEditor";
import { ResultGrid } from "../components/grid/ResultGrid";
import { ErrorBoundary } from "../components/ui/ErrorBoundary";
import { EmptyState } from "../components/ui/EmptyState";
import { SkeletonTable } from "../components/ui/Skeleton";
import { TableStructureDrawer } from "../components/drawer/TableStructureDrawer";
import { TableDesignerModal } from "../components/drawer/TableDesignerModal";
import { QueryHistory } from "../components/QueryHistory";
import { ZkNodeViewer } from "../components/zookeeper/ZkNodeViewer";
import { MemoEntryViewer } from "../components/memcached/MemoEntryViewer";

export function EditorArea() {
  const { t } = useTranslation(["common", "query", "editor", "zookeeper", "memcached", "connections"]);
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
  const sqlEditorRef = useRef<SqlEditorHandle>(null);
  const [hasSelection, setHasSelection] = useState(false);

  const getSqlSelection = () => {
    return sqlEditorRef.current?.getSelection() ?? { hasSelection: false, selectedSql: "" };
  };

  const getStatementAtCursor = () => sqlEditorRef.current?.getStatementAtCursor() ?? null;

  // Stable identity: @uiw's CodeMirror does a full state reconfigure when the
  // onChange prop changes identity, which resets the completion compartment.
  const handleSqlChange = useCallback((sql: string) => {
    const tabId = useQueryStore.getState().activeTabId;
    if (tabId) useQueryStore.getState().setTabSql(tabId, sql);
  }, []);

  const handleSelectionChange = useCallback((sel: boolean) => {
    setHasSelection(sel);
  }, []);

  return (
    <div className="flex-1 flex flex-col min-w-0 bg-background">
      {/* MySQL: tabs + editor + grid */}
      {activeConfig?.type === "mysql" && (
        <>
          <EditorTabBar
            getSqlSelection={getSqlSelection}
            getStatementAtCursor={getStatementAtCursor}
            hasSelection={hasSelection}
          />
          <div className="flex-1 flex flex-col min-h-0">
            {!activeTab && <WelcomeGuide />}
            {activeTab && (
              <>
                <div className="flex-1 min-h-0">
                  <SqlEditor
                    ref={sqlEditorRef}
                    tabId={activeTab.id}
                    sql={activeTab.sql}
                    placeholder={t("editor:editorPlaceholder")}
                    onChange={handleSqlChange}
                    onExecuteSelection={(selectedSql) => {
                      if (activeConnectionId) {
                        useQueryStore
                          .getState()
                          .execute(activeConnectionId, activeTab.id, undefined, selectedSql);
                      }
                    }}
                    onExecuteStatement={(statementSql) => {
                      if (activeConnectionId) {
                        useQueryStore
                          .getState()
                          .execute(activeConnectionId, activeTab.id, undefined, statementSql);
                      }
                    }}
                    onExecuteAll={() => {
                      if (activeConnectionId) {
                        useQueryStore
                          .getState()
                          .execute(
                            activeConnectionId,
                            activeTab.id,
                            useUiStore.getState().query.defaultLimit,
                          );
                      }
                    }}
                    onSelectionChange={handleSelectionChange}
                  />
                </div>
                {activeTab.result && (
                  <div className="flex-[3] min-h-0 border-t border-border">
                    <ErrorBoundary>
                      <ResultGrid tab={activeTab} />
                    </ErrorBoundary>
                  </div>
                )}
                {!activeTab.result && !activeTab.error && activeTab.isExecuting && (
                  <div className="flex-[3] min-h-0 border-t border-border">
                    <SkeletonTable rows={9} cols={7} />
                  </div>
                )}
                {!activeTab.result && activeTab.error && (
                  <div className="flex-[3] min-h-0 border-t border-border overflow-auto p-4">
                    <div className="text-sm text-destructive font-medium mb-1">
                      {t("query:error")}
                    </div>
                    <pre className="text-xs text-destructive/90 whitespace-pre-wrap break-words font-mono">
                      {activeTab.error}
                    </pre>
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
        <EmptyState icon={<Network size={20} />} title={t("zookeeper:selectNodeHint")} />
      )}

      {/* Memcached: entry viewer in right panel */}
      {activeConfig?.type === "memcached" && activeConnectionId && mcSelectedKey && (
        <MemoEntryViewer
          connectionId={activeConnectionId}
          keyName={mcSelectedKey}
        />
      )}
      {activeConfig?.type === "memcached" && activeConnectionId && !mcSelectedKey && (
        <EmptyState icon={<Cpu size={20} />} title={t("memcached:selectKeyHint")} />
      )}

      {/* No connection selected — guide differs by whether saved
          connections exist: pick one from the left vs. create the first. */}
      {!activeConfig && (
        <EmptyState
          icon={<Database size={20} />}
          title={
            configs.length > 0
              ? t("common:selectConnection")
              : t("common:connectToStart")
          }
          description={
            configs.length > 0
              ? t("common:selectConnectionHint", { count: configs.length })
              : undefined
          }
          action={{
            label: t("connections:newConnection"),
            onClick: () =>
              window.dispatchEvent(new CustomEvent("dbdog-new-connection")),
          }}
        />
      )}

      <TableStructureDrawer connectionId={activeConnectionId} />
      <TableDesignerModal connectionId={activeConnectionId} />
    </div>
  );
}

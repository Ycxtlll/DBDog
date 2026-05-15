import { useQueryStore } from "../stores/queryStore";
import { useConnectionStore } from "../stores/connectionStore";
import { EditorTabBar } from "../components/editor/EditorTabBar";
import { SqlEditor } from "../components/editor/SqlEditor";
import { ResultGrid } from "../components/grid/ResultGrid";
import { TableStructureDrawer } from "../components/drawer/TableStructureDrawer";
import { QueryHistory } from "../components/QueryHistory";

export function EditorArea() {
  const activeTab = useQueryStore((s) =>
    s.tabs.find((t) => t.id === s.activeTabId),
  );
  const activeConnectionId = useConnectionStore((s) => s.activeId);

  return (
    <div className="flex-1 flex flex-col min-w-0 bg-background">
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
      <TableStructureDrawer connectionId={activeConnectionId} />
    </div>
  );
}

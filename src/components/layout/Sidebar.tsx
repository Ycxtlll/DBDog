import React from 'react';
import { useUIStore } from '../../stores/uiStore';
import { useConnectionStore } from '../../stores/connectionStore';
import ConnectionList from '../connections/ConnectionList';
import DatabaseTree from '../sidebar/DatabaseTree';
import HistoryPanel from '../sidebar/HistoryPanel';
import BookmarkPanel from '../sidebar/BookmarkPanel';
import { ErDiagramView } from '../er/ErDiagramView';
import { ExplainVisualizer } from '../explain/ExplainVisualizer';
import { HealthDashboard } from '../health/HealthDashboard';

const Sidebar: React.FC = () => {
  const { sidebarPanel, isSidebarOpen, sidebarWidth } = useUIStore();
  const { activeConnectionId } = useConnectionStore();

  if (!isSidebarOpen || sidebarPanel === 'none') return null;

  return (
    <div
      className="flex flex-col h-full overflow-hidden"
      style={{
        width: sidebarWidth,
        minWidth: 200,
        maxWidth: 800,
        background: 'var(--bg-sidebar)',
        borderRight: '1px solid var(--border-primary)',
      }}
    >
      {sidebarPanel === 'connections' && (
        <div className="flex flex-col h-full">
          {!activeConnectionId && <ConnectionList />}
          {activeConnectionId && <DatabaseTree />}
        </div>
      )}
      {sidebarPanel === 'history' && <HistoryPanel />}
      {sidebarPanel === 'bookmarks' && <BookmarkPanel />}
      {sidebarPanel === 'er' && <ErDiagramView />}
      {sidebarPanel === 'explain' && <ExplainVisualizer />}
      {sidebarPanel === 'health' && <HealthDashboard />}
    </div>
  );
};

export default Sidebar;

import React, { useState, useEffect, useCallback } from 'react';
import { useUIStore } from '../../stores/uiStore';
import { useConnectionStore } from '../../stores/connectionStore';
import ConnectionList from '../connections/ConnectionList';
import DatabaseTree from '../sidebar/DatabaseTree';
import HistoryPanel from '../sidebar/HistoryPanel';
import BookmarkPanel from '../sidebar/BookmarkPanel';
import { ErDiagramView } from '../er/ErDiagramView';
import { ExplainVisualizer } from '../explain/ExplainVisualizer';
import { HealthDashboard } from '../health/HealthDashboard';
import { SchemaDiffView } from '../diff/SchemaDiffView';

const MIN_SIDEBAR_WIDTH = 200;
const MAX_SIDEBAR_WIDTH = 800;

const Sidebar: React.FC = () => {
  const { sidebarPanel, isSidebarOpen, sidebarWidth, setSidebarWidth } = useUIStore();
  const { activeConnectionId } = useConnectionStore();
  const [isResizing, setIsResizing] = useState(false);

  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
  }, []);

  useEffect(() => {
    if (!isResizing) return;
    const handleMouseMove = (e: MouseEvent) => {
      const newWidth = Math.max(MIN_SIDEBAR_WIDTH, Math.min(MAX_SIDEBAR_WIDTH, e.clientX - 56));
      setSidebarWidth(newWidth);
    };
    const handleMouseUp = () => setIsResizing(false);
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizing, setSidebarWidth]);

  if (!isSidebarOpen || sidebarPanel === 'none') return null;

  return (
    <div
      className="flex flex-col h-full overflow-hidden relative"
      style={{
        width: sidebarWidth,
        minWidth: MIN_SIDEBAR_WIDTH,
        maxWidth: MAX_SIDEBAR_WIDTH,
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
      {sidebarPanel === 'diff' && <SchemaDiffView />}

      {/* Resize handle */}
      <div
        className="absolute top-0 right-0 w-1 h-full cursor-col-resize z-10 hover:bg-accent-primary/30 transition-colors"
        onMouseDown={handleResizeStart}
        title="Drag to resize sidebar"
      />
    </div>
  );
};

export default Sidebar;

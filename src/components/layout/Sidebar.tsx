import React from 'react';
import { useUIStore } from '../../stores/uiStore';
import ConnectionList from '../connections/ConnectionList';

const Sidebar: React.FC = () => {
  const { sidebarPanel, isSidebarOpen, sidebarWidth } = useUIStore();

  if (!isSidebarOpen || sidebarPanel === 'none') return null;

  return (
    <div
      className="flex flex-col h-full overflow-hidden"
      style={{
        width: sidebarWidth,
        minWidth: 200,
        maxWidth: 500,
        background: 'var(--bg-sidebar)',
        borderRight: '1px solid var(--border-primary)',
      }}
    >
      {sidebarPanel === 'connections' && <ConnectionList />}
      {sidebarPanel === 'history' && (
        <div className="flex items-center justify-center h-full" style={{ color: 'var(--text-tertiary)' }}>
          Query History (Coming Soon)
        </div>
      )}
      {sidebarPanel === 'bookmarks' && (
        <div className="flex items-center justify-center h-full" style={{ color: 'var(--text-tertiary)' }}>
          Bookmarks (Coming Soon)
        </div>
      )}
      {sidebarPanel === 'health' && (
        <div className="flex items-center justify-center h-full" style={{ color: 'var(--text-tertiary)' }}>
          Health Dashboard (Coming Soon)
        </div>
      )}
    </div>
  );
};

export default Sidebar;

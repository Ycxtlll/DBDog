import React from 'react';
import { Database, Clock, Bookmark, Activity, PanelLeftClose, PanelLeft, GitGraph, SearchCheck } from 'lucide-react';
import { useUIStore } from '../../stores/uiStore';
import { useTranslation } from 'react-i18next';

const ActivityBar: React.FC = () => {
  const { sidebarPanel, setSidebarPanel, isSidebarOpen, toggleSidebar } = useUIStore();
  const { t } = useTranslation('common');

  const items = [
    { id: 'connections' as const, icon: Database, label: t('connections:title', { ns: 'connections' }) || 'Connections' },
    { id: 'history' as const, icon: Clock, label: 'History' },
    { id: 'bookmarks' as const, icon: Bookmark, label: 'Bookmarks' },
    { id: 'er' as const, icon: GitGraph, label: 'ER Diagram' },
    { id: 'explain' as const, icon: SearchCheck, label: 'EXPLAIN' },
    { id: 'health' as const, icon: Activity, label: 'Health' },
  ];

  const handleClick = (id: typeof sidebarPanel) => {
    if (sidebarPanel === id && isSidebarOpen) {
      toggleSidebar();
    } else {
      setSidebarPanel(id);
    }
  };

  return (
    <div className="flex flex-col items-center justify-between h-full py-2"
      style={{ width: '48px', background: 'var(--bg-secondary)', borderRight: '1px solid var(--border-primary)' }}>
      <div className="flex flex-col items-center gap-1">
        {items.map(({ id, icon: Icon, label }) => (
          <button
            key={id}
            onClick={() => handleClick(id)}
            title={label}
            className="flex items-center justify-center w-9 h-9 rounded-md transition-colors cursor-pointer border-none"
            style={{
              background: sidebarPanel === id && isSidebarOpen ? 'var(--bg-active)' : 'transparent',
              color: sidebarPanel === id && isSidebarOpen ? 'var(--accent-primary)' : 'var(--text-secondary)',
            }}
            onMouseEnter={(e) => {
              if (!(sidebarPanel === id && isSidebarOpen)) {
                e.currentTarget.style.background = 'var(--bg-hover)';
              }
            }}
            onMouseLeave={(e) => {
              if (!(sidebarPanel === id && isSidebarOpen)) {
                e.currentTarget.style.background = 'transparent';
              }
            }}
          >
            <Icon size={20} />
          </button>
        ))}
      </div>

      <div className="flex flex-col items-center gap-1">
        <button
          onClick={toggleSidebar}
          title={isSidebarOpen ? 'Collapse sidebar' : 'Expand sidebar'}
          className="flex items-center justify-center w-9 h-9 rounded-md transition-colors cursor-pointer border-none"
          style={{ color: 'var(--text-secondary)', background: 'transparent' }}
          onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-hover)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
        >
          {isSidebarOpen ? <PanelLeftClose size={20} /> : <PanelLeft size={20} />}
        </button>
      </div>
    </div>
  );
};

export default ActivityBar;

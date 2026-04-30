import React from 'react';
import { Database, Clock, Bookmark, Activity, PanelLeftClose, PanelLeft, GitGraph, SearchCheck, GitCompare } from 'lucide-react';
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
    { id: 'diff' as const, icon: GitCompare, label: 'Schema Diff' },
  ];

  const handleClick = (id: typeof sidebarPanel) => {
    if (sidebarPanel === id && isSidebarOpen) {
      toggleSidebar();
    } else {
      setSidebarPanel(id);
    }
  };

  return (
    <div className="flex flex-col items-center justify-between h-full py-4"
      style={{ width: '56px', background: 'var(--bg-sidebar)', borderRight: '1px solid var(--border-primary)' }}>
      <div className="flex flex-col items-center gap-2">
        <div className="mb-2 px-2">
          <div className="text-xs font-semibold text-center gradient-text" style={{ fontSize: '10px', letterSpacing: '0.1em' }}>
            DBDog
          </div>
        </div>
        {items.map(({ id, icon: Icon, label }) => (
          <button
            key={id}
            onClick={() => handleClick(id)}
            title={label}
            className="flex items-center justify-center w-11 h-11 rounded-xl transition-all cursor-pointer border-none relative group"
            style={{
              background: sidebarPanel === id && isSidebarOpen ? 'var(--accent-subtle)' : 'transparent',
              color: sidebarPanel === id && isSidebarOpen ? 'var(--accent-primary)' : 'var(--text-secondary)',
            }}
            onMouseEnter={(e) => {
              if (!(sidebarPanel === id && isSidebarOpen)) {
                e.currentTarget.style.background = 'var(--bg-hover)';
                e.currentTarget.style.transform = 'translateY(-2px)';
                e.currentTarget.style.boxShadow = 'var(--shadow-md)';
              }
            }}
            onMouseLeave={(e) => {
              if (!(sidebarPanel === id && isSidebarOpen)) {
                e.currentTarget.style.background = 'transparent';
                e.currentTarget.style.transform = 'translateY(0)';
                e.currentTarget.style.boxShadow = 'none';
              }
            }}
          >
            <Icon size={22} strokeWidth={sidebarPanel === id && isSidebarOpen ? 2.3 : 1.9}
              className="transition-transform duration-200 group-hover:scale-110" />
            {sidebarPanel === id && isSidebarOpen && (
              <div className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-8 rounded-full"
                style={{ background: 'var(--accent-primary)', boxShadow: '0 0 8px var(--accent-primary)' }}
              />
            )}
            <div className="absolute left-full ml-2 px-2 py-1 text-xs font-medium rounded-md whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none"
              style={{ background: 'var(--bg-elevated)', color: 'var(--text-primary)', boxShadow: 'var(--shadow-lg)' }}>
              {label}
            </div>
          </button>
        ))}
      </div>

      <div className="flex flex-col items-center gap-2">
        <button
          onClick={toggleSidebar}
          title={isSidebarOpen ? 'Collapse sidebar' : 'Expand sidebar'}
          className="flex items-center justify-center w-10 h-10 rounded-lg transition-all cursor-pointer border-none group"
          style={{ color: 'var(--text-secondary)', background: 'transparent' }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'var(--bg-hover)';
            e.currentTarget.style.transform = 'translateY(-1px)';
            e.currentTarget.style.boxShadow = 'var(--shadow-sm)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'transparent';
            e.currentTarget.style.transform = 'translateY(0)';
            e.currentTarget.style.boxShadow = 'none';
          }}
        >
          {isSidebarOpen ? <PanelLeftClose size={20} /> : <PanelLeft size={20} />}
          <div className="absolute left-full ml-2 px-2 py-1 text-xs font-medium rounded-md whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none"
            style={{ background: 'var(--bg-elevated)', color: 'var(--text-primary)', boxShadow: 'var(--shadow-lg)' }}>
            {isSidebarOpen ? 'Collapse sidebar' : 'Expand sidebar'}
          </div>
        </button>
      </div>
    </div>
  );
};

export default ActivityBar;

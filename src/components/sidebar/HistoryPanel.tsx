import React, { useState, useEffect, useCallback } from 'react';
import { Search, Clock } from 'lucide-react';
import { useHistoryStore } from '../../stores/historyStore';
import { useConnectionStore } from '../../stores/connectionStore';
import { useQueryStore } from '../../stores/queryStore';
import { useTranslation } from 'react-i18next';

const HistoryPanel: React.FC = () => {
  const { history, loading, loadHistory, searchHistory } = useHistoryStore();
  const { activeConnectionId } = useConnectionStore();
  const { addTab, setActiveTab, updateTabSql } = useQueryStore();
  const [searchQuery, setSearchQuery] = useState('');
  const { t } = useTranslation('common');

  useEffect(() => {
    if (searchQuery.trim()) {
      searchHistory(searchQuery);
    } else {
      loadHistory();
    }
  }, [searchQuery, loadHistory, searchHistory]);

  const handleSelect = useCallback((sql: string, database?: string) => {
    const tabId = addTab(activeConnectionId || undefined, database);
    setTimeout(() => {
      const { tabs } = useQueryStore.getState();
      const tab = tabs.find((t) => t.id === tabId);
      if (tab) {
        updateTabSql(tabId, sql);
        setActiveTab(tabId);
      }
    }, 0);
  }, [activeConnectionId, addTab, setActiveTab, updateTabSql]);

  const formatDate = useCallback((dateStr: string) => {
    const date = new Date(dateStr);
    const now = new Date();
    const diff = now.getTime() - date.getTime();

    if (diff < 60000) return 'Just now';
    if (diff < 3600000) return `${Math.floor(diff / 60000)} min ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)} hours ago`;
    if (diff < 604800000) return `${Math.floor(diff / 86400000)} days ago`;

    return date.toLocaleDateString();
  }, []);

  return (
    <div className="flex flex-col h-full" style={{ background: 'var(--bg-sidebar)' }}>
      <div className="p-2" style={{ borderBottom: '1px solid var(--border-primary)' }}>
        <div className="flex items-center gap-2 px-2 py-1 rounded" style={{ background: 'var(--bg-hover)' }}>
          <Search size={14} style={{ color: 'var(--text-tertiary)' }} />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t('search_placeholder')}
            className="flex-1 bg-transparent border-none outline-none text-xs"
            style={{ color: 'var(--text-primary)' }}
          />
        </div>
      </div>

      <div className="flex-1 overflow-auto p-1">
        {loading && (
          <div className="flex items-center justify-center p-4">
            <div className="animate-spin" style={{ color: 'var(--text-tertiary)' }}>
              ⟳
            </div>
          </div>
        )}

        {!loading && history.length === 0 && (
          <div className="flex items-center justify-center p-4 text-xs" style={{ color: 'var(--text-tertiary)' }}>
            {t('no_results')}
          </div>
        )}

        {!loading && history.map((entry) => (
          <div
            key={entry.id}
            className="px-2 py-1.5 rounded cursor-pointer text-xs"
            onClick={() => handleSelect(entry.sql, entry.databaseName)}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-hover)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
          >
            <div className="flex items-center gap-2 mb-1">
              <span
                style={{
                  color: entry.success ? 'var(--success)' : 'var(--error)',
                }}
              >
                {entry.success ? '✓' : '✕'}
              </span>
              <span
                className="flex-1 truncate font-medium"
                style={{ color: 'var(--text-primary)' }}
              >
                {entry.connectionName}
              </span>
              <span
                className="flex items-center gap-1"
                style={{ color: 'var(--text-tertiary)' }}
              >
                <Clock size={10} />
                {formatDate(entry.createdAt)}
              </span>
            </div>
            <div
              className="truncate"
              style={{ color: 'var(--text-secondary)' }}
            >
              {entry.sql}
            </div>
            {entry.durationMs && (
              <div className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
                {entry.rowCount !== undefined ? `${entry.rowCount} rows · ` : ''}
                {entry.durationMs}ms
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};

export default HistoryPanel;

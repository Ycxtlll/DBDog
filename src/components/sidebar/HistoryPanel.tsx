import React, { useState, useEffect, useCallback } from 'react';
import { Search, Clock, CheckCircle2, XCircle, Terminal } from 'lucide-react';
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
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    if (diff < 604800000) return `${Math.floor(diff / 86400000)}d ago`;

    return date.toLocaleDateString();
  }, []);

  return (
    <div className="flex flex-col h-full" style={{ background: 'var(--bg-sidebar)' }}>
      <div className="p-2" style={{ borderBottom: '1px solid var(--border-primary)' }}>
        <div className="panel-search">
          <Search size={14} className="text-tertiary" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t('search_placeholder')}
          />
        </div>
      </div>

      <div className="flex-1 overflow-auto p-2">
        {loading && (
          <div className="empty-state">
            <div className="animate-spin text-tertiary">⟳</div>
          </div>
        )}

        {!loading && history.length === 0 && (
          <div className="empty-state">
            <div className="empty-state-icon">
              <Terminal size={20} />
            </div>
            <div className="empty-state-title">{t('no_results')}</div>
            <div className="empty-state-desc">Your query history will appear here</div>
          </div>
        )}

        {!loading && (
          <div className="space-y-1">
            {history.map((entry) => (
              <div
                key={entry.id}
                className="group p-2.5 rounded-lg cursor-pointer hover:bg-hover transition-all"
                onClick={() => handleSelect(entry.sql, entry.databaseName)}
              >
                <div className="flex items-center gap-2 mb-1.5">
                  {entry.success ? (
                    <CheckCircle2 size={14} className="text-success flex-shrink-0" />
                  ) : (
                    <XCircle size={14} className="text-error flex-shrink-0" />
                  )}
                  <span className="flex-1 truncate font-medium text-primary text-xs">
                    {entry.connectionName}
                  </span>
                  <span className="flex items-center gap-1 text-tertiary text-[10px] flex-shrink-0">
                    <Clock size={10} />
                    {formatDate(entry.createdAt)}
                  </span>
                </div>
                <div className="truncate text-secondary text-[11px] font-mono opacity-80 pl-5">
                  {entry.sql}
                </div>
                {entry.durationMs && (
                  <div className="text-[10px] text-tertiary mt-1 pl-5">
                    {entry.rowCount !== undefined ? `${entry.rowCount} rows · ` : ''}
                    {entry.durationMs}ms
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default HistoryPanel;

import React, { useCallback, useEffect } from 'react';
import { Plus, X, Play, AlignLeft, Zap, FileCode } from 'lucide-react';
import { format } from 'sql-formatter';
import { useQueryStore } from '../../stores/queryStore';
import { useConnectionStore } from '../../stores/connectionStore';
import { useHistoryStore } from '../../stores/historyStore';
import { queryService } from '../../services/queryService';
import { useTranslation } from 'react-i18next';
import SqlEditor from './SqlEditor';
import ResultGrid from '../grid/ResultGrid';

const EditorPanel: React.FC = () => {
  const { tabs, activeTabId, addTab, closeTab, setActiveTab, updateTabSql, setTabExecuting, setTabResult, setTabUpdateResult, setTabError } = useQueryStore();
  const { activeConnectionId, activeConnections } = useConnectionStore();
  const { addHistoryEntry } = useHistoryStore();
  const { t } = useTranslation('editor');
  const { t: tq } = useTranslation('query');

  const activeTab = tabs.find((t) => t.id === activeTabId);

  const handleRun = useCallback(async () => {
    if (!activeTab || !activeConnectionId || !activeTab.sql.trim()) return;

    const connection = activeConnections.get(activeConnectionId);
    const connectionName = connection?.name || 'Unknown';

    setTabExecuting(activeTab.id, true);
    try {
      const sql = activeTab.sql.trim();
      const upperSql = sql.toUpperCase();

      if (upperSql.startsWith('SELECT') || upperSql.startsWith('SHOW') || upperSql.startsWith('DESCRIBE') || upperSql.startsWith('EXPLAIN')) {
        const result = await queryService.execute(activeConnectionId, sql);
        setTabResult(activeTab.id, result);
        addHistoryEntry({
          connectionId: activeConnectionId,
          connectionName,
          databaseName: activeTab.database,
          sql,
          durationMs: result.execution_time_ms,
          rowCount: result.row_count,
          success: true,
        });
      } else {
        const result = await queryService.update(activeConnectionId, sql);
        setTabUpdateResult(activeTab.id, result);
        addHistoryEntry({
          connectionId: activeConnectionId,
          connectionName,
          databaseName: activeTab.database,
          sql,
          durationMs: result.execution_time_ms,
          rowCount: result.rows_affected,
          success: true,
        });
      }
    } catch (e: any) {
      const errorMessage = e?.toString() || 'Unknown error';
      setTabError(activeTab.id, errorMessage);
      if (connection) {
        addHistoryEntry({
          connectionId: activeConnectionId,
          connectionName,
          databaseName: activeTab.database,
          sql: activeTab.sql.trim(),
          durationMs: undefined,
          rowCount: undefined,
          success: false,
          errorMessage,
        });
      }
    }
  }, [activeTab, activeConnectionId, activeConnections, setTabExecuting, setTabResult, setTabUpdateResult, setTabError, addHistoryEntry]);

  const handleFormat = useCallback(() => {
    if (!activeTab) return;
    try {
      const formatted = format(activeTab.sql, {
        language: 'mysql',
        tabWidth: 2,
        useTabs: false,
        keywordCase: 'upper',
        linesBetweenQueries: 2,
      });
      updateTabSql(activeTab.id, formatted);
    } catch {
      // Ignore formatting errors
    }
  }, [activeTab, updateTabSql]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    if (!activeTab) return;
    const textData = e.dataTransfer.getData('text/plain');
    if (textData) {
      const newSql = activeTab.sql + (activeTab.sql.trim() ? '\n' : '') + textData;
      updateTabSql(activeTab.id, newSql);
    }
  }, [activeTab, updateTabSql]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'n') {
        e.preventDefault();
        let connId = activeConnectionId;
        if (!connId && activeConnections.size > 0) {
          connId = Array.from(activeConnections.keys())[0];
        }
        addTab(connId || undefined);
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'w' && activeTabId) {
        e.preventDefault();
        closeTab(activeTabId);
      }
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'F') {
        e.preventDefault();
        if (activeTab && activeTab.sql.trim()) {
          handleFormat();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeConnectionId, activeConnections, addTab, activeTabId, closeTab, activeTab, handleFormat]);

  return (
    <div className="flex flex-col flex-1 overflow-hidden" style={{ background: 'var(--bg-primary)' }}>
      {/* Tab bar */}
      <div className="tab-bar">
        {tabs.map((tab) => (
          <div
            key={tab.id}
            className={`tab-item ${tab.id === activeTabId ? 'active' : ''}`}
            onClick={() => setActiveTab(tab.id)}
          >
            <span className="max-w-[140px] truncate">{tab.title}</span>
            <button
              onClick={(e) => { e.stopPropagation(); closeTab(tab.id); }}
              className="tab-close"
            >
              <X size={12} />
            </button>
          </div>
        ))}
        <button
          onClick={() => {
            let connId = activeConnectionId;
            if (!connId && activeConnections.size > 0) {
              connId = Array.from(activeConnections.keys())[0];
            }
            addTab(connId || undefined);
          }}
          className="toolbar-btn mx-1"
          title={t('new_tab')}
        >
          <Plus size={16} />
        </button>
      </div>

      {/* Toolbar */}
      {activeTab && (
        <div
          className="flex items-center gap-2 px-3 py-1.5"
          style={{ background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border-primary)' }}
        >
          <button
            onClick={handleRun}
            disabled={!activeConnectionId || !activeTab.sql.trim() || activeTab.isExecuting}
            className="toolbar-btn toolbar-btn-primary"
            title="Ctrl+Enter"
          >
            <Play size={13} />
            {t('run')}
          </button>
          <button
            onClick={handleFormat}
            disabled={!activeTab.sql.trim()}
            className="toolbar-btn"
            title="Ctrl+Shift+F"
          >
            <AlignLeft size={13} />
            {t('format')}
          </button>
          {!activeConnectionId && (
            <span className="text-xs ml-2 flex items-center gap-1" style={{ color: 'var(--warning)' }}>
              <Zap size={12} />
              {t('no_connection')}
            </span>
          )}
        </div>
      )}

      {/* Editor + Results */}
      <div className="flex flex-col flex-1 overflow-hidden">
        {!activeTab && tabs.length === 0 ? (
          <div className="flex items-center justify-center flex-1" style={{ color: 'var(--text-tertiary)' }}>
            <div className="empty-state">
              <div className="empty-state-icon">
                <FileCode size={24} />
              </div>
              <div className="empty-state-title">{t('select_connection')}</div>
              <button
                onClick={() => {
                  let connId = activeConnectionId;
                  if (!connId && activeConnections.size > 0) {
                    connId = Array.from(activeConnections.keys())[0];
                  }
                  addTab(connId || undefined);
                }}
                className="btn btn-primary btn-sm mt-2"
              >
                <Plus size={14} className="mr-1.5" />
                {t('new_tab')}
              </button>
            </div>
          </div>
        ) : (
          activeTab && (
            <>
              {/* SQL Editor area */}
              <div
                className="relative"
                style={{ height: '40%', minHeight: 120, borderBottom: '1px solid var(--border-primary)' }}
                onDragOver={handleDragOver}
                onDrop={handleDrop}
              >
                <SqlEditor
                  value={activeTab.sql}
                  onChange={(sql) => updateTabSql(activeTab.id, sql)}
                  onRun={handleRun}
                />
              </div>

              {/* Results area */}
              <div className="flex-1 overflow-hidden" style={{ background: 'var(--bg-primary)' }}>
                {activeTab.isExecuting && (
                  <div className="flex items-center justify-center h-full">
                    <div className="empty-state">
                      <div className="animate-spin text-tertiary mb-2">⟳</div>
                      <div className="empty-state-title">{tq('executing')}</div>
                    </div>
                  </div>
                )}
                {activeTab.error && (
                  <div className="p-4">
                    <div className="alert alert-error">
                      <div className="alert-dot bg-error" />
                      {activeTab.error}
                    </div>
                  </div>
                )}
                {activeTab.result && !activeTab.isExecuting && (
                  <ResultGrid result={activeTab.result} />
                )}
                {activeTab.updateResult && !activeTab.isExecuting && (
                  <div className="flex items-center justify-center h-full">
                    <div className="empty-state">
                      <div className="empty-state-icon bg-success-subtle">
                        <Zap size={20} className="text-success" />
                      </div>
                      <div className="empty-state-title text-success">
                        {tq('rows_affected', { count: activeTab.updateResult.rows_affected })}
                      </div>
                      <div className="empty-state-desc">
                        {tq('executed_in', { ms: activeTab.updateResult.execution_time_ms })}
                      </div>
                    </div>
                  </div>
                )}
                {!activeTab.result && !activeTab.updateResult && !activeTab.isExecuting && !activeTab.error && (
                  <div className="flex items-center justify-center h-full">
                    <div className="empty-state">
                      <div className="empty-state-title">{tq('no_results')}</div>
                      <div className="empty-state-desc">Run a query to see results here</div>
                    </div>
                  </div>
                )}
              </div>
            </>
          )
        )}
      </div>
    </div>
  );
};

export default EditorPanel;

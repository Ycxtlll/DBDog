import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Plus, X, Play, AlignLeft, Zap, FileCode, Square, Copy } from 'lucide-react';
import { format } from 'sql-formatter';
import { useQueryStore } from '../../stores/queryStore';
import { useConnectionStore } from '../../stores/connectionStore';
import { useHistoryStore } from '../../stores/historyStore';
import { useUIStore } from '../../stores/uiStore';
import { useToastStore } from '../../stores/toastStore';
import { queryService } from '../../services/queryService';
import { useTranslation } from 'react-i18next';
import SqlEditor from './SqlEditor';
import ResultGrid from '../grid/ResultGrid';

const MIN_EDITOR_HEIGHT = 80;
const MAX_EDITOR_HEIGHT_PERCENT = 80;

const EditorPanel: React.FC = () => {
  const { tabs, activeTabId, addTab, closeTab, setActiveTab, updateTabSql, setTabExecuting, setTabResult, setTabUpdateResult, setTabError } = useQueryStore();
  const { activeConnectionId, activeConnections } = useConnectionStore();
  const { addHistoryEntry } = useHistoryStore();
  const toggleTheme = useUIStore((s) => s.toggleTheme);
  const addToast = useToastStore((s) => s.addToast);
  const { t } = useTranslation('editor');
  const { t: tq } = useTranslation('query');

  const activeTab = tabs.find((t) => t.id === activeTabId);
  const containerRef = useRef<HTMLDivElement>(null);
  const [editorHeightPercent, setEditorHeightPercent] = useState(40);
  const [isResizing, setIsResizing] = useState(false);

  const handleRun = useCallback(async () => {
    if (!activeTab || !activeConnectionId || !activeTab.sql.trim()) return;

    const connection = activeConnections.get(activeConnectionId);
    const connectionName = connection?.name || 'Unknown';

    setTabExecuting(activeTab.id, true);
    try {
      const sql = activeTab.sql.trim();
      const upperSql = sql.toUpperCase();
      const isSelectLike =
        upperSql.startsWith('SELECT') ||
        upperSql.startsWith('SHOW') ||
        upperSql.startsWith('DESCRIBE') ||
        upperSql.startsWith('EXPLAIN') ||
        upperSql.startsWith('WITH');

      if (isSelectLike) {
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

  const handleCancel = useCallback(async () => {
    if (!activeTab || !activeConnectionId) return;
    try {
      await queryService.cancel(activeConnectionId);
      setTabExecuting(activeTab.id, false);
      addToast(tq('query_cancelled') || 'Query cancelled', 'info');
    } catch (e: any) {
      addToast(e?.toString() || 'Failed to cancel query', 'error');
    }
  }, [activeTab, activeConnectionId, setTabExecuting, addToast, tq]);

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

  // Resize handler
  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
  }, []);

  useEffect(() => {
    if (!isResizing) return;
    const handleMouseMove = (e: MouseEvent) => {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const percent = ((e.clientY - rect.top) / rect.height) * 100;
      setEditorHeightPercent(Math.max(MIN_EDITOR_HEIGHT / rect.height * 100, Math.min(MAX_EDITOR_HEIGHT_PERCENT, percent)));
    };
    const handleMouseUp = () => setIsResizing(false);
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizing]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const isInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'n' && !isInput) {
        e.preventDefault();
        let connId = activeConnectionId;
        if (!connId && activeConnections.size > 0) {
          connId = Array.from(activeConnections.keys())[0];
        }
        addTab(connId || undefined);
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'w' && activeTabId && !isInput) {
        e.preventDefault();
        closeTab(activeTabId);
      }
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'f' && !isInput) {
        e.preventDefault();
        if (activeTab && activeTab.sql.trim()) {
          handleFormat();
        }
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 't' && !isInput) {
        e.preventDefault();
        toggleTheme();
      }
      if (e.key === 'F5' && !isInput) {
        e.preventDefault();
        if (activeTab && activeTab.sql.trim() && !activeTab.isExecuting) {
          handleRun();
        }
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'tab' && !isInput) {
        e.preventDefault();
        const idx = tabs.findIndex((t) => t.id === activeTabId);
        if (tabs.length > 1) {
          const nextIdx = e.shiftKey ? (idx - 1 + tabs.length) % tabs.length : (idx + 1) % tabs.length;
          setActiveTab(tabs[nextIdx].id);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeConnectionId, activeConnections, addTab, activeTabId, closeTab, activeTab, handleFormat, toggleTheme, handleRun, tabs, setActiveTab]);

  const handleCopyError = useCallback(() => {
    if (activeTab?.error) {
      navigator.clipboard.writeText(activeTab.error);
      addToast('Error copied to clipboard', 'success');
    }
  }, [activeTab, addToast]);

  return (
    <div className="flex flex-col flex-1 overflow-hidden" style={{ background: 'var(--bg-primary)' }}>
      {/* Tab bar */}
      <div className="tab-bar" role="tablist">
        {tabs.map((tab) => (
          <div
            key={tab.id}
            className={`tab-item group ${tab.id === activeTabId ? 'active' : ''}`}
            onClick={() => setActiveTab(tab.id)}
            role="tab"
            aria-selected={tab.id === activeTabId}
          >
            <span className="max-w-[140px] truncate">{tab.title}</span>
            <button
              onClick={(e) => { e.stopPropagation(); closeTab(tab.id); }}
              className="tab-close opacity-0 group-hover:opacity-100"
              title={t('close_tab')}
              aria-label={t('close_tab')}
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
          aria-label={t('new_tab')}
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
          {activeTab.isExecuting ? (
            <button
              onClick={handleCancel}
              className="toolbar-btn toolbar-btn-primary"
              style={{ background: 'var(--error)', color: 'var(--text-inverse)' }}
              title="Cancel"
            >
              <Square size={13} fill="currentColor" />
              {tq('cancel') || 'Cancel'}
            </button>
          ) : (
            <button
              onClick={handleRun}
              disabled={!activeConnectionId || !activeTab.sql.trim()}
              className="toolbar-btn toolbar-btn-primary"
              title="Ctrl+Enter / F5"
            >
              <Play size={13} />
              {t('run')}
            </button>
          )}
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
      <div ref={containerRef} className="flex flex-col flex-1 overflow-hidden relative">
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
                className="relative overflow-hidden"
                style={{ height: `${editorHeightPercent}%`, minHeight: MIN_EDITOR_HEIGHT, borderBottom: '1px solid var(--border-primary)' }}
                onDragOver={handleDragOver}
                onDrop={handleDrop}
              >
                <SqlEditor
                  value={activeTab.sql}
                  onChange={(sql) => updateTabSql(activeTab.id, sql)}
                  onRun={handleRun}
                />
              </div>

              {/* Resize handle */}
              <div
                className="resize-handle-horizontal"
                onMouseDown={handleResizeStart}
                title="Drag to resize"
              />

              {/* Results area */}
              <div className="flex-1 overflow-hidden" style={{ background: 'var(--bg-primary)' }}>
                {activeTab.isExecuting && (
                  <div className="flex items-center justify-center h-full">
                    <div className="empty-state">
                      <div className="animate-spin text-tertiary mb-2">⟳</div>
                      <div className="empty-state-title">{tq('executing')}</div>
                      <button
                        onClick={handleCancel}
                        className="btn btn-secondary btn-sm mt-2"
                      >
                        <Square size={12} className="mr-1" fill="currentColor" />
                        {tq('cancel') || 'Cancel'}
                      </button>
                    </div>
                  </div>
                )}
                {activeTab.error && !activeTab.isExecuting && (
                  <div className="p-4">
                    <div className="alert alert-error flex items-start gap-2">
                      <div className="alert-dot bg-error mt-1 flex-shrink-0" />
                      <div className="flex-1 text-sm overflow-auto max-h-[200px]">{activeTab.error}</div>
                      <button
                        onClick={handleCopyError}
                        className="toolbar-btn p-1 flex-shrink-0"
                        title="Copy error"
                      >
                        <Copy size={14} />
                      </button>
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

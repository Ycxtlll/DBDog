import React, { useCallback } from 'react';
import { Plus, X, Play, PlayCircle, AlignLeft } from 'lucide-react';
import { useQueryStore } from '../../stores/queryStore';
import { useConnectionStore } from '../../stores/connectionStore';
import { queryService } from '../../services/queryService';
import { useTranslation } from 'react-i18next';
import SqlEditor from './SqlEditor';
import ResultGrid from '../grid/ResultGrid';

const EditorPanel: React.FC = () => {
  const { tabs, activeTabId, addTab, closeTab, setActiveTab, updateTabSql, setTabExecuting, setTabResult, setTabUpdateResult, setTabError } = useQueryStore();
  const { activeConnectionId } = useConnectionStore();
  const { t } = useTranslation('editor');
  const { t: tq } = useTranslation('query');

  const activeTab = tabs.find((t) => t.id === activeTabId);

  const handleRun = useCallback(async () => {
    if (!activeTab || !activeConnectionId || !activeTab.sql.trim()) return;

    setTabExecuting(activeTab.id, true);
    try {
      const sql = activeTab.sql.trim();
      const upperSql = sql.toUpperCase();

      if (upperSql.startsWith('SELECT') || upperSql.startsWith('SHOW') || upperSql.startsWith('DESCRIBE') || upperSql.startsWith('EXPLAIN')) {
        const result = await queryService.execute(activeConnectionId, sql);
        setTabResult(activeTab.id, result);
      } else {
        const result = await queryService.update(activeConnectionId, sql);
        setTabUpdateResult(activeTab.id, result);
      }
    } catch (e: any) {
      setTabError(activeTab.id, e?.toString() || 'Unknown error');
    }
  }, [activeTab, activeConnectionId, setTabExecuting, setTabResult, setTabUpdateResult, setTabError]);

  const handleFormat = useCallback(() => {
    if (!activeTab) return;
    try {
      // Basic SQL formatting — will use sql-formatter library in Phase 3
      const formatted = activeTab.sql
        .replace(/\b(SELECT|FROM|WHERE|JOIN|LEFT JOIN|RIGHT JOIN|INNER JOIN|ON|AND|OR|ORDER BY|GROUP BY|HAVING|LIMIT|OFFSET|INSERT|INTO|VALUES|UPDATE|SET|DELETE|CREATE|ALTER|DROP|AS)\b/gi,
          (m) => '\n' + m.toUpperCase())
        .replace(/^\n/, '')
        .replace(/\n{3,}/g, '\n\n');
      updateTabSql(activeTab.id, formatted);
    } catch {
      // Ignore formatting errors
    }
  }, [activeTab, updateTabSql]);

  return (
    <div className="flex flex-col flex-1 overflow-hidden" style={{ background: 'var(--bg-primary)' }}>
      {/* Tab bar */}
      <div
        className="flex items-center overflow-x-auto"
        style={{ background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border-primary)', minHeight: 35 }}
      >
        {tabs.map((tab) => (
          <div
            key={tab.id}
            className="flex items-center gap-1 px-3 py-1.5 cursor-pointer select-none text-xs whitespace-nowrap"
            style={{
              background: tab.id === activeTabId ? 'var(--bg-primary)' : 'transparent',
              borderRight: '1px solid var(--border-primary)',
              color: tab.id === activeTabId ? 'var(--text-primary)' : 'var(--text-secondary)',
              borderBottom: tab.id === activeTabId ? '2px solid var(--accent-primary)' : '2px solid transparent',
            }}
            onClick={() => setActiveTab(tab.id)}
          >
            <span>{tab.title}</span>
            <button
              onClick={(e) => { e.stopPropagation(); closeTab(tab.id); }}
              className="flex items-center justify-center w-4 h-4 rounded cursor-pointer border-none p-0"
              style={{ background: 'transparent', color: 'var(--text-tertiary)' }}
              onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--error)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-tertiary)'; }}
            >
              <X size={12} />
            </button>
          </div>
        ))}
        <button
          onClick={() => addTab(activeConnectionId || undefined)}
          className="flex items-center justify-center w-7 h-7 mx-1 rounded cursor-pointer border-none"
          style={{ background: 'transparent', color: 'var(--text-secondary)' }}
          onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-hover)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
          title={t('new_tab')}
        >
          <Plus size={16} />
        </button>
      </div>

      {/* Toolbar */}
      {activeTab && (
        <div
          className="flex items-center gap-1 px-2 py-1"
          style={{ background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border-primary)' }}
        >
          <button
            onClick={handleRun}
            disabled={!activeConnectionId || !activeTab.sql.trim() || activeTab.isExecuting}
            className="flex items-center gap-1 px-2 py-1 rounded text-xs font-medium transition-colors cursor-pointer border-none"
            style={{
              background: activeConnectionId ? 'var(--accent-primary)' : 'var(--bg-tertiary)',
              color: activeConnectionId ? 'var(--text-inverse)' : 'var(--text-tertiary)',
            }}
            onMouseEnter={(e) => { if (activeConnectionId) e.currentTarget.style.background = 'var(--accent-hover)'; }}
            onMouseLeave={(e) => { if (activeConnectionId) e.currentTarget.style.background = 'var(--accent-primary)'; }}
            title="Ctrl+Enter"
          >
            <Play size={12} />
            {t('run')}
          </button>
          <button
            onClick={handleFormat}
            disabled={!activeTab.sql.trim()}
            className="flex items-center gap-1 px-2 py-1 rounded text-xs font-medium transition-colors cursor-pointer border-none"
            style={{ background: 'var(--bg-tertiary)', color: 'var(--text-primary)' }}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-hover)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--bg-tertiary)'; }}
            title="Ctrl+Shift+F"
          >
            <AlignLeft size={12} />
            {t('format')}
          </button>
          {!activeConnectionId && (
            <span className="text-xs ml-2" style={{ color: 'var(--warning)' }}>
              {t('no_connection')}
            </span>
          )}
        </div>
      )}

      {/* Editor + Results */}
      <div className="flex flex-col flex-1 overflow-hidden">
        {!activeTab && tabs.length === 0 ? (
          <div className="flex items-center justify-center flex-1" style={{ color: 'var(--text-tertiary)' }}>
            <div className="text-center">
              <PlayCircle size={48} className="mx-auto mb-3 opacity-30" />
              <p className="text-sm mb-2">{t('select_connection')}</p>
              <button
                onClick={() => addTab(activeConnectionId || undefined)}
                className="px-3 py-1.5 rounded text-xs font-medium transition-colors cursor-pointer border-none"
                style={{ background: 'var(--accent-primary)', color: 'var(--text-inverse)' }}
                onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--accent-hover)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--accent-primary)'; }}
              >
                {t('new_tab')}
              </button>
            </div>
          </div>
        ) : (
          activeTab && (
            <>
              {/* SQL Editor area */}
              <div style={{ height: '40%', minHeight: 120, borderBottom: '1px solid var(--border-primary)' }}>
                <SqlEditor
                  value={activeTab.sql}
                  onChange={(sql) => updateTabSql(activeTab.id, sql)}
                  onRun={handleRun}
                />
              </div>

              {/* Results area */}
              <div className="flex-1 overflow-hidden" style={{ background: 'var(--bg-primary)' }}>
                {activeTab.isExecuting && (
                  <div className="flex items-center justify-center h-full" style={{ color: 'var(--text-tertiary)' }}>
                    <span className="text-sm">{tq('executing')}</span>
                  </div>
                )}
                {activeTab.error && (
                  <div className="p-3 text-xs" style={{ color: 'var(--error)', background: 'rgba(231,76,60,0.05)' }}>
                    {activeTab.error}
                  </div>
                )}
                {activeTab.result && !activeTab.isExecuting && (
                  <ResultGrid result={activeTab.result} />
                )}
                {activeTab.updateResult && !activeTab.isExecuting && (
                  <div className="flex items-center justify-center h-full" style={{ color: 'var(--success)' }}>
                    <span className="text-sm">
                      {tq('rows_affected', { count: activeTab.updateResult.rows_affected })} — {tq('executed_in', { ms: activeTab.updateResult.execution_time_ms })}
                    </span>
                  </div>
                )}
                {!activeTab.result && !activeTab.updateResult && !activeTab.isExecuting && !activeTab.error && (
                  <div className="flex items-center justify-center h-full" style={{ color: 'var(--text-tertiary)' }}>
                    <span className="text-sm">{tq('no_results')}</span>
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

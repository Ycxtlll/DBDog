import React from 'react';
import { useTranslation } from 'react-i18next';
import { useConnectionStore } from '../../stores/connectionStore';
import { useQueryStore } from '../../stores/queryStore';
import { Database, Clock, Rows3, AlertTriangle } from 'lucide-react';

const StatusBar: React.FC = () => {
  const { t } = useTranslation('query');
  const { activeConnections, activeConnectionId } = useConnectionStore();
  const activeTab = useQueryStore((s) => s.tabs.find((t) => t.id === s.activeTabId));

  const activeConn = activeConnectionId ? activeConnections.get(activeConnectionId) : null;
  const result = activeTab?.result;
  const updateResult = activeTab?.updateResult;

  return (
    <div
      className="flex items-center justify-between px-4 h-7 text-[11px] select-none"
      style={{
        background: 'var(--bg-secondary)',
        color: 'var(--text-secondary)',
        borderTop: '1px solid var(--border-primary)',
      }}
    >
      <div className="flex items-center gap-4">
        {activeConn && (
          <span className="flex items-center gap-1.5">
            <Database size={11} className="text-accent" />
            <span className="font-medium text-primary">{activeConn.name}</span>
            <span className="text-tertiary">({activeConn.server_version})</span>
          </span>
        )}
        {activeTab?.database && (
          <span className="flex items-center gap-1 text-tertiary">
            <span className="w-1 h-1 rounded-full bg-tertiary" />
            {activeTab.database}
          </span>
        )}
      </div>

      <div className="flex items-center gap-4">
        {result && (
          <>
            <span className="flex items-center gap-1">
              <Rows3 size={11} />
              {t('rows_returned', { count: result.row_count })}
            </span>
            <span className="flex items-center gap-1">
              <Clock size={11} />
              {t('executed_in', { ms: result.execution_time_ms })}
            </span>
            {result.truncated && (
              <span className="flex items-center gap-1 text-warning">
                <AlertTriangle size={11} />
                {t('truncated', { limit: 1000 })}
              </span>
            )}
          </>
        )}
        {updateResult && (
          <>
            <span className="flex items-center gap-1">
              <Rows3 size={11} />
              {t('rows_affected', { count: updateResult.rows_affected })}
            </span>
            <span className="flex items-center gap-1">
              <Clock size={11} />
              {t('executed_in', { ms: updateResult.execution_time_ms })}
            </span>
          </>
        )}
        {activeTab?.isExecuting && (
          <span className="flex items-center gap-1">
            <span className="animate-spin">⟳</span>
            {t('executing')}
          </span>
        )}
      </div>
    </div>
  );
};

export default StatusBar;

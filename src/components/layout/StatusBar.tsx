import React from 'react';
import { useTranslation } from 'react-i18next';
import { useConnectionStore } from '../../stores/connectionStore';
import { useQueryStore } from '../../stores/queryStore';

const StatusBar: React.FC = () => {
  const { t } = useTranslation('query');
  const { activeConnections, activeConnectionId } = useConnectionStore();
  const activeTab = useQueryStore((s) => s.tabs.find((t) => t.id === s.activeTabId));

  const activeConn = activeConnectionId ? activeConnections.get(activeConnectionId) : null;
  const result = activeTab?.result;
  const updateResult = activeTab?.updateResult;

  return (
    <div
      className="flex items-center justify-between px-3 h-6 text-xs select-none"
      style={{
        background: 'var(--accent-primary)',
        color: 'var(--text-inverse)',
      }}
    >
      <div className="flex items-center gap-4">
        {activeConn && (
          <span className="flex items-center gap-1">
            <span className="inline-block w-2 h-2 rounded-full" style={{ background: 'var(--status-connected)' }} />
            {activeConn.name} ({activeConn.server_version})
          </span>
        )}
        {activeTab?.database && <span>{activeTab.database}</span>}
      </div>

      <div className="flex items-center gap-4">
        {result && (
          <>
            <span>{t('rows_returned', { count: result.row_count })}</span>
            <span>{t('executed_in', { ms: result.execution_time_ms })}</span>
            {result.truncated && <span style={{ color: 'var(--warning)' }}>{t('truncated', { limit: 1000 })}</span>}
          </>
        )}
        {updateResult && (
          <>
            <span>{t('rows_affected', { count: updateResult.rows_affected })}</span>
            <span>{t('executed_in', { ms: updateResult.execution_time_ms })}</span>
          </>
        )}
        {activeTab?.isExecuting && <span>{t('executing')}</span>}
      </div>
    </div>
  );
};

export default StatusBar;

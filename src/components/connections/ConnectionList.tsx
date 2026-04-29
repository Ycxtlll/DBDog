import React, { useEffect } from 'react';
import { Plus, Trash2, Plug, Unplug } from 'lucide-react';
import { useConnectionStore } from '../../stores/connectionStore';
import { useTranslation } from 'react-i18next';
import type { ConnectionSummary } from '../../types/connection';

const ConnectionList: React.FC = () => {
  const { connections, loadConnections, connect, disconnect, deleteConnection, connectionStatuses } = useConnectionStore();
  const [showDialog, setShowDialog] = React.useState(false);
  const { t } = useTranslation('connections');

  useEffect(() => {
    loadConnections();
  }, [loadConnections]);

  const handleConnect = async (conn: ConnectionSummary) => {
    try {
      await connect(conn.id);
    } catch (e: any) {
      console.error('Connection failed:', e);
    }
  };

  const handleDisconnect = async (id: string) => {
    try {
      await disconnect(id);
    } catch (e) {
      console.error('Disconnect failed:', e);
    }
  };

  const handleDelete = async (id: string) => {
    if (window.confirm(t('confirm_delete'))) {
      await deleteConnection(id);
    }
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-3 py-2" style={{ borderBottom: '1px solid var(--border-primary)' }}>
        <span className="text-xs font-semibold uppercase" style={{ color: 'var(--text-secondary)' }}>
          {t('title')}
        </span>
        <button
          onClick={() => setShowDialog(true)}
          className="flex items-center justify-center w-6 h-6 rounded transition-colors cursor-pointer border-none"
          style={{ background: 'transparent', color: 'var(--text-secondary)' }}
          onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-hover)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
          title={t('new_connection')}
        >
          <Plus size={16} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-1">
        {connections.length === 0 && (
          <div className="flex items-center justify-center h-32" style={{ color: 'var(--text-tertiary)' }}>
            <span className="text-xs">{t('new_connection')}</span>
          </div>
        )}
        {connections.map((conn) => {
          const status = connectionStatuses[conn.id] || 'disconnected';
          const isConnected = status === 'connected';
          const isConnecting = status === 'connecting';

          return (
            <div
              key={conn.id}
              className="flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer group"
              style={{ color: 'var(--text-primary)' }}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-hover)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
            >
              <span
                className="inline-block w-2 h-2 rounded-full flex-shrink-0"
                style={{
                  background: isConnected
                    ? 'var(--status-connected)'
                    : isConnecting
                    ? 'var(--status-connecting)'
                    : status === 'error'
                    ? 'var(--status-error)'
                    : 'var(--status-disconnected)',
                }}
              />
              <div className="flex-1 min-w-0">
                <div className="text-sm truncate">{conn.name}</div>
                <div className="text-xs truncate" style={{ color: 'var(--text-tertiary)' }}>
                  {conn.host}:{conn.port}
                </div>
              </div>
              <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                {isConnected ? (
                  <button
                    onClick={(e) => { e.stopPropagation(); handleDisconnect(conn.id); }}
                    className="flex items-center justify-center w-6 h-6 rounded transition-colors cursor-pointer border-none"
                    style={{ background: 'transparent', color: 'var(--text-secondary)' }}
                    onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--error)'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-secondary)'; }}
                    title={t('disconnect')}
                  >
                    <Unplug size={14} />
                  </button>
                ) : (
                  <button
                    onClick={(e) => { e.stopPropagation(); handleConnect(conn); }}
                    className="flex items-center justify-center w-6 h-6 rounded transition-colors cursor-pointer border-none"
                    style={{ background: 'transparent', color: 'var(--text-secondary)' }}
                    onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--accent-primary)'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-secondary)'; }}
                    disabled={isConnecting}
                    title={t('connect')}
                  >
                    <Plug size={14} />
                  </button>
                )}
                <button
                  onClick={(e) => { e.stopPropagation(); handleDelete(conn.id); }}
                  className="flex items-center justify-center w-6 h-6 rounded transition-colors cursor-pointer border-none"
                  style={{ background: 'transparent', color: 'var(--text-secondary)' }}
                  onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--error)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-secondary)'; }}
                  title={t('delete_connection')}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {showDialog && <ConnectionDialog onClose={() => setShowDialog(false)} />}
    </div>
  );
};

import ConnectionDialog from './ConnectionDialog';
export default ConnectionList;

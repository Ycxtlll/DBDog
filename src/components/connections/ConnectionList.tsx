import React, { useEffect } from 'react';
import { Plus, Trash2, Plug, Unplug, Server, AlertCircle } from 'lucide-react';
import { useConnectionStore } from '../../stores/connectionStore';
import { useQueryStore } from '../../stores/queryStore';
import { useToastStore } from '../../stores/toastStore';
import { useTranslation } from 'react-i18next';
import type { ConnectionSummary } from '../../types/connection';

const ConnectionList: React.FC = () => {
  const { connections, loadConnections, connect, disconnect, deleteConnection, connectionStatuses } = useConnectionStore();
  const { addTab } = useQueryStore();
  const addToast = useToastStore((s) => s.addToast);
  const [showDialog, setShowDialog] = React.useState(false);
  const { t } = useTranslation('connections');

  useEffect(() => {
    loadConnections();
  }, [loadConnections]);

  const handleConnect = async (conn: ConnectionSummary) => {
    try {
      await connect(conn.id);
      addToast(t('connected_to', { name: conn.name }), 'success');
    } catch (e: any) {
      const msg = e?.toString() || 'Connection failed';
      console.error('Connection failed:', e);
      addToast(msg, 'error');
    }
  };

  const handleDisconnect = async (id: string) => {
    try {
      await disconnect(id);
      addToast(t('disconnected'), 'info');
    } catch (e) {
      console.error('Disconnect failed:', e);
      addToast(t('disconnect_failed'), 'error');
    }
  };

  const handleDelete = async (id: string) => {
    if (window.confirm(t('confirm_delete'))) {
      await deleteConnection(id);
      addToast(t('deleted'), 'info');
    }
  };

  const handleDoubleClick = async (conn: ConnectionSummary) => {
    const status = connectionStatuses[conn.id] || 'disconnected';
    const isConnected = status === 'connected';

    if (!isConnected) {
      try {
        await connect(conn.id);
      } catch (e: any) {
        console.error('Connection failed:', e);
        return;
      }
    }
    addTab(conn.id);
  };

  return (
    <div className="flex flex-col h-full" style={{ background: 'var(--bg-sidebar)' }}>
      <div className="panel-header">
        <span className="panel-title">{t('title')}</span>
        <button
          onClick={() => setShowDialog(true)}
          className="toolbar-btn"
          title={t('new_connection')}
        >
          <Plus size={16} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-3">
        {connections.length === 0 && (
          <div className="empty-state">
            <div className="empty-state-icon">
              <Server size={24} />
            </div>
            <div className="empty-state-title">{t('no_connections')}</div>
            <button
              onClick={() => setShowDialog(true)}
              className="btn btn-primary btn-sm mt-2"
            >
              <Plus size={14} className="mr-1.5" />
              {t('new_connection')}
            </button>
          </div>
        )}
        <div className="space-y-2">
          {connections.map((conn) => {
            const status = connectionStatuses[conn.id] || 'disconnected';
            const isConnected = status === 'connected';
            const isConnecting = status === 'connecting';
            const isError = status === 'error';

            return (
              <div
                key={conn.id}
                className="card group cursor-pointer p-3"
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  handleDoubleClick(conn);
                }}
              >
                <div className="flex items-center gap-3">
                  <div className="relative flex-shrink-0">
                    <span
                      className="inline-block w-2.5 h-2.5 rounded-full"
                      style={{
                        background: isConnected
                          ? 'var(--status-connected)'
                          : isConnecting
                          ? 'var(--status-connecting)'
                          : isError
                          ? 'var(--status-error)'
                          : 'var(--status-disconnected)',
                      }}
                      aria-label={status}
                    />
                    {isConnected && (
                      <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-status-connected animate-pulse" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <div className="text-sm font-semibold truncate text-primary">{conn.name}</div>
                      <span className={`badge badge-${isConnected ? 'success' : isConnecting ? 'warning' : isError ? 'error' : 'secondary'} text-[10px]`}>
                        {isConnected ? t('connected') : isConnecting ? t('connecting') : isError ? t('error') : t('disconnected')}
                      </span>
                    </div>
                    <div className="text-[11px] truncate text-muted">
                      {conn.host}:{conn.port} · {conn.user} · {conn.db_type}
                    </div>
                  </div>
                  <div className="card-actions flex-shrink-0">
                    {isConnected ? (
                      <button
                        onClick={(e) => { e.stopPropagation(); handleDisconnect(conn.id); }}
                        className="toolbar-btn p-1.5 text-error hover:bg-error-subtle"
                        title={t('disconnect')}
                      >
                        <Unplug size={15} />
                      </button>
                    ) : (
                      <button
                        onClick={(e) => { e.stopPropagation(); handleConnect(conn); }}
                        className="toolbar-btn p-1.5 text-success hover:bg-success-subtle"
                        disabled={isConnecting}
                        title={t('connect')}
                      >
                        <Plug size={15} className={isConnecting ? 'animate-spin' : ''} />
                      </button>
                    )}
                    <button
                      onClick={(e) => { e.stopPropagation(); handleDelete(conn.id); }}
                      className="toolbar-btn p-1.5 hover:text-error hover:bg-error-subtle"
                      title={t('delete_connection')}
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                </div>
                {isError && (
                  <div className="flex items-center gap-1.5 mt-2 text-[11px] text-error">
                    <AlertCircle size={12} />
                    {t('connection_error')}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {showDialog && <ConnectionDialog onClose={() => setShowDialog(false)} />}
    </div>
  );
};

import ConnectionDialog from './ConnectionDialog';
export default ConnectionList;

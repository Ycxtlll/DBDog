import React, { useEffect } from 'react';
import { Plus, Trash2, Plug, Unplug, Database } from 'lucide-react';
import { useConnectionStore } from '../../stores/connectionStore';
import { useQueryStore } from '../../stores/queryStore';
import { useTranslation } from 'react-i18next';
import type { ConnectionSummary } from '../../types/connection';

const ConnectionList: React.FC = () => {
  const { connections, loadConnections, connect, disconnect, deleteConnection, connectionStatuses } = useConnectionStore();
  const { addTab } = useQueryStore();
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

  const handleDoubleClick = async (conn: ConnectionSummary) => {
    const status = connectionStatuses[conn.id] || 'disconnected';
    const isConnected = status === 'connected';

    if (!isConnected) {
      // 如果未连接，先连接
      try {
        await connect(conn.id);
      } catch (e: any) {
        console.error('Connection failed:', e);
        return; // 连接失败，不新建查询
      }
    }

    // 连接成功后（或已经连接），新建查询标签页
    // 使用连接ID，数据库留空（让用户选择）
    addTab(conn.id);
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-4 py-3 border-b border-divider">
        <span className="text-xs font-semibold uppercase tracking-wider text-muted">
          {t('title')}
        </span>
        <button
          onClick={() => setShowDialog(true)}
          className="btn btn-ghost btn-sm flex-center"
          title={t('new_connection')}
        >
          <Plus size={18} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-3">
        {connections.length === 0 && (
          <div className="flex-col-center h-48 gap-3 text-center">
            <div className="w-12 h-12 rounded-full flex-center bg-tertiary">
              <Database size={24} className="text-tertiary" />
            </div>
            <div className="text-sm text-muted">{t('no_connections')}</div>
            <button
              onClick={() => setShowDialog(true)}
              className="btn btn-primary btn-sm mt-2"
            >
              <Plus size={16} className="mr-1.5" />
              {t('new_connection')}
            </button>
          </div>
        )}
        <div className="space-y-2">
          {connections.map((conn) => {
            const status = connectionStatuses[conn.id] || 'disconnected';
            const isConnected = status === 'connected';
            const isConnecting = status === 'connecting';

            return (
              <div
                key={conn.id}
                className="flex items-center gap-3 p-3 rounded-lg cursor-pointer group transition-all hover:bg-hover hover:shadow-sm card"
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  handleDoubleClick(conn);
                }}
              >
                <div className="relative">
                  <span
                    className="inline-block w-3 h-3 rounded-full flex-shrink-0"
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
                  {isConnected && (
                    <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-status-connected animate-pulse"></span>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <div className="text-sm font-medium truncate text-primary">{conn.name}</div>
                    <span className={`badge badge-${isConnected ? 'success' : isConnecting ? 'warning' : 'secondary'} text-xs`}>
                      {isConnected ? t('connected') : isConnecting ? t('connecting') : t('disconnected')}
                    </span>
                  </div>
                  <div className="text-xs truncate text-muted mt-0.5">
                    {conn.host}:{conn.port} • {conn.user} • {conn.db_type}
                  </div>
                </div>
                <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-all duration-200">
                  {isConnected ? (
                    <button
                      onClick={(e) => { e.stopPropagation(); handleDisconnect(conn.id); }}
                      className="btn btn-ghost btn-sm btn-danger p-1.5"
                      title={t('disconnect')}
                    >
                      <Unplug size={16} />
                    </button>
                  ) : (
                    <button
                      onClick={(e) => { e.stopPropagation(); handleConnect(conn); }}
                      className="btn btn-ghost btn-sm p-1.5"
                      disabled={isConnecting}
                      title={t('connect')}
                    >
                      <Plug size={16} className={isConnecting ? 'animate-spin' : ''} />
                    </button>
                  )}
                  <button
                    onClick={(e) => { e.stopPropagation(); handleDelete(conn.id); }}
                    className="btn btn-ghost btn-sm p-1.5"
                    title={t('delete_connection')}
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
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

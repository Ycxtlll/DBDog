import React, { useState, useEffect, useCallback } from 'react';
import { useConnectionStore } from '../../stores/connectionStore';
import { healthService } from '../../services/schemaService';
import { Activity, RefreshCw, XCircle, Users, Gauge, Settings } from 'lucide-react';

export const HealthDashboard: React.FC = () => {
  const { activeConnectionId, activeConnections } = useConnectionStore();
  const [processList, setProcessList] = useState<any[]>([]);
  const [statusVariables, setStatusVariables] = useState<{ name: string; value: string }[]>([]);
  const [systemVariables, setSystemVariables] = useState<{ name: string; value: string }[]>([]);
  const [loading, setLoading] = useState(false);

  const loadHealthData = useCallback(async () => {
    if (!activeConnectionId) return;

    setLoading(true);
    try {
      const [processes, status, system] = await Promise.all([
        healthService.getProcessList(activeConnectionId),
        healthService.getStatusVariables(activeConnectionId),
        healthService.getSystemVariables(activeConnectionId),
      ]);

      setProcessList(processes);
      setStatusVariables(status);
      setSystemVariables(system);
    } catch (e) {
      console.error('Failed to load health data', e);
    } finally {
      setLoading(false);
    }
  }, [activeConnectionId]);

  const handleKillProcess = async (processId: number) => {
    if (!activeConnectionId || !window.confirm('Kill this process?')) return;

    try {
      await healthService.killProcess(activeConnectionId, processId);
      loadHealthData();
    } catch (e) {
      console.error('Failed to kill process', e);
    }
  };

  useEffect(() => {
    if (activeConnectionId) {
      loadHealthData();
      const interval = setInterval(loadHealthData, 5000);
      return () => clearInterval(interval);
    }
  }, [activeConnectionId, loadHealthData]);

  const isConnected = activeConnectionId && activeConnections.has(activeConnectionId);

  if (!isConnected) {
    return (
      <div className="empty-state h-full">
        <div className="empty-state-icon">
          <Activity size={24} />
        </div>
        <div className="empty-state-title">Health Dashboard</div>
        <div className="empty-state-desc">Connect to a database to monitor server health</div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full" style={{ background: 'var(--bg-primary)' }}>
      <div className="panel-header">
        <div className="flex items-center gap-2">
          <Activity size={14} className="text-accent" />
          <span className="panel-title">Health Monitor</span>
        </div>
        <button
          onClick={loadHealthData}
          disabled={loading}
          className="toolbar-btn"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      <div className="flex-1 overflow-auto p-4">
        {/* Process List */}
        <div className="mb-6">
          <div className="flex items-center gap-2 mb-3">
            <Users size={14} className="text-secondary" />
            <h3 className="section-title mb-0">Process List</h3>
          </div>
          {processList.length > 0 ? (
            <div className="data-table-container">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Id</th>
                    <th>User</th>
                    <th>Host</th>
                    <th>Db</th>
                    <th>Command</th>
                    <th>Time</th>
                    <th>State</th>
                    <th>Info</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {processList.map((proc) => (
                    <tr key={proc.id}>
                      <td className="font-medium">{proc.id}</td>
                      <td>{proc.user}</td>
                      <td className="text-secondary">{proc.host}</td>
                      <td>{proc.db}</td>
                      <td>
                        <span className="badge badge-info text-[10px]">{proc.command}</span>
                      </td>
                      <td>{proc.time}s</td>
                      <td className="text-secondary">{proc.state}</td>
                      <td className="truncate max-w-[200px]" title={proc.info}>{proc.info}</td>
                      <td>
                        <button
                          onClick={() => handleKillProcess(proc.id)}
                          className="toolbar-btn p-1 text-error hover:bg-error-subtle"
                          title="Kill process"
                        >
                          <XCircle size={14} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="text-xs text-tertiary">No processes</div>
          )}
        </div>

        {/* Status Variables */}
        <div className="mb-6">
          <div className="flex items-center gap-2 mb-3">
            <Gauge size={14} className="text-secondary" />
            <h3 className="section-title mb-0">Status Variables</h3>
          </div>
          <div className="data-table-container">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Value</th>
                </tr>
              </thead>
              <tbody>
                {statusVariables.map((v) => (
                  <tr key={v.name}>
                    <td className="font-medium text-secondary">{v.name}</td>
                    <td>{v.value}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* System Variables */}
        <div>
          <div className="flex items-center gap-2 mb-3">
            <Settings size={14} className="text-secondary" />
            <h3 className="section-title mb-0">System Variables</h3>
          </div>
          <div className="data-table-container">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Value</th>
                </tr>
              </thead>
              <tbody>
                {systemVariables.map((v) => (
                  <tr key={v.name}>
                    <td className="font-medium text-secondary">{v.name}</td>
                    <td>{v.value}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
};

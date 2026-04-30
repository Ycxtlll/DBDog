import React, { useState, useEffect, useCallback } from 'react';
import { useConnectionStore } from '../../stores/connectionStore';
import { healthService } from '../../services/schemaService';

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
      <div className="flex items-center justify-center h-full" style={{ color: 'var(--text-tertiary)' }}>
        Connect to a database to view health dashboard
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full" style={{ background: 'var(--bg-primary)' }}>
      <div className="p-2 border-b" style={{ borderColor: 'var(--border-primary)' }}>
        <button
          onClick={loadHealthData}
          disabled={loading}
          className="px-3 py-1 rounded text-xs font-medium"
          style={{
            background: 'var(--accent-primary)',
            color: 'var(--text-inverse)',
            opacity: loading ? 0.5 : 1,
          }}
        >
          Refresh
        </button>
      </div>

      <div className="flex-1 overflow-auto p-4">
        <h3 className="text-sm font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>Process List</h3>
        {processList.length > 0 ? (
          <div className="overflow-x-auto mb-6">
            <table className="w-full text-xs">
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border-primary)' }}>
                  <th className="text-left p-2" style={{ color: 'var(--text-secondary)' }}>Id</th>
                  <th className="text-left p-2" style={{ color: 'var(--text-secondary)' }}>User</th>
                  <th className="text-left p-2" style={{ color: 'var(--text-secondary)' }}>Host</th>
                  <th className="text-left p-2" style={{ color: 'var(--text-secondary)' }}>Db</th>
                  <th className="text-left p-2" style={{ color: 'var(--text-secondary)' }}>Command</th>
                  <th className="text-left p-2" style={{ color: 'var(--text-secondary)' }}>Time</th>
                  <th className="text-left p-2" style={{ color: 'var(--text-secondary)' }}>State</th>
                  <th className="text-left p-2" style={{ color: 'var(--text-secondary)' }}>Info</th>
                  <th className="text-left p-2" style={{ color: 'var(--text-secondary)' }}></th>
                </tr>
              </thead>
              <tbody>
                {processList.map((proc) => (
                  <tr key={proc.id} style={{ borderBottom: '1px solid var(--border-primary)' }}>
                    <td className="p-2" style={{ color: 'var(--text-primary)' }}>{proc.id}</td>
                    <td className="p-2" style={{ color: 'var(--text-primary)' }}>{proc.user}</td>
                    <td className="p-2" style={{ color: 'var(--text-primary)' }}>{proc.host}</td>
                    <td className="p-2" style={{ color: 'var(--text-primary)' }}>{proc.db}</td>
                    <td className="p-2" style={{ color: 'var(--text-primary)' }}>{proc.command}</td>
                    <td className="p-2" style={{ color: 'var(--text-primary)' }}>{proc.time}</td>
                    <td className="p-2" style={{ color: 'var(--text-primary)' }}>{proc.state}</td>
                    <td className="p-2 truncate max-w-xs" style={{ color: 'var(--text-primary)' }}>{proc.info}</td>
                    <td className="p-2">
                      <button
                        onClick={() => handleKillProcess(proc.id)}
                        className="px-2 py-1 rounded text-xs"
                        style={{ background: 'var(--bg-tertiary)', color: 'var(--error)' }}
                      >
                        Kill
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="mb-6 text-xs" style={{ color: 'var(--text-tertiary)' }}>No processes</div>
        )}

        <h3 className="text-sm font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>Status Variables</h3>
        <div className="overflow-x-auto mb-6">
          <table className="w-full text-xs">
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border-primary)' }}>
                <th className="text-left p-2" style={{ color: 'var(--text-secondary)' }}>Name</th>
                <th className="text-left p-2" style={{ color: 'var(--text-secondary)' }}>Value</th>
              </tr>
            </thead>
            <tbody>
              {statusVariables.map((v) => (
                <tr key={v.name} style={{ borderBottom: '1px solid var(--border-primary)' }}>
                  <td className="p-2" style={{ color: 'var(--text-primary)' }}>{v.name}</td>
                  <td className="p-2" style={{ color: 'var(--text-primary)' }}>{v.value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <h3 className="text-sm font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>System Variables</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border-primary)' }}>
                <th className="text-left p-2" style={{ color: 'var(--text-secondary)' }}>Name</th>
                <th className="text-left p-2" style={{ color: 'var(--text-secondary)' }}>Value</th>
              </tr>
            </thead>
            <tbody>
              {systemVariables.map((v) => (
                <tr key={v.name} style={{ borderBottom: '1px solid var(--border-primary)' }}>
                  <td className="p-2" style={{ color: 'var(--text-primary)' }}>{v.name}</td>
                  <td className="p-2" style={{ color: 'var(--text-primary)' }}>{v.value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

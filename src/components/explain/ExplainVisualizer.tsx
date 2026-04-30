import React, { useState } from 'react';
import { useConnectionStore } from '../../stores/connectionStore';
import { queryService } from '../../services/queryService';

export const ExplainVisualizer: React.FC = () => {
  const { activeConnectionId, activeConnections } = useConnectionStore();
  const [sql, setSql] = useState('');
  const [result, setResult] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>('');

  const handleExplain = async () => {
    if (!activeConnectionId || !sql.trim()) return;

    setLoading(true);
    setError('');
    try {
      const explainSql = `EXPLAIN ${sql.trim()}`;
      const data = await queryService.execute(activeConnectionId, explainSql);
      setResult(data.rows || []);
    } catch (e: any) {
      setError(e?.toString() || 'Failed to execute EXPLAIN');
    } finally {
      setLoading(false);
    }
  };

  const isConnected = activeConnectionId && activeConnections.has(activeConnectionId);

  const getStepColor = (type: string) => {
    const lowerType = type.toLowerCase();
    if (['all', 'index'].includes(lowerType)) return 'var(--error)';
    if (['range', 'ref', 'eq_ref'].includes(lowerType)) return 'var(--warning)';
    if (['const', 'system'].includes(lowerType)) return 'var(--success)';
    return 'var(--text-secondary)';
  };

  return (
    <div className="flex flex-col h-full p-4" style={{ background: 'var(--bg-primary)' }}>
      {!isConnected ? (
        <div className="flex items-center justify-center h-full" style={{ color: 'var(--text-tertiary)' }}>
          Connect to a database to use EXPLAIN visualizer
        </div>
      ) : (
        <>
          <div className="flex gap-2 mb-4">
            <textarea
              value={sql}
              onChange={(e) => setSql(e.target.value)}
              placeholder="Enter SQL to EXPLAIN"
              className="flex-1 px-3 py-2 rounded border text-xs font-mono"
              style={{
                background: 'var(--bg-secondary)',
                color: 'var(--text-primary)',
                borderColor: 'var(--border-primary)',
                minHeight: '60px',
              }}
              onKeyDown={(e) => {
                if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                  handleExplain();
                }
              }}
            />
            <button
              onClick={handleExplain}
              disabled={loading}
              className="px-4 py-2 rounded text-xs font-medium"
              style={{
                background: 'var(--accent-primary)',
                color: 'var(--text-inverse)',
                opacity: loading ? 0.5 : 1,
              }}
            >
              EXPLAIN
            </button>
          </div>

          {error && (
            <div className="mb-4 p-3 rounded text-xs" style={{ background: 'rgba(231,76,60,0.1)', color: 'var(--error)' }}>
              {error}
            </div>
          )}

          {loading && (
            <div className="flex items-center justify-center h-full" style={{ color: 'var(--text-tertiary)' }}>
              Loading...
            </div>
          )}

          {!loading && result.length > 0 && (
            <div className="flex-1 overflow-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border-primary)' }}>
                    <th className="text-left p-2" style={{ color: 'var(--text-secondary)' }}>id</th>
                    <th className="text-left p-2" style={{ color: 'var(--text-secondary)' }}>select_type</th>
                    <th className="text-left p-2" style={{ color: 'var(--text-secondary)' }}>table</th>
                    <th className="text-left p-2" style={{ color: 'var(--text-secondary)' }}>type</th>
                    <th className="text-left p-2" style={{ color: 'var(--text-secondary)' }}>possible_keys</th>
                    <th className="text-left p-2" style={{ color: 'var(--text-secondary)' }}>key</th>
                    <th className="text-left p-2" style={{ color: 'var(--text-secondary)' }}>key_len</th>
                    <th className="text-left p-2" style={{ color: 'var(--text-secondary)' }}>ref</th>
                    <th className="text-left p-2" style={{ color: 'var(--text-secondary)' }}>rows</th>
                    <th className="text-left p-2" style={{ color: 'var(--text-secondary)' }}>Extra</th>
                  </tr>
                </thead>
                <tbody>
                  {result.map((row, i) => (
                    <tr key={i} style={{ borderBottom: '1px solid var(--border-primary)' }}>
                      <td className="p-2" style={{ color: 'var(--text-primary)' }}>{row.id}</td>
                      <td className="p-2" style={{ color: 'var(--text-primary)' }}>{row.select_type}</td>
                      <td className="p-2" style={{ color: 'var(--text-primary)' }}>{row.table}</td>
                      <td className="p-2" style={{ color: getStepColor(row.type) }}>{row.type}</td>
                      <td className="p-2" style={{ color: 'var(--text-primary)' }}>{row.possible_keys}</td>
                      <td className="p-2" style={{ color: 'var(--text-primary)' }}>{row.key}</td>
                      <td className="p-2" style={{ color: 'var(--text-primary)' }}>{row.key_len}</td>
                      <td className="p-2" style={{ color: 'var(--text-primary)' }}>{row.ref}</td>
                      <td className="p-2" style={{ color: 'var(--text-primary)' }}>{row.rows}</td>
                      <td className="p-2" style={{ color: 'var(--text-primary)' }}>{row.Extra}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
};

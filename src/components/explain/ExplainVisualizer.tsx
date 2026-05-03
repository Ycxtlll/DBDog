import React, { useState } from 'react';
import { useConnectionStore } from '../../stores/connectionStore';
import { queryService } from '../../services/queryService';
import { Play, SearchCheck, AlertTriangle, Zap } from 'lucide-react';

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

  const getStepBadge = (type: string) => {
    const lowerType = type.toLowerCase();
    if (['all', 'index'].includes(lowerType)) return 'badge-error';
    if (['range', 'ref', 'eq_ref'].includes(lowerType)) return 'badge-warning';
    if (['const', 'system'].includes(lowerType)) return 'badge-success';
    return 'badge-secondary';
  };

  if (!isConnected) {
    return (
      <div className="empty-state h-full">
        <div className="empty-state-icon">
          <SearchCheck size={24} />
        </div>
        <div className="empty-state-title">EXPLAIN Visualizer</div>
        <div className="empty-state-desc">Connect to a database to analyze query execution plans</div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full" style={{ background: 'var(--bg-primary)' }}>
      <div className="p-4" style={{ borderBottom: '1px solid var(--border-primary)' }}>
        <div className="flex gap-3">
          <textarea
            value={sql}
            onChange={(e) => setSql(e.target.value)}
            placeholder="Enter SQL to analyze..."
            className="form-textarea flex-1 font-mono text-xs min-h-[60px]"
            onKeyDown={(e) => {
              if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                handleExplain();
              }
            }}
          />
          <button
            onClick={handleExplain}
            disabled={loading || !sql.trim()}
            className="btn btn-primary btn-sm self-start"
          >
            {loading ? (
              <span className="animate-spin mr-1.5">⟳</span>
            ) : (
              <Play size={14} className="mr-1.5" />
            )}
            EXPLAIN
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-4">
        {error && (
          <div className="alert alert-error mb-4">
            <AlertTriangle size={14} />
            {error}
          </div>
        )}

        {loading && (
          <div className="empty-state">
            <div className="animate-spin text-tertiary">⟳</div>
            <div className="empty-state-title">Analyzing...</div>
          </div>
        )}

        {!loading && result.length > 0 && (
          <div className="data-table-container">
            <table className="data-table">
              <thead>
                <tr>
                  <th>id</th>
                  <th>select_type</th>
                  <th>table</th>
                  <th>type</th>
                  <th>possible_keys</th>
                  <th>key</th>
                  <th>key_len</th>
                  <th>ref</th>
                  <th>rows</th>
                  <th>Extra</th>
                </tr>
              </thead>
              <tbody>
                {result.map((row, i) => (
                  <tr key={i}>
                    <td>{row.id}</td>
                    <td>{row.select_type}</td>
                    <td className="font-medium">{row.table}</td>
                    <td>
                      <span className={`badge ${getStepBadge(row.type)} text-[10px]`}>
                        {row.type}
                      </span>
                    </td>
                    <td className="text-secondary">{row.possible_keys}</td>
                    <td className="font-medium">{row.key}</td>
                    <td>{row.key_len}</td>
                    <td className="text-secondary">{row.ref}</td>
                    <td>{row.rows}</td>
                    <td className="text-secondary">{row.Extra}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {!loading && result.length === 0 && !error && (
          <div className="empty-state">
            <div className="empty-state-icon">
              <Zap size={20} />
            </div>
            <div className="empty-state-title">Ready to analyze</div>
            <div className="empty-state-desc">Enter a SQL query and click EXPLAIN to see the execution plan</div>
          </div>
        )}
      </div>
    </div>
  );
};

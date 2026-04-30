import React, { useState, useEffect } from 'react';
import { useConnectionStore } from '../../stores/connectionStore';
import { diffService } from '../../services/diffService';
import type { DatabaseSnapshot } from '../../types/diff';

export const SchemaDiffView: React.FC = () => {
  const { activeConnectionId } = useConnectionStore();
  const [snapshots, setSnapshots] = useState<DatabaseSnapshot[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (activeConnectionId) {
      loadSnapshots();
    }
  }, [activeConnectionId]);

  const loadSnapshots = async () => {
    if (!activeConnectionId) {
      setSnapshots([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const list = await diffService.listSnapshots(activeConnectionId!);
      setSnapshots(list);
    } catch (e) {
      console.error('Failed to load snapshots', e);
    } finally {
      setLoading(false);
    }
  };

  const handleCapture = async () => {
    if (!activeConnectionId) return;
    // TODO: need to select database
    alert('Not implemented yet');
  };

  if (!activeConnectionId) {
    return (
      <div className="flex items-center justify-center h-full" style={{ color: 'var(--text-tertiary)' }}>
        Connect to a database to use schema diff
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full" style={{ background: 'var(--bg-primary)' }}>
      <div className="p-2 border-b" style={{ borderColor: 'var(--border-primary)' }}>
        <button
          onClick={handleCapture}
          className="px-3 py-1 rounded text-xs font-medium"
          style={{ background: 'var(--accent-primary)', color: 'var(--text-inverse)' }}
        >
          Capture Snapshot
        </button>
      </div>
      <div className="flex-1 overflow-auto p-4">
        <h3 className="text-sm font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>Snapshots</h3>
        {loading ? (
          <div>Loading...</div>
        ) : snapshots.length > 0 ? (
          <div className="space-y-2">
            {snapshots.map(snap => (
              <div key={snap.id} className="p-2 border rounded" style={{ borderColor: 'var(--border-primary)' }}>
                <div className="font-medium">{snap.database_name}</div>
                <div className="text-xs" style={{ color: 'var(--text-secondary)' }}>{snap.captured_at}</div>
              </div>
            ))}
          </div>
        ) : (
          <div style={{ color: 'var(--text-tertiary)' }}>No snapshots captured yet.</div>
        )}
      </div>
    </div>
  );
};
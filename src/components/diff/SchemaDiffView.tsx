import React, { useState, useEffect } from 'react';
import { useConnectionStore } from '../../stores/connectionStore';
import { diffService } from '../../services/diffService';
import type { DatabaseSnapshot } from '../../types/diff';
import { GitCompare, Camera, Clock, Database, AlertCircle } from 'lucide-react';

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
    alert('Not implemented yet');
  };

  if (!activeConnectionId) {
    return (
      <div className="empty-state h-full">
        <div className="empty-state-icon">
          <GitCompare size={24} />
        </div>
        <div className="empty-state-title">Schema Diff</div>
        <div className="empty-state-desc">Connect to a database to compare schema snapshots</div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full" style={{ background: 'var(--bg-primary)' }}>
      <div className="panel-header">
        <div className="flex items-center gap-2">
          <GitCompare size={14} className="text-accent" />
          <span className="panel-title">Schema Diff</span>
        </div>
        <button
          onClick={handleCapture}
          className="btn btn-primary btn-sm"
        >
          <Camera size={14} className="mr-1.5" />
          Capture Snapshot
        </button>
      </div>

      <div className="flex-1 overflow-auto p-4">
        {loading ? (
          <div className="empty-state">
            <div className="animate-spin text-tertiary">⟳</div>
            <div className="empty-state-title">Loading snapshots...</div>
          </div>
        ) : snapshots.length > 0 ? (
          <div className="space-y-2">
            {snapshots.map(snap => (
              <div key={snap.id} className="card p-4 flex items-center gap-3 cursor-pointer hover:border-accent transition-colors">
                <div className="w-10 h-10 rounded-lg flex-center bg-accent-subtle flex-shrink-0">
                  <Database size={18} className="text-accent" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-primary text-sm">{snap.database_name}</div>
                  <div className="flex items-center gap-1 text-tertiary text-[11px] mt-0.5">
                    <Clock size={10} />
                    {snap.captured_at}
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="empty-state">
            <div className="empty-state-icon">
              <AlertCircle size={20} />
            </div>
            <div className="empty-state-title">No snapshots yet</div>
            <div className="empty-state-desc">Capture a snapshot to start tracking schema changes</div>
          </div>
        )}
      </div>
    </div>
  );
};

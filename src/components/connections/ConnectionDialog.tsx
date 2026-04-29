import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import { connectionService } from '../../services/connectionService';
import { useConnectionStore } from '../../stores/connectionStore';
import type { ConnectionConfig } from '../../types/connection';

interface Props {
  onClose: () => void;
}

const ConnectionDialog: React.FC<Props> = ({ onClose }) => {
  const { t } = useTranslation('connections');
  const { loadConnections } = useConnectionStore();

  const [form, setForm] = useState<Partial<ConnectionConfig>>({
    name: '',
    db_type: 'mysql',
    host: '127.0.0.1',
    port: 3306,
    user: 'root',
    password: '',
    database: '',
  });
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const [saving, setSaving] = useState(false);

  const update = (key: string, value: string | number) => {
    setForm((f) => ({ ...f, [key]: value }));
    setTestResult(null);
  };

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const config = form as ConnectionConfig;
      config.id = '__test__';
      await connectionService.test(config);
      setTestResult({ ok: true, msg: t('test_success') });
    } catch (e: any) {
      setTestResult({ ok: false, msg: e?.toString() || t('test_failed') });
    } finally {
      setTesting(false);
    }
  };

  const handleSave = async () => {
    if (!form.name || !form.host) return;
    setSaving(true);
    try {
      const config: ConnectionConfig = {
        id: '',
        name: form.name || '',
        db_type: form.db_type || 'mysql',
        host: form.host || '127.0.0.1',
        port: form.port || 3306,
        user: form.user || 'root',
        password: form.password || '',
        database: form.database || undefined,
        max_connections: 5,
      };
      await connectionService.save(config);
      await loadConnections();
      onClose();
    } catch (e) {
      console.error('Save failed:', e);
    } finally {
      setSaving(false);
    }
  };

  const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: '6px 8px',
    background: 'var(--bg-input)',
    color: 'var(--text-primary)',
    border: '1px solid var(--border-primary)',
    borderRadius: 4,
    fontSize: 13,
    outline: 'none',
  };

  return (
    <div
      className="fixed inset-0 flex items-center justify-center z-50"
      style={{ background: 'var(--bg-overlay)' }}
      onClick={onClose}
    >
      <div
        className="rounded-lg shadow-lg w-full max-w-md"
        style={{ background: 'var(--bg-primary)', border: '1px solid var(--border-primary)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: '1px solid var(--border-primary)' }}>
          <h3 className="text-sm font-semibold">{t('new_connection')}</h3>
          <button
            onClick={onClose}
            className="flex items-center justify-center w-6 h-6 rounded cursor-pointer border-none"
            style={{ background: 'transparent', color: 'var(--text-secondary)' }}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-hover)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
          >
            <X size={16} />
          </button>
        </div>

        <div className="px-4 py-3 space-y-3">
          <div>
            <label className="block text-xs mb-1" style={{ color: 'var(--text-secondary)' }}>{t('name')}</label>
            <input style={inputStyle} value={form.name} onChange={(e) => update('name', e.target.value)} placeholder="My Database" />
          </div>

          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-xs mb-1" style={{ color: 'var(--text-secondary)' }}>{t('host')}</label>
              <input style={inputStyle} value={form.host} onChange={(e) => update('host', e.target.value)} />
            </div>
            <div style={{ width: 80 }}>
              <label className="block text-xs mb-1" style={{ color: 'var(--text-secondary)' }}>{t('port')}</label>
              <input style={inputStyle} type="number" value={form.port} onChange={(e) => update('port', parseInt(e.target.value) || 3306)} />
            </div>
          </div>

          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-xs mb-1" style={{ color: 'var(--text-secondary)' }}>{t('user')}</label>
              <input style={inputStyle} value={form.user} onChange={(e) => update('user', e.target.value)} />
            </div>
            <div className="flex-1">
              <label className="block text-xs mb-1" style={{ color: 'var(--text-secondary)' }}>{t('password')}</label>
              <input style={inputStyle} type="password" value={form.password} onChange={(e) => update('password', e.target.value)} />
            </div>
          </div>

          <div>
            <label className="block text-xs mb-1" style={{ color: 'var(--text-secondary)' }}>{t('database')} (optional)</label>
            <input style={inputStyle} value={form.database || ''} onChange={(e) => update('database', e.target.value)} />
          </div>

          {testResult && (
            <div
              className="text-xs px-2 py-1.5 rounded"
              style={{
                background: testResult.ok ? 'rgba(46,204,113,0.1)' : 'rgba(231,76,60,0.1)',
                color: testResult.ok ? 'var(--success)' : 'var(--error)',
              }}
            >
              {testResult.msg}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 px-4 py-3" style={{ borderTop: '1px solid var(--border-primary)' }}>
          <button
            onClick={handleTest}
            disabled={testing}
            className="px-3 py-1.5 rounded text-xs font-medium transition-colors cursor-pointer border-none"
            style={{ background: 'var(--bg-tertiary)', color: 'var(--text-primary)' }}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-hover)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--bg-tertiary)'; }}
          >
            {testing ? '...' : t('test_connection')}
          </button>
          <button
            onClick={handleSave}
            disabled={saving || !form.name}
            className="px-3 py-1.5 rounded text-xs font-medium transition-colors cursor-pointer border-none"
            style={{ background: 'var(--accent-primary)', color: 'var(--text-inverse)' }}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--accent-hover)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--accent-primary)'; }}
          >
            {saving ? '...' : t('save')}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ConnectionDialog;

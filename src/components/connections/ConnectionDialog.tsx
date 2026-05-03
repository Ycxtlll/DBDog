import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { X, TestTube, Save, Server, Database, KeyRound, Hash, Globe } from 'lucide-react';
import { connectionService } from '../../services/connectionService';
import { useConnectionStore } from '../../stores/connectionStore';
import type { ConnectionConfig } from '../../types/connection';

interface Props {
  onClose: () => void;
}

const ConnectionDialog: React.FC<Props> = ({ onClose }) => {
  const { t } = useTranslation(['connections', 'common']);
  const { loadConnections, connect } = useConnectionStore();

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
  const [saveError, setSaveError] = useState<string | null>(null);
  const saveButtonRef = useRef<HTMLButtonElement>(null);

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

  const handleSave = useCallback(async () => {
    if (!form.name || !form.host) return;
    setSaving(true);
    setSaveError(null);
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
      const newConnectionId = await connectionService.save(config);
      await loadConnections();
      try {
        await connect(newConnectionId);
      } catch (connectError) {
        console.warn('Auto-connect failed:', connectError);
      }
      onClose();
    } catch (e: any) {
      console.error('Save failed:', e);
      setSaveError(e?.toString() || '保存连接失败，请检查后重试');
    } finally {
      setSaving(false);
    }
  }, [form, loadConnections, connect, onClose]);

  useEffect(() => {
    if (testResult?.ok && saveButtonRef.current) {
      saveButtonRef.current.focus();
    }
  }, [testResult]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        if (form.name && form.host && !saving) {
          handleSave();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [form.name, form.host, saving, handleSave]);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-container" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="flex items-center gap-2">
            <Server size={18} className="text-accent" />
            <h3>{t('new_connection')}</h3>
          </div>
          <button
            onClick={onClose}
            className="btn btn-ghost btn-sm p-1"
            title={t('common:close')}
          >
            <X size={18} />
          </button>
        </div>

        <div className="modal-body space-y-4">
          <div className="form-group">
            <label className="form-label">{t('name')}</label>
            <div className="relative">
              <Database size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-tertiary" />
              <input
                className="form-input pl-8"
                value={form.name}
                onChange={(e) => update('name', e.target.value)}
                placeholder="My Database"
              />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="form-group col-span-2">
              <label className="form-label">{t('host')}</label>
              <div className="relative">
                <Globe size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-tertiary" />
                <input
                  className="form-input pl-8"
                  value={form.host}
                  onChange={(e) => update('host', e.target.value)}
                  placeholder="127.0.0.1"
                />
              </div>
            </div>
            <div className="form-group">
              <label className="form-label">{t('port')}</label>
              <div className="relative">
                <Hash size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-tertiary" />
                <input
                  className="form-input pl-8"
                  type="number"
                  value={form.port}
                  onChange={(e) => update('port', parseInt(e.target.value) || 3306)}
                />
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="form-group">
              <label className="form-label">{t('user')}</label>
              <div className="relative">
                <KeyRound size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-tertiary" />
                <input
                  className="form-input pl-8"
                  value={form.user}
                  onChange={(e) => update('user', e.target.value)}
                  placeholder="root"
                />
              </div>
            </div>
            <div className="form-group">
              <label className="form-label">{t('password')}</label>
              <input
                className="form-input"
                type="password"
                value={form.password}
                onChange={(e) => update('password', e.target.value)}
                placeholder="••••••••"
              />
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">
              {t('database')} <span className="optional">(optional)</span>
            </label>
            <input
              className="form-input"
              value={form.database || ''}
              onChange={(e) => update('database', e.target.value)}
              placeholder="Leave empty for all databases"
            />
          </div>

          {testResult && (
            <div className={`alert ${testResult.ok ? 'alert-success' : 'alert-error'}`}>
              <div className={`alert-dot ${testResult.ok ? 'bg-success' : 'bg-error'}`} />
              {testResult.msg}
            </div>
          )}

          {saveError && (
            <div className="alert alert-error">
              <div className="alert-dot bg-error" />
              {saveError}
            </div>
          )}
        </div>

        <div className="modal-footer">
          <div className="text-xs text-muted mr-auto">
            {form.name ? t('connections:creating_connection', { name: form.name }) : t('connections:enter_connection_details')}
          </div>
          <button
            onClick={handleTest}
            disabled={testing}
            className="btn btn-secondary btn-sm"
          >
            {testing ? (
              <>
                <span className="animate-spin mr-1.5">⟳</span>
                {t('testing')}
              </>
            ) : (
              <>
                <TestTube size={14} className="mr-1.5" />
                {t('test_connection')}
              </>
            )}
          </button>
          <button
            ref={saveButtonRef}
            onClick={handleSave}
            disabled={saving || !form.name}
            className="btn btn-primary btn-sm"
          >
            {saving ? (
              <>
                <span className="animate-spin mr-1.5">⟳</span>
                {t('saving')}
              </>
            ) : (
              <>
                <Save size={14} className="mr-1.5" />
                {t('save')}
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ConnectionDialog;

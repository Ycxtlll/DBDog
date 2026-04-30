import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
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
      // 尝试自动连接新创建的连接
      try {
        await connect(newConnectionId);
      } catch (connectError) {
        console.warn('Auto-connect failed:', connectError);
        // 连接失败不影响保存，继续关闭对话框
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
      // 测试成功时自动聚焦到保存按钮
      saveButtonRef.current.focus();
    }
  }, [testResult]);

  // 键盘快捷键：Ctrl+S保存
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
    <div
      className="fixed inset-0 flex items-center justify-center z-50 bg-overlay/90"
      onClick={onClose}
    >
      <div
        className="rounded-lg shadow-xl w-full max-w-md bg-card border border-primary elevation-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-divider">
          <h3 className="text-sm font-semibold text-primary">{t('new_connection')}</h3>
          <button
            onClick={onClose}
            className="btn btn-ghost btn-sm p-1"
            title={t('common:close')}
          >
            <X size={18} />
          </button>
        </div>

        <div className="px-5 py-4 space-y-5">
          <div>
            <label className="block text-xs font-medium mb-2.5 text-secondary uppercase tracking-wide">{t('name')}</label>
            <input
              className="input w-full"
              value={form.name}
              onChange={(e) => update('name', e.target.value)}
              placeholder="My Database"
            />
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2">
              <label className="block text-xs font-medium mb-2.5 text-secondary uppercase tracking-wide">{t('host')}</label>
              <input
                className="input w-full"
                value={form.host}
                onChange={(e) => update('host', e.target.value)}
                placeholder="127.0.0.1"
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-2.5 text-secondary uppercase tracking-wide">{t('port')}</label>
              <input
                className="input w-full"
                type="number"
                value={form.port}
                onChange={(e) => update('port', parseInt(e.target.value) || 3306)}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium mb-2.5 text-secondary uppercase tracking-wide">{t('user')}</label>
              <input
                className="input w-full"
                value={form.user}
                onChange={(e) => update('user', e.target.value)}
                placeholder="root"
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-2.5 text-secondary uppercase tracking-wide">{t('password')}</label>
              <input
                className="input w-full"
                type="password"
                value={form.password}
                onChange={(e) => update('password', e.target.value)}
                placeholder="••••••••"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium mb-2.5 text-secondary uppercase tracking-wide">
              {t('database')} <span className="text-tertiary font-normal">(optional)</span>
            </label>
            <input
              className="input w-full"
              value={form.database || ''}
              onChange={(e) => update('database', e.target.value)}
              placeholder="Leave empty for all databases"
            />
          </div>

          {testResult && (
            <div className={`p-3 rounded-lg text-sm ${testResult.ok ? 'bg-success-subtle text-success' : 'bg-error-subtle text-error'}`}>
              <div className="flex items-center gap-2">
                <div className={`w-2 h-2 rounded-full ${testResult.ok ? 'bg-success' : 'bg-error'}`}></div>
                {testResult.msg}
              </div>
            </div>
          )}

          {saveError && (
            <div className="p-3 rounded-lg text-sm bg-error-subtle text-error">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-error"></div>
                {saveError}
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between px-5 py-4 border-t border-divider bg-secondary">
          <div className="text-xs text-muted">
            {form.name ? t('connections:creating_connection', { name: form.name }) : t('connections:enter_connection_details')}
          </div>
          <div className="flex items-center gap-3">
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
                t('test_connection')
              )}
            </button>
            <button
              ref={saveButtonRef}
              onClick={handleSave}
              disabled={saving || !form.name}
              className="btn btn-primary btn-sm"
            >
              {saving ? t('saving') : t('save')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ConnectionDialog;

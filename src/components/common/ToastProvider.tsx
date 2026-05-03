import React from 'react';
import { useToastStore } from '../../stores/toastStore';
import { X, CheckCircle, AlertCircle, AlertTriangle, Info } from 'lucide-react';

const icons = {
  success: CheckCircle,
  error: AlertCircle,
  warning: AlertTriangle,
  info: Info,
};

const toastStyles = {
  success: { background: 'var(--success-subtle)', color: 'var(--success)', border: 'var(--success)' },
  error: { background: 'var(--error-subtle)', color: 'var(--error)', border: 'var(--error)' },
  warning: { background: 'var(--warning-subtle)', color: 'var(--warning)', border: 'var(--warning)' },
  info: { background: 'var(--accent-subtle)', color: 'var(--accent-primary)', border: 'var(--accent-primary)' },
};

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { toasts, removeToast } = useToastStore();

  return (
    <>
      {children}
      <div className="fixed top-4 right-4 z-[100] flex flex-col gap-2 pointer-events-none">
        {toasts.map((toast) => {
          const Icon = icons[toast.type];
          const style = toastStyles[toast.type];
          return (
            <div
              key={toast.id}
              className="pointer-events-auto flex items-center gap-2.5 px-4 py-2.5 rounded-lg shadow-lg border text-sm font-medium"
              style={{
                background: style.background,
                color: style.color,
                borderColor: style.border,
                borderWidth: '1px',
                minWidth: 200,
                maxWidth: 360,
                animation: 'toastIn 0.25s ease-out',
              }}
            >
              <Icon size={16} className="flex-shrink-0" />
              <span className="flex-1">{toast.message}</span>
              <button
                onClick={() => removeToast(toast.id)}
                className="flex-shrink-0 opacity-70 hover:opacity-100 transition-opacity"
                aria-label="Dismiss"
              >
                <X size={14} />
              </button>
            </div>
          );
        })}
      </div>
    </>
  );
};

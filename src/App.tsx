import React, { useEffect } from 'react';
import AppLayout from './components/layout/AppLayout';
import { useUIStore } from './stores/uiStore';
import { ErrorBoundary } from './components/common/ErrorBoundary';
import { ToastProvider } from './components/common/ToastProvider';

const App: React.FC = () => {
  const theme = useUIStore((s) => s.theme);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  return (
    <ErrorBoundary>
      <ToastProvider>
        <AppLayout />
      </ToastProvider>
    </ErrorBoundary>
  );
};

export default App;

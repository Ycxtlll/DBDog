import React, { useEffect } from 'react';
import AppLayout from './components/layout/AppLayout';
import { useUIStore } from './stores/uiStore';

const App: React.FC = () => {
  const theme = useUIStore((s) => s.theme);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  return <AppLayout />;
};

export default App;

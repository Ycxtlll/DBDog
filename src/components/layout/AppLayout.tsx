import React from 'react';
import ActivityBar from './ActivityBar';
import Sidebar from './Sidebar';
import StatusBar from './StatusBar';
import EditorPanel from '../editor/EditorPanel';

const AppLayout: React.FC = () => {
  return (
    <div className="flex flex-col h-full w-full" style={{ background: 'var(--bg-primary)' }}>
      <div className="flex flex-1 overflow-hidden">
        <ActivityBar />
        <Sidebar />
        <EditorPanel />
      </div>
      <StatusBar />
    </div>
  );
};

export default AppLayout;

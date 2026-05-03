import React, { Component, type ReactNode } from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error?: Error;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('ErrorBoundary caught an error:', error, errorInfo);
  }

  handleReset = () => {
    this.setState({ hasError: false, error: undefined });
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex items-center justify-center h-screen w-screen" style={{ background: 'var(--bg-primary)' }}>
          <div className="empty-state">
            <div className="empty-state-icon" style={{ background: 'var(--error-subtle)', color: 'var(--error)' }}>
              <AlertTriangle size={24} />
            </div>
            <div className="empty-state-title" style={{ color: 'var(--error)' }}>
              Something went wrong
            </div>
            <div className="empty-state-desc" style={{ maxWidth: 360 }}>
              {this.state.error?.message || 'An unexpected error occurred. Please reload the application.'}
            </div>
            <button onClick={this.handleReset} className="btn btn-primary btn-sm mt-2">
              <RotateCcw size={14} className="mr-1.5" />
              Reload Application
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

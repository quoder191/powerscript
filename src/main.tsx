import { Component, type ErrorInfo, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';

interface BoundaryState {
  error: Error | null;
}

class RootErrorBoundary extends Component<{ children: ReactNode }, BoundaryState> {
  public state: BoundaryState = { error: null };

  public static getDerivedStateFromError(error: Error): BoundaryState {
    return { error };
  }

  public componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('PowerScript IDE error:', error, info);
  }

  public render(): ReactNode {
    if (this.state.error) {
      return (
        <div className="min-h-screen flex items-center justify-center p-6 bg-slate-950 text-slate-100">
          <div className="max-w-lg w-full p-6 rounded-lg border border-red-800 bg-slate-900 space-y-4">
            <h1 className="text-base font-semibold text-red-400">
              Runtime Error in Playground UI
            </h1>
            <pre className="p-3 rounded bg-slate-950 text-xs font-mono text-red-300 overflow-x-auto whitespace-pre-wrap">
              {this.state.error.message}
            </pre>
            <button
              type="button"
              onClick={() => this.setState({ error: null })}
              className="px-4 py-2 text-xs font-semibold rounded-md bg-emerald-600 hover:bg-emerald-700 text-white cursor-pointer"
            >
              Reload Workspace
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

createRoot(document.getElementById('root')!).render(
  <RootErrorBoundary>
    <App />
  </RootErrorBoundary>
);

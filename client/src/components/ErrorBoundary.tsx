import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ErrorBoundary]', error, info.componentStack);
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;

      return (
        <div className="min-h-screen bg-noir-black flex items-center justify-center px-6">
          <div className="glass-panel p-10 max-w-md w-full text-center space-y-5 animate-slide-up">
            <div className="text-5xl">💀</div>
            <h2 className="font-display text-2xl text-noir-white">Something went wrong</h2>
            <p className="font-mono text-xs text-noir-ash bg-noir-graphite rounded-lg p-3 text-left break-words">
              {this.state.error?.message ?? 'Unknown error'}
            </p>
            <button
              onClick={this.handleReset}
              className="btn-noir btn-gold w-full py-3"
            >
              Try Again
            </button>
            <button
              onClick={() => window.location.reload()}
              className="btn-noir w-full py-2 text-sm"
            >
              Reload Page
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

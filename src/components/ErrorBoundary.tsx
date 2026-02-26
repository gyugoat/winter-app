import { Component } from 'react';
import type { ReactNode, ErrorInfo } from 'react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

/**
 * React Error Boundary — catches render errors in child components.
 * Place at App root (catch-all) and around risky subtrees (chat content, file viewer).
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ErrorBoundary] Caught render error:', error, info.componentStack);
  }

  componentDidMount() {
    this.handleRejection = this.handleRejection.bind(this);
    window.addEventListener('unhandledrejection', this.handleRejection);
  }

  componentWillUnmount() {
    window.removeEventListener('unhandledrejection', this.handleRejection);
  }

  private handleRejection(e: PromiseRejectionEvent) {
    console.error('[winter-app] Unhandled promise rejection:', e.reason);
  }

  private handleReload = () => {
    window.location.reload();
  };

  private handleDismiss = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;

      return (
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100%',
          padding: '2rem',
          gap: '1rem',
          color: 'var(--text-primary, #e0e0e0)',
          background: 'var(--bg-primary, #1a1a2e)',
          fontFamily: 'var(--font-family, monospace)',
        }}>
          <div style={{ fontSize: '1.2rem', fontWeight: 600 }}>
            문제가 발생했습니다
          </div>
          <div style={{
            fontSize: '0.85rem',
            color: 'var(--text-secondary, #888)',
            maxWidth: '400px',
            textAlign: 'center',
            lineHeight: 1.5,
          }}>
            {this.state.error?.message || 'An unexpected error occurred.'}
          </div>
          <div style={{ display: 'flex', gap: '0.75rem', marginTop: '0.5rem' }}>
            <button
              onClick={this.handleReload}
              style={{
                padding: '0.5rem 1.25rem',
                border: '1px solid var(--border-color, #333)',
                borderRadius: '6px',
                background: 'var(--bg-secondary, #252540)',
                color: 'var(--text-primary, #e0e0e0)',
                cursor: 'pointer',
                fontSize: '0.85rem',
              }}
            >
              새로고침
            </button>
            <button
              onClick={this.handleDismiss}
              style={{
                padding: '0.5rem 1.25rem',
                border: '1px solid var(--border-color, #333)',
                borderRadius: '6px',
                background: 'transparent',
                color: 'var(--text-secondary, #888)',
                cursor: 'pointer',
                fontSize: '0.85rem',
              }}
            >
              무시
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

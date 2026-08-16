import React from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

interface ErrorBoundaryProps {
  children: React.ReactNode;
  /** Short label for what this boundary guards, shown in the fallback and console log. */
  section?: string;
}

interface ErrorBoundaryState {
  error: Error | null;
}

/**
 * Catches render-time crashes so one malformed report/cluster can never blank the whole
 * dashboard mid-demo — this is a real risk given live external data feeds live text straight
 * into the UI. Falls back to a small on-brand notice with a reset action instead of a white
 * screen. Wrap independent sections (card grid, detail panel, map) separately so a crash in one
 * doesn't take down the others.
 */
export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error(`[ErrorBoundary${this.props.section ? `: ${this.props.section}` : ''}]`, error, info.componentStack);
  }

  private reset = () => this.setState({ error: null });

  render() {
    if (this.state.error) {
      return (
        <div
          role="alert"
          className="flex flex-col items-center justify-center gap-3 p-8 text-center bg-[#FFFFFF] border border-[#E4E7EC] rounded-xl m-4 font-sans-ui"
        >
          <AlertTriangle className="w-8 h-8 text-[#DC2626]" aria-hidden="true" />
          <div>
            <h3 className="text-sm font-bold text-[#14181F] uppercase">
              {this.props.section ? `${this.props.section} failed to render` : 'Something went wrong'}
            </h3>
            <p className="text-xs text-[#6B7280] mt-1 max-w-xs">
              This section hit an unexpected error. The rest of the dashboard is unaffected.
            </p>
          </div>
          <button
            onClick={this.reset}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-[#1E3A5F] text-white text-xs font-semibold rounded hover:bg-[#152a45] transition-colors cursor-pointer"
          >
            <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Retry</span>
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}

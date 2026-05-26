import { Component } from "react";
import type { ReactNode, ErrorInfo } from "react";
import { PALETTE } from "../theme";

interface Props {
  children: ReactNode;
  fallbackLabel?: string;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("ErrorBoundary caught:", error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div
          style={{
            padding: 16,
            background: "rgba(184,92,92,0.08)",
            border: `1px solid ${PALETTE.rose}`,
            borderRadius: 8,
            fontSize: 13,
          }}
        >
          <div style={{ color: PALETTE.rose, fontWeight: 600, marginBottom: 8 }}>
            {this.props.fallbackLabel || "Render error"}
          </div>
          <pre
            style={{
              fontSize: 12,
              color: PALETTE.inkLight,
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
            }}
          >
            {this.state.error.message}
          </pre>
          <button
            onClick={() => this.setState({ error: null })}
            style={{
              marginTop: 8,
              padding: "4px 12px",
              background: PALETTE.rose,
              color: PALETTE.white,
              border: "none",
              borderRadius: 4,
              fontSize: 12,
              cursor: "pointer",
            }}
          >
            Retry
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

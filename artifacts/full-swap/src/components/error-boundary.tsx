import { Component, type ReactNode } from "react";

interface Props { children: ReactNode; }
interface State { error: Error | null; }

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  render() {
    const { error } = this.state;
    if (error) {
      return (
        <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#0a0a0f", padding: "2rem" }}>
          <div style={{ maxWidth: 600, width: "100%", background: "#1a1a2e", border: "1px solid #ef4444", borderRadius: 12, padding: "2rem" }}>
            <h1 style={{ color: "#ef4444", fontSize: "1.25rem", fontWeight: 700, marginBottom: "0.5rem" }}>Something went wrong</h1>
            <p style={{ color: "#94a3b8", fontSize: "0.875rem", marginBottom: "1rem" }}>The page crashed with the following error. Please screenshot this and share it for debugging.</p>
            <pre style={{ background: "#0a0a0f", border: "1px solid #334155", borderRadius: 8, padding: "1rem", color: "#f87171", fontSize: "0.75rem", whiteSpace: "pre-wrap", wordBreak: "break-word", overflowY: "auto", maxHeight: 300 }}>
              {error.name}: {error.message}
              {"\n\n"}
              {error.stack}
            </pre>
            <button
              onClick={() => { this.setState({ error: null }); window.location.href = "/admin"; }}
              style={{ marginTop: "1rem", padding: "0.5rem 1.25rem", background: "#ef4444", color: "#fff", border: "none", borderRadius: 8, cursor: "pointer", fontSize: "0.875rem", fontWeight: 600 }}
            >
              Go back to login
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

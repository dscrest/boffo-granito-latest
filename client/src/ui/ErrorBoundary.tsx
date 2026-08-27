/* Route-level error boundary. Without one, a render crash in any page
   unmounts the entire React tree — every subsequent navigation shows a
   blank screen until a full reload. Keyed by route in App.tsx so moving
   to another page automatically retries with a fresh boundary. */
import { Component, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error("Page crashed:", error);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="card" style={{ margin: 24, padding: 24 }}>
          <div style={{ fontWeight: 600, marginBottom: 6 }}>This page hit an error.</div>
          <div className="muted mono" style={{ fontSize: 14, marginBottom: 14 }}>
            {this.state.error.message}
          </div>
          <button className="btn" onClick={() => this.setState({ error: null })}>
            Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

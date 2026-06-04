import { Component, type ReactNode } from "react"
import { AlertTriangle, RotateCcw } from "lucide-react"

interface Props {
  children: ReactNode
  fallbackLabel?: string
}

interface State {
  hasError: boolean
  error: Error | null
}

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("[ErrorBoundary]", error, info.componentStack)
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed p-8" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
          <AlertTriangle size={32} style={{ color: "var(--rose)" }} />
          <p className="text-[14px] font-semibold text-center" style={{ color: "var(--text-2)" }}>
            {this.props.fallbackLabel ?? "Something went wrong"}
          </p>
          <p className="text-[12px] text-center max-w-xs" style={{ color: "var(--text-3)" }}>
            {this.state.error?.message}
          </p>
          <button
            type="button"
            onClick={() => this.setState({ hasError: false, error: null })}
            className="flex items-center gap-1.5 rounded-lg border px-3 py-2 text-[12px] font-bold transition hover:opacity-80"
            style={{ borderColor: "var(--border)", color: "var(--text-2)", background: "var(--surface-2)" }}
          >
            <RotateCcw size={13} />
            Try again
          </button>
        </div>
      )
    }

    return this.props.children
  }
}

import { Component, type ErrorInfo, type ReactNode } from "react"

type Props = {
  children: ReactNode
  fallback?: ReactNode
}

type State = {
  hasError: boolean
  error: Error | null
}

function ErrorFallback({
  error,
  onReset,
}: {
  error: Error | null
  onReset: () => void
}) {
  return (
    <main className="flex flex-1 items-center justify-center bg-page p-6">
      <div className="max-w-md rounded-lg border border-rose-200 bg-white p-6 text-center shadow-sm">
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mx-auto text-rose-500"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
        <h2 className="mt-3 text-xl font-bold text-zinc-950">Something went wrong</h2>
        <p className="mt-2 text-sm text-zinc-500">
          {error?.message ?? "An unexpected error occurred"}
        </p>
        <button
          type="button"
          onClick={onReset}
          className="mt-5 rounded-lg bg-zinc-950 px-5 py-2.5 text-sm font-bold text-white transition hover:bg-zinc-800"
        >
          Try again
        </button>
      </div>
    </main>
  )
}

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[ErrorBoundary]", error, info.componentStack)
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback
      return (
        <ErrorFallback
          error={this.state.error}
          onReset={() => this.setState({ hasError: false, error: null })}
        />
      )
    }
    return this.props.children
  }
}

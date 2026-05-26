import { Component, type ErrorInfo, type ReactNode } from "react"

type Props = {
  children: ReactNode
  fallback?: ReactNode
}

type State = {
  hasError: boolean
  error: Error | null
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
      if (this.props.fallback) {
        return this.props.fallback
      }

      return (
        <main className="flex flex-1 items-center justify-center bg-[#eef3f2] p-6">
          <div className="max-w-md rounded-lg border border-rose-200 bg-white p-6 text-center shadow-sm">
            <p className="text-4xl">!</p>
            <h2 className="mt-3 text-xl font-bold text-zinc-950">
              Something went wrong
            </h2>
            <p className="mt-2 text-sm text-zinc-500">
              {this.state.error?.message ?? "An unexpected error occurred."}
            </p>
            <button
              type="button"
              onClick={() => this.setState({ hasError: false, error: null })}
              className="mt-5 rounded-lg bg-zinc-950 px-5 py-2.5 text-sm font-bold text-white transition hover:bg-zinc-800"
            >
              Try again
            </button>
          </div>
        </main>
      )
    }

    return this.props.children
  }
}

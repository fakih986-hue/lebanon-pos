import { Component, type ErrorInfo, type ReactNode } from "react"
import { AlertTriangle } from "lucide-react"
import { useI18n } from "@lebanonpos/shared"

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
  const { t } = useI18n()

  return (
    <main className="flex flex-1 items-center justify-center bg-page p-6">
      <div className="max-w-md rounded-lg border border-rose-200 bg-white p-6 text-center shadow-sm">
        <AlertTriangle size={40} className="mx-auto text-rose-500" />
        <h2 className="mt-3 text-xl font-bold text-zinc-950">
          {t("error_boundary.title")}
        </h2>
        <p className="mt-2 text-sm text-zinc-500">
          {error?.message ?? t("error_boundary.default_message")}
        </p>
        <button
          type="button"
          onClick={onReset}
          className="mt-5 rounded-lg bg-zinc-950 px-5 py-2.5 text-sm font-bold text-white transition hover:bg-zinc-800"
        >
          {t("error_boundary.try_again")}
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
      if (this.props.fallback) {
        return this.props.fallback
      }

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

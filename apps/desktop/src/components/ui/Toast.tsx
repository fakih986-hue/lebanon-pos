import { useEffect, useState } from "react"
import { X } from "lucide-react"
import { cn } from "../../lib/utils"

export type ToastType = "success" | "error" | "info" | "warning"

export interface ToastMessage {
  id: string
  type: ToastType
  message: string
}

const styles: Record<ToastType, string> = {
  success: "border-emerald-200 bg-emerald-50 text-emerald-800",
  error: "border-rose-200 bg-rose-50 text-rose-800",
  info: "border-sky-200 bg-sky-50 text-sky-800",
  warning: "border-amber-200 bg-amber-50 text-amber-800",
}

interface ToastItemProps {
  toast: ToastMessage
  onDismiss: (id: string) => void
}

function ToastItem({ toast, onDismiss }: ToastItemProps) {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const frame = requestAnimationFrame(() => setVisible(true))
    return () => cancelAnimationFrame(frame)
  }, [])

  useEffect(() => {
    const timer = setTimeout(() => {
      setVisible(false)
      setTimeout(() => onDismiss(toast.id), 300)
    }, 4000)
    return () => clearTimeout(timer)
  }, [toast.id, onDismiss])

  return (
    <div
      role="alert"
      className={cn(
        "pointer-events-auto flex items-center gap-3 rounded-lg border px-4 py-3 shadow-lg transition-all duration-300",
        styles[toast.type],
        visible ? "translate-x-0 opacity-100" : "translate-x-full opacity-0"
      )}
    >
      <p className="flex-1 text-sm font-semibold">{toast.message}</p>
      <button
        type="button"
        onClick={() => {
          setVisible(false)
          setTimeout(() => onDismiss(toast.id), 300)
        }}
        className="shrink-0 rounded-md p-1 transition hover:bg-black/5"
        aria-label="Dismiss"
      >
        <X size={14} />
      </button>
    </div>
  )
}

interface ToastContainerProps {
  toasts: ToastMessage[]
  onDismiss: (id: string) => void
}

export default function ToastContainer({ toasts, onDismiss }: ToastContainerProps) {
  if (toasts.length === 0) return null

  return (
    <div
      className="pointer-events-none fixed bottom-24 right-4 z-[100] flex flex-col gap-2 sm:bottom-6"
      aria-live="polite"
      aria-label="Notifications"
    >
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} onDismiss={onDismiss} />
      ))}
    </div>
  )
}

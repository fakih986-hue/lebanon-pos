import { useEffect, useState } from "react"
import { CheckCircle, Info, X, XCircle, AlertTriangle } from "lucide-react"

export type ToastType = "success" | "error" | "info" | "warning"

export interface ToastMessage {
  id: string
  type: ToastType
  message: string
}

const config: Record<ToastType, { icon: typeof CheckCircle; bg: string; text: string; border: string }> = {
  success: { icon: CheckCircle,   bg: "var(--brand-soft)",  text: "var(--brand-text)",  border: "var(--brand-border)" },
  error:   { icon: XCircle,      bg: "var(--rose-soft)",   text: "var(--rose-text)",   border: "rgba(244,63,94,0.2)" },
  info:    { icon: Info,          bg: "var(--accent-soft)", text: "var(--accent-text)", border: "rgba(99,102,241,0.2)" },
  warning: { icon: AlertTriangle, bg: "var(--amber-soft)",  text: "var(--amber-text)",  border: "rgba(245,158,11,0.2)" },
}

function ToastItem({ toast, onDismiss }: { toast: ToastMessage; onDismiss: (id: string) => void }) {
  const [visible, setVisible] = useState(false)
  const { icon: Icon, bg, text, border } = config[toast.type]

  useEffect(() => {
    const f = requestAnimationFrame(() => setVisible(true))
    return () => cancelAnimationFrame(f)
  }, [])

  useEffect(() => {
    const t = setTimeout(() => {
      setVisible(false)
      setTimeout(() => onDismiss(toast.id), 250)
    }, 4000)
    return () => clearTimeout(t)
  }, [toast.id, onDismiss])

  return (
    <div
      role="alert"
      className="pointer-events-auto flex items-center gap-3 rounded-xl border px-4 py-3 transition-all duration-250"
      style={{
        background: bg,
        borderColor: border,
        boxShadow: "var(--shadow-lg)",
        opacity: visible ? 1 : 0,
        transform: visible ? "translateX(0)" : "translateX(24px)",
      }}
    >
      <Icon size={16} className="shrink-0" style={{ color: text }} />
      <p className="flex-1 text-[13px] font-semibold" style={{ color: text }}>{toast.message}</p>
      <button
        type="button"
        onClick={() => { setVisible(false); setTimeout(() => onDismiss(toast.id), 250) }}
        className="shrink-0 rounded-lg p-1 transition hover:opacity-60"
        style={{ color: text }}
        aria-label="Dismiss"
      >
        <X size={13} />
      </button>
    </div>
  )
}

export default function ToastContainer({ toasts, onDismiss }: { toasts: ToastMessage[]; onDismiss: (id: string) => void }) {
  if (toasts.length === 0) return null
  return (
    <div
      className="pointer-events-none fixed bottom-24 right-4 z-[100] flex flex-col gap-2 sm:bottom-6"
      aria-live="polite"
    >
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} onDismiss={onDismiss} />
      ))}
    </div>
  )
}

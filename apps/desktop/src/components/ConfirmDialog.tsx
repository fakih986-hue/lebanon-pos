import { useEffect, type ReactNode } from "react"
import { X } from "lucide-react"
import { useI18n } from "@lebanonpos/shared"

type Props = {
  open: boolean
  title: string
  children: ReactNode
  confirmLabel?: string
  confirmDestructive?: boolean
  onConfirm: () => void
  onCancel: () => void
}

export default function ConfirmDialog({ open, title, children, confirmLabel, confirmDestructive, onConfirm, onCancel }: Props) {
  const { t } = useI18n()

  useEffect(() => {
    if (!open) return
    function handleKeyDown(e: KeyboardEvent) { if (e.key === "Escape") onCancel() }
    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [open, onCancel])

  return (
    <div className={`fixed inset-0 z-50 flex items-center justify-center p-4 ${open ? "" : "pointer-events-none"}`}>
      <div
        className={`fixed inset-0 transition-opacity duration-200 ${open ? "opacity-100" : "opacity-0"}`}
        style={{ background: "rgba(0,0,0,0.5)", backdropFilter: "blur(4px)" }}
        onClick={onCancel}
      />
      <div
        className={`relative w-full max-w-sm rounded-2xl border transition-all duration-200 ${open ? "scale-100 opacity-100 animate-scale-in" : "scale-95 opacity-0"}`}
        style={{ background: "var(--surface)", borderColor: "var(--border)", boxShadow: "var(--shadow-xl)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b px-5 py-4" style={{ borderColor: "var(--border)" }}>
          <h2 className="text-[15px] font-bold" style={{ color: "var(--text)" }}>{title}</h2>
          <button
            type="button"
            onClick={onCancel}
            className="btn btn-ghost btn-icon h-8 w-8 rounded-lg"
            aria-label={t("pos.cancel")}
          >
            <X size={16} />
          </button>
        </div>

        <div className="px-5 py-4 text-[13px]" style={{ color: "var(--text-2)" }}>{children}</div>

        <div className="flex justify-end gap-2 border-t px-5 py-4" style={{ borderColor: "var(--border)" }}>
          <button
            type="button"
            onClick={onCancel}
            className="btn btn-default btn-md"
          >
            {t("pos.cancel")}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className={`btn btn-md ${confirmDestructive ? "btn-danger hover:bg-[var(--rose)] hover:text-white" : "btn-primary"}`}
            style={confirmDestructive ? undefined : undefined}
          >
            {confirmLabel ?? t("pos.confirm")}
          </button>
        </div>
      </div>
    </div>
  )
}

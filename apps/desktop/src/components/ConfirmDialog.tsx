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

export default function ConfirmDialog({
  open,
  title,
  children,
  confirmLabel,
  confirmDestructive,
  onConfirm,
  onCancel,
}: Props) {
  const { t } = useI18n()
  useEffect(() => {
    if (!open) return
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onCancel()
    }
    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [open, onCancel])

  return (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center p-4 ${open ? "" : "pointer-events-none"}`}
    >
      <div
        className={`fixed inset-0 bg-black/40 transition-opacity duration-200 ${open ? "opacity-100" : "opacity-0"}`}
        onClick={onCancel}
      />
      <div
        className={`w-full max-w-sm rounded-lg border border-zinc-200 bg-white shadow-xl transition-all duration-200 ${open ? "scale-100 opacity-100" : "scale-95 opacity-0"}`}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-zinc-200 px-5 py-4">
          <h2 className="text-lg font-bold text-zinc-950">{title}</h2>
          <button
            type="button"
            onClick={onCancel}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-600"
            aria-label={t("pos.cancel")}
          >
            <X size={18} />
          </button>
        </div>

        <div className="px-5 py-4 text-sm text-zinc-600">{children}</div>

        <div className="flex justify-end gap-3 border-t border-zinc-200 px-5 py-4">
          <button
            type="button"
            onClick={onCancel}
            className="h-10 rounded-lg border border-zinc-200 bg-white px-4 text-sm font-bold text-zinc-700 transition hover:bg-zinc-50"
          >
            {t("pos.cancel")}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className={`h-10 rounded-lg px-4 text-sm font-bold text-white transition ${
              confirmDestructive
                ? "bg-rose-600 hover:bg-rose-500"
                : "bg-zinc-950 hover:bg-zinc-800"
            }`}
          >
            {confirmLabel ?? t("pos.confirm")}
          </button>
        </div>
      </div>
    </div>
  )
}

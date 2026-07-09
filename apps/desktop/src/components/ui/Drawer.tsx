import { useEffect, useRef, type ReactNode } from "react"
import { X } from "lucide-react"

interface DrawerProps {
  open: boolean
  onClose: () => void
  title: string
  subtitle?: string
  /** Sticky footer slot (actions). */
  footer?: ReactNode
  children: ReactNode
  width?: number
}

/**
 * Right-side drawer (Midnight Gold). Design law: editing an entity = drawer;
 * creating from scratch or confirming danger = modal. Slides from the end
 * side (RTL-aware via inset-inline-end), Esc closes, focus moves in on open.
 */
export default function Drawer({ open, onClose, title, subtitle, footer, children, width = 460 }: DrawerProps) {
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    panelRef.current?.focus()
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose()
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [open, onClose])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-[110] animate-fade-in"
      style={{ background: "rgba(9,12,24,0.55)", backdropFilter: "blur(4px)" }}
      onClick={onClose}
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="fixed inset-y-0 flex max-w-[95vw] flex-col outline-none"
        style={{
          insetInlineEnd: 0,
          width,
          background: "var(--surface)",
          borderInlineStart: "1px solid var(--border)",
          boxShadow: "var(--elev-4)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="flex shrink-0 items-center justify-between gap-3 border-b px-5 py-4"
          style={{ borderColor: "var(--border-soft)" }}
        >
          <div className="min-w-0">
            <h2 className="truncate text-[15px] font-bold" style={{ color: "var(--text)" }}>{title}</h2>
            {subtitle && <p className="truncate text-[12px]" style={{ color: "var(--text-3)" }}>{subtitle}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition hover:opacity-70"
            style={{ color: "var(--text-3)" }}
          >
            <X size={16} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>

        {footer && (
          <div
            className="flex shrink-0 items-center justify-end gap-2 border-t px-5 py-3"
            style={{ borderColor: "var(--border-soft)", background: "var(--surface-2)" }}
          >
            {footer}
          </div>
        )}
      </div>
    </div>
  )
}

import { Keyboard, X } from "lucide-react"

const shortcuts = [
  { keys: "Ctrl + F", action: "Focus search / barcode input" },
  { keys: "F8", action: "Open cart panel" },
  { keys: "Enter", action: "Add scanned item to cart" },
  { keys: "Escape", action: "Close cart / modal" },
  { keys: "?", action: "Show this help" },
]

type Props = {
  open: boolean
  onClose: () => void
}

export default function KeyboardShortcutsModal({ open, onClose }: Props) {
  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.5)", backdropFilter: "blur(4px)" }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-2xl border p-6"
        style={{ background: "var(--surface)", borderColor: "var(--border)", boxShadow: "var(--shadow-lg)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Keyboard size={20} style={{ color: "var(--brand)" }} />
            <h2 className="text-[17px] font-bold" style={{ color: "var(--text)" }}>Keyboard Shortcuts</h2>
          </div>
          <button onClick={onClose} aria-label="Close shortcuts" style={{ color: "var(--text-3)" }}><X size={18} /></button>
        </div>

        <div className="space-y-2">
          {shortcuts.map(({ keys, action }) => (
            <div key={keys} className="flex items-center justify-between gap-3 rounded-lg px-3 py-2.5" style={{ background: "var(--surface-2)" }}>
              <span className="text-[13px] font-semibold" style={{ color: "var(--text-2)" }}>{action}</span>
              <kbd
                className="rounded-md border px-2.5 py-1 text-[12px] font-bold tabular-nums"
                style={{ borderColor: "var(--border-strong)", background: "var(--surface)", color: "var(--text)" }}
              >
                {keys}
              </kbd>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

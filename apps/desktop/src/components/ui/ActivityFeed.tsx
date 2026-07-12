import { useEffect, useState } from "react"
import { ShoppingCart, Undo2, PackagePlus, Receipt, Radio, X } from "lucide-react"

type Activity = { entity: string; action: string; summary: string }
type FeedEntry = Activity & { id: string }

const iconFor: Record<string, typeof ShoppingCart> = {
  sale: ShoppingCart,
  refund: Undo2,
  product: PackagePlus,
  debt: Receipt,
  inventory: PackagePlus,
}

const LIFETIME_MS = 6500
let counter = 0

function FeedItem({ entry, onDismiss }: { entry: FeedEntry; onDismiss: (id: string) => void }) {
  const [visible, setVisible] = useState(false)
  const Icon = iconFor[entry.entity] ?? Radio

  useEffect(() => {
    const f = requestAnimationFrame(() => setVisible(true))
    return () => cancelAnimationFrame(f)
  }, [])

  useEffect(() => {
    const t = setTimeout(() => {
      setVisible(false)
      setTimeout(() => onDismiss(entry.id), 250)
    }, LIFETIME_MS)
    return () => clearTimeout(t)
  }, [entry.id, onDismiss])

  return (
    <div
      className="pointer-events-auto flex items-center gap-2.5 rounded-xl border px-3.5 py-2.5 transition-all duration-250"
      style={{
        background: "var(--surface)",
        borderColor: "var(--border)",
        boxShadow: "var(--shadow-lg)",
        opacity: visible ? 1 : 0,
        transform: visible ? "translateX(0)" : "translateX(-24px)",
        maxWidth: 320,
      }}
    >
      <span
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full"
        style={{ background: "var(--brand-soft)", color: "var(--brand-text)" }}
      >
        <Icon size={13} />
      </span>
      <p className="min-w-0 flex-1 truncate text-[12.5px] font-semibold" style={{ color: "var(--text)" }}>
        {entry.summary}
      </p>
      <button
        type="button"
        onClick={() => { setVisible(false); setTimeout(() => onDismiss(entry.id), 250) }}
        className="shrink-0 rounded-lg p-1 transition hover:opacity-60"
        style={{ color: "var(--text-3)" }}
        aria-label="Dismiss"
      >
        <X size={12} />
      </button>
    </div>
  )
}

/**
 * Live cross-device activity feed — shows what's happening elsewhere in the
 * store (another register's sale, a refund, a restock) as it happens, so the
 * store feels like one connected system instead of a set of isolated
 * screens. Mounted once globally; entries arrive via the `sync:activity-feed`
 * window event dispatched from the sync service's WebSocket handler.
 */
export default function ActivityFeed() {
  const [entries, setEntries] = useState<FeedEntry[]>([])

  useEffect(() => {
    function onActivity(e: Event) {
      const activities = (e as CustomEvent<Activity[]>).detail
      if (!Array.isArray(activities) || activities.length === 0) return
      setEntries((prev) => [
        ...activities.map((a) => ({ ...a, id: `activity-${++counter}` })),
        ...prev,
      ].slice(0, 4)) // cap visible entries — a burst of activity shouldn't flood the screen
    }
    window.addEventListener("sync:activity-feed", onActivity)
    return () => window.removeEventListener("sync:activity-feed", onActivity)
  }, [])

  function dismiss(id: string) {
    setEntries((prev) => prev.filter((e) => e.id !== id))
  }

  if (entries.length === 0) return null

  return (
    <div
      className="pointer-events-none fixed bottom-6 start-4 z-[100] flex flex-col-reverse gap-2"
      aria-live="polite"
    >
      {entries.map((entry) => (
        <FeedItem key={entry.id} entry={entry} onDismiss={dismiss} />
      ))}
    </div>
  )
}

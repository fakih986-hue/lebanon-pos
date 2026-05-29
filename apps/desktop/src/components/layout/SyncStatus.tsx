import { useEffect, useRef, useState } from "react"
import { AlertTriangle, Cloud, CloudOff, RotateCw, X } from "lucide-react"

import { useI18n } from "@lebanonpos/shared"
import {
  clearSyncQueue,
  flushSyncQueue,
  getSyncStatus,
  pullFromServer,
  retryFailedSync,
  subscribeSync,
  type SyncStatus as RegisterSyncStatus,
} from "../../features/pos/services/sync.service"

export default function SyncStatus() {
  const { t } = useI18n()
  const [status, setStatus] = useState<RegisterSyncStatus>(getSyncStatus())
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => subscribeSync(() => setStatus(getSyncStatus())), [])

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    if (open) document.addEventListener("mousedown", onClick)
    return () => document.removeEventListener("mousedown", onClick)
  }, [open])

  async function handleSyncNow() {
    retryFailedSync()
    await flushSyncQueue()
    await pullFromServer()
    setStatus(getSyncStatus())
  }

  const pendingWork = status.pending + status.failed
  const hasDead = status.dead > 0

  // Determine pill appearance + label
  let pillStyle: React.CSSProperties
  let label: string
  let Icon = Cloud

  if (!status.online) {
    pillStyle = { background: "var(--rose-soft)", borderColor: "rgba(244,63,94,0.3)", color: "var(--rose-text)" }
    label = t("sync.offline", { n: pendingWork + status.dead })
    Icon = CloudOff
  } else if (hasDead) {
    pillStyle = { background: "var(--rose-soft)", borderColor: "rgba(244,63,94,0.3)", color: "var(--rose-text)" }
    label = `${status.dead} stuck`
    Icon = AlertTriangle
  } else if (pendingWork > 0) {
    pillStyle = { background: "var(--amber-soft)", borderColor: "rgba(245,158,11,0.3)", color: "var(--amber-text)" }
    label = t("sync.pending", { n: pendingWork })
    Icon = RotateCw
  } else {
    pillStyle = { background: "var(--brand-soft)", borderColor: "var(--brand-border)", color: "var(--brand-text)" }
    label = t("sync.synced")
    Icon = Cloud
  }

  return (
    <div className="relative hidden lg:block" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex h-9 items-center gap-2 rounded-lg border px-3 text-[13px] font-semibold transition hover:opacity-80"
        style={pillStyle}
      >
        <Icon size={15} />
        <span>{label}</span>
      </button>

      {open && (
        <div
          className="absolute right-0 top-11 z-50 w-72 rounded-xl border p-4 animate-fade-in"
          style={{ background: "var(--surface)", borderColor: "var(--border)", boxShadow: "var(--shadow-xl)" }}
        >
          <div className="flex items-center justify-between mb-3">
            <p className="text-[14px] font-bold" style={{ color: "var(--text)" }}>Sync status</p>
            <button onClick={() => setOpen(false)} style={{ color: "var(--text-3)" }}><X size={15} /></button>
          </div>

          {/* Connection */}
          <div className="flex items-center gap-2 mb-3">
            <span className={`h-2 w-2 rounded-full ${status.online ? "bg-emerald-500" : "bg-rose-500"}`} />
            <span className="text-[13px]" style={{ color: "var(--text-2)" }}>
              {status.online ? "Online" : "Offline — changes saved locally"}
            </span>
          </div>

          {/* Counts */}
          <div className="grid grid-cols-3 gap-2 mb-3">
            {[
              { label: "Pending", value: status.pending, color: "var(--amber-text)" },
              { label: "Synced", value: status.synced, color: "var(--brand-text)" },
              { label: "Stuck", value: status.dead, color: status.dead > 0 ? "var(--rose-text)" : "var(--text-3)" },
            ].map((c) => (
              <div key={c.label} className="rounded-lg px-2 py-2 text-center" style={{ background: "var(--surface-2)" }}>
                <p className="text-[16px] font-bold" style={{ color: c.color }}>{c.value}</p>
                <p className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: "var(--text-3)" }}>{c.label}</p>
              </div>
            ))}
          </div>

          {/* Errors */}
          {status.recentErrors.length > 0 && (
            <div className="mb-3 rounded-lg p-2.5" style={{ background: "var(--rose-soft)" }}>
              <p className="text-[11px] font-bold mb-1" style={{ color: "var(--rose-text)" }}>Recent errors</p>
              {status.recentErrors.map((err, i) => (
                <p key={i} className="text-[11px] leading-snug" style={{ color: "var(--rose-text)" }}>• {err}</p>
              ))}
            </div>
          )}

          {status.lastSyncedAt && (
            <p className="text-[11px] mb-3" style={{ color: "var(--text-3)" }}>
              Last synced: {new Date(status.lastSyncedAt).toLocaleString()}
            </p>
          )}

          {/* Actions */}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleSyncNow}
              disabled={!status.online}
              className="btn btn-primary flex-1 h-9 gap-1.5 text-[12px] disabled:opacity-40"
            >
              <RotateCw size={13} />
              Sync now
            </button>
            {hasDead && (
              <button
                type="button"
                onClick={() => { clearSyncQueue(); setStatus(getSyncStatus()) }}
                className="btn h-9 gap-1.5 text-[12px]"
                style={{ background: "var(--rose-soft)", color: "var(--rose-text)", border: "1px solid rgba(244,63,94,0.3)" }}
                title="Remove stuck operations that failed 5 times"
              >
                Clear stuck
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

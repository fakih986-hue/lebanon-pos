import { useCallback, useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
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

type RejectedToast = { entity: string; error: string }

export default function SyncStatus() {
  const { t } = useI18n()
  const [status, setStatus] = useState<RegisterSyncStatus>(getSyncStatus())
  const [open, setOpen] = useState(false)
  const [toast, setToast] = useState<RejectedToast | null>(null)
  const toastTimer = useRef<number>(undefined)
  const containerRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const [ddPos, setDdPos] = useState({ top: 0, right: 0 })

  useEffect(() => subscribeSync(() => setStatus(getSyncStatus())), [])

  useEffect(() => {
    function onRejected(e: Event) {
      const op = (e as CustomEvent).detail
      setToast({ entity: op.entity, error: op.error ?? "Sync rejected" })
      clearTimeout(toastTimer.current)
      toastTimer.current = window.setTimeout(() => setToast(null), 6000)
      setStatus(getSyncStatus())
    }
    window.addEventListener("sync:operation-rejected", onRejected)
    return () => window.removeEventListener("sync:operation-rejected", onRejected)
  }, [])

  useEffect(() => {
    if (!open) return
    if (buttonRef.current) {
      const r = buttonRef.current.getBoundingClientRect()
      setDdPos({ top: r.bottom + 8, right: window.innerWidth - r.right })
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    function handleClick(e: MouseEvent) {
      const t = e.target as Node
      if (containerRef.current?.contains(t)) return
      if (dropdownRef.current?.contains(t)) return
      setOpen(false)
    }
    document.addEventListener("mousedown", handleClick)
    return () => document.removeEventListener("mousedown", handleClick)
  }, [open])

  async function handleSyncNow() {
    retryFailedSync()
    await flushSyncQueue()
    await pullFromServer()
    setStatus(getSyncStatus())
  }

  const pendingWork = status.pending + status.failed
  const hasDead = status.dead > 0

  let pillBg: string
  let pillBorder: string
  let pillColor: string
  let label: string
  let Icon = Cloud

  if (!status.online) {
    pillBg = "var(--rose-soft)"; pillBorder = "rgba(244,63,94,0.3)"; pillColor = "var(--rose-text)"
    label = t("sync.offline", { n: pendingWork + status.dead })
    Icon = CloudOff
  } else if (hasDead) {
    pillBg = "var(--rose-soft)"; pillBorder = "rgba(244,63,94,0.3)"; pillColor = "var(--rose-text)"
    label = `${status.dead} stuck`
    Icon = AlertTriangle
  } else if (pendingWork > 0) {
    pillBg = "var(--amber-soft)"; pillBorder = "rgba(245,158,11,0.3)"; pillColor = "var(--amber-text)"
    label = t("sync.pending", { n: pendingWork })
    Icon = RotateCw
  } else {
    pillBg = "var(--brand-soft)"; pillBorder = "var(--brand-border)"; pillColor = "var(--brand-text)"
    label = t("sync.synced")
    Icon = Cloud
  }

  return (
    <div className="relative z-10" ref={containerRef}>
      {toast && (
        <div
          className="fixed left-1/2 top-4 z-[999] -translate-x-1/2 animate-slide-down rounded-xl border px-4 py-3 shadow-xl"
          style={{ background: "var(--rose-soft)", borderColor: "rgba(244,63,94,0.3)", maxWidth: "420px" }}
        >
          <div className="flex items-start gap-2">
            <AlertTriangle size={16} className="mt-0.5 shrink-0" style={{ color: "var(--rose-text)" }} />
            <div className="min-w-0">
              <p className="text-[13px] font-bold" style={{ color: "var(--rose-text)" }}>Sync error — {toast.entity}</p>
              <p className="text-[12px] mt-0.5 leading-snug" style={{ color: "var(--rose-text)", opacity: 0.85 }}>{toast.error}</p>
            </div>
            <button onClick={() => setToast(null)} className="shrink-0" style={{ color: "var(--rose-text)" }}>
              <X size={14} />
            </button>
          </div>
        </div>
      )}

      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex h-9 items-center gap-2 rounded-lg border px-3 text-[13px] font-semibold transition hover:opacity-80"
        style={{ background: pillBg, borderColor: pillBorder, color: pillColor }}
      >
        <Icon size={15} />
        <span>{label}</span>
      </button>

      {open && createPortal(
        <div
          ref={dropdownRef}
          className="fixed z-[999] w-72 rounded-xl border p-4"
          style={{ top: ddPos.top, right: ddPos.right, background: "var(--surface)", borderColor: "var(--border)", boxShadow: "0 8px 30px rgba(0,0,0,0.2)" }}
        >
          <div className="flex items-center justify-between mb-3">
            <p className="text-[14px] font-bold" style={{ color: "var(--text)" }}>Sync status</p>
            <button onClick={() => setOpen(false)} style={{ color: "var(--text-3)" }}><X size={15} /></button>
          </div>

          <div className="flex items-center gap-2 mb-3">
            <span className={`h-2 w-2 rounded-full ${status.online ? "bg-emerald-500" : "bg-rose-500"}`} />
            <span className="text-[13px]" style={{ color: "var(--text-2)" }}>
              {status.online ? "Online" : "Offline — changes saved locally"}
            </span>
          </div>

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
        </div>,
        document.body
      )}
    </div>
  )
}

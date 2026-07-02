import { useEffect, useMemo, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { AlertTriangle, Bell, Boxes, CalendarClock, CircleDollarSign, RotateCcw, X } from "lucide-react"
import { useNavigate } from "react-router"

import { useI18n } from "@lebanonpos/shared"
import { getProductsSync, subscribeProducts } from "../../features/pos/services/product.service"
import { subscribeSales } from "../../features/pos/services/sales.service"
import { getInventoryNotifications, type AppNotification } from "../../features/pos/services/notification.service"

function getIcon(severity: AppNotification["severity"], title: string) {
  if (title.toLowerCase().includes("expir")) return CalendarClock
  if (title.toLowerCase().includes("out of stock")) return AlertTriangle
  if (title.toLowerCase().includes("stock")) return Boxes
  if (title.toLowerCase().includes("supplier")) return CircleDollarSign
  return RotateCcw
}

function getSeverityStyles(severity: AppNotification["severity"]) {
  if (severity === "Critical") return { bg: "rgba(239,68,68,0.06)", border: "rgba(239,68,68,0.15)", dot: "#ef4444", text: "#fca5a5" }
  if (severity === "Warning") return { bg: "rgba(245,158,11,0.06)", border: "rgba(245,158,11,0.15)", dot: "#f59e0b", text: "#fcd34d" }
  return { bg: "rgba(59,130,246,0.04)", border: "rgba(59,130,246,0.10)", dot: "#3b82f6", text: "#93c5fd" }
}

export default function NotificationCenter() {
  const { t } = useI18n()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [version, setVersion] = useState(0)
  const [dismissed, setDismissed] = useState<Set<string>>(() => {
    try { return new Set(JSON.parse(localStorage.getItem("lebanonpos.dismissed-notifications.v1") || "[]")) } catch { return new Set() }
  })
  const panelRef = useRef<HTMLDivElement | null>(null)
  const buttonRef = useRef<HTMLButtonElement | null>(null)
  const dropdownRef = useRef<HTMLDivElement | null>(null)
  const [dropdownPos, setDropdownPos] = useState({ top: 0, right: 0 })
  const allNotifications = useMemo(() => getInventoryNotifications(getProductsSync()), [version])
  const notifications = allNotifications.filter((n) => !dismissed.has(n.id))
  const criticalCount = notifications.filter((n) => n.severity === "Critical").length

  useEffect(() => {
    const u1 = subscribeProducts(() => setVersion((v) => v + 1))
    const u2 = subscribeSales(() => setVersion((v) => v + 1))
    return () => { u1(); u2() }
  }, [])

  useEffect(() => {
    localStorage.setItem("lebanonpos.dismissed-notifications.v1", JSON.stringify([...dismissed]))
  }, [dismissed])

  useEffect(() => {
    if (!open) return
    if (buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect()
      setDropdownPos({ top: rect.bottom + 8, right: window.innerWidth - rect.right })
    }
  }, [open, version])

  useEffect(() => {
    if (!open) return
    function handleClick(e: MouseEvent) {
      const target = e.target as Node
      if (panelRef.current?.contains(target)) return
      if (dropdownRef.current?.contains(target)) return
      setOpen(false)
    }
    document.addEventListener("mousedown", handleClick)
    return () => document.removeEventListener("mousedown", handleClick)
  }, [open])

  function handleDismiss(e: React.MouseEvent, id: string) {
    e.stopPropagation()
    setDismissed((prev) => new Set([...prev, id]))
  }

  function handleNavigate(path: string) {
    setOpen(false)
    navigate(path)
  }

  const hasAlerts = notifications.filter((n) => n.severity !== "Info").length > 0

  return (
    <div className="relative z-10" ref={panelRef}>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`relative flex h-10 w-10 items-center justify-center rounded-lg border transition z-10 ${
          hasAlerts
            ? "border-amber-500/30 bg-amber-500/10 text-amber-400 hover:bg-amber-500/15"
            : "border-zinc-700/30 text-zinc-400 hover:bg-white/5 hover:text-zinc-300"
        }`}
        aria-label={t("pos.notifications.open")}
      >
        <Bell size={18} />
        {criticalCount > 0 && (
          <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[9px] font-bold text-white">
            {criticalCount}
          </span>
        )}
      </button>

      {open && createPortal(
        <div
          ref={dropdownRef}
          className="fixed z-[999] w-[min(92vw,380px)] overflow-hidden rounded-2xl shadow-2xl"
          style={{ top: dropdownPos.top, right: dropdownPos.right, background: "var(--surface)", border: "1px solid var(--border)" }}
        >
          <div className="flex items-center justify-between gap-3 border-b px-4 py-3" style={{ borderColor: "var(--border)" }}>
            <div>
              <h2 className="text-sm font-bold" style={{ color: "var(--text)" }}>{t("pos.notifications.title")}</h2>
              <p className="text-[11px] font-medium" style={{ color: "var(--text-3)" }}>
                {notifications.length === 0 ? t("pos.notifications.all_clear") : `${notifications.length} alert${notifications.length > 1 ? "s" : ""}`}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-zinc-500 transition hover:bg-zinc-100"
              aria-label="Close"
            >
              <X size={15} />
            </button>
          </div>

          <div className="max-h-[420px] overflow-y-auto p-2 space-y-1.5">
            {notifications.length === 0 && (
              <div className="rounded-xl px-4 py-10 text-center">
                <p className="text-sm font-semibold" style={{ color: "var(--text-2)" }}>{t("pos.notifications.no_alerts")}</p>
                <p className="mt-1 text-[11px]" style={{ color: "var(--text-3)" }}>Everything looks good</p>
              </div>
            )}

            {notifications.slice(0, 15).map((n) => {
              const styles = getSeverityStyles(n.severity)
              const Icon = getIcon(n.severity, n.title)
              return (
                <button
                  key={n.id}
                  type="button"
                  onClick={() => handleNavigate(n.actionPath)}
                  className="flex w-full items-start gap-3 rounded-xl p-3 text-start transition hover:opacity-90 active:opacity-70 cursor-pointer"
                  style={{ background: styles.bg, border: `1px solid ${styles.border}` }}
                >
                  <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg" style={{ background: styles.border }}>
                    <Icon size={17} style={{ color: styles.dot }} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start gap-2">
                      <p className="text-[13px] font-bold leading-snug" style={{ color: "var(--text)" }}>{n.title}</p>
                    </div>
                    <p className="mt-0.5 text-[11px] font-medium leading-snug" style={{ color: "var(--text-2)" }}>
                      {n.detail}
                    </p>
                    <span className="mt-1.5 inline-block text-[11px] font-bold" style={{ color: styles.dot }}>
                      {n.actionLabel} →
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={(e) => handleDismiss(e, n.id)}
                    className="shrink-0 flex h-6 w-6 items-center justify-center rounded-md transition hover:bg-black/10"
                    title="Dismiss"
                  >
                    <X size={11} style={{ color: "var(--text-3)" }} />
                  </button>
                </button>
              )
            })}
          </div>
        </div>,
        document.body
      )}
    </div>
  )
}

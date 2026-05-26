import { useEffect, useMemo, useRef, useState } from "react"
import { Bell, PackagePlus, X } from "lucide-react"
import { Link } from "react-router-dom"

import {
  getProductsSync,
  subscribeProducts,
} from "../../features/pos/services/product.service"
import {
  subscribeSales,
} from "../../features/pos/services/sales.service"
import {
  getInventoryNotifications,
  type AppNotification,
} from "../../features/pos/services/notification.service"

function getSeverityClass(severity: AppNotification["severity"]) {
  if (severity === "Critical") {
    return "border-rose-200 bg-rose-50 text-rose-800"
  }

  if (severity === "Warning") {
    return "border-amber-200 bg-amber-50 text-amber-900"
  }

  return "border-sky-200 bg-sky-50 text-sky-800"
}

export default function NotificationCenter() {
  const [open, setOpen] = useState(false)
  const [version, setVersion] = useState(0)
  const panelRef = useRef<HTMLDivElement | null>(null)
  const notifications = useMemo(
    () => getInventoryNotifications(getProductsSync()),
    [version]
  )
  const criticalCount = notifications.filter(
    (notification) => notification.severity === "Critical"
  ).length

  useEffect(() => {
    const unsubscribeProducts = subscribeProducts(() =>
      setVersion((currentVersion) => currentVersion + 1)
    )
    const unsubscribeSales = subscribeSales(() =>
      setVersion((currentVersion) => currentVersion + 1)
    )

    return () => {
      unsubscribeProducts()
      unsubscribeSales()
    }
  }, [])

  useEffect(() => {
    function handlePointerDown(event: PointerEvent) {
      if (
        panelRef.current &&
        event.target instanceof Node &&
        !panelRef.current.contains(event.target)
      ) {
        setOpen(false)
      }
    }

    document.addEventListener("pointerdown", handlePointerDown)

    return () => document.removeEventListener("pointerdown", handlePointerDown)
  }, [])

  return (
    <div className="relative" ref={panelRef}>
      <button
        type="button"
        onClick={() => setOpen((currentValue) => !currentValue)}
        className={`relative flex h-10 w-10 items-center justify-center rounded-lg border transition sm:h-11 sm:w-11 ${
          notifications.length > 0
            ? "border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100"
            : "border-zinc-200 bg-white text-zinc-500 hover:bg-zinc-50"
        }`}
        aria-label="Open notifications"
        title="Notifications"
      >
        <Bell size={18} />
        {notifications.length > 0 ? (
          <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-rose-600 px-1 text-[0.65rem] font-black text-white ring-2 ring-white">
            {notifications.length}
          </span>
        ) : null}
      </button>

      {open ? (
        <div className="absolute right-0 top-12 z-50 w-[min(92vw,390px)] overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-2xl">
          <div className="flex items-center justify-between gap-3 border-b border-zinc-200 p-4">
            <div>
              <h2 className="font-bold text-zinc-950">Notifications</h2>
              <p className="text-sm text-zinc-500">
                {notifications.length === 0
                  ? "All clear"
                  : `${notifications.length} active, ${criticalCount} critical`}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="flex h-9 w-9 items-center justify-center rounded-lg border border-zinc-200 text-zinc-500 transition hover:bg-zinc-50"
              aria-label="Close notifications"
            >
              <X size={17} />
            </button>
          </div>

          <div className="max-h-[430px] space-y-2 overflow-y-auto p-3">
            {notifications.slice(0, 8).map((notification) => (
              <article
                key={notification.id}
                className={`rounded-lg border p-3 ${getSeverityClass(
                  notification.severity
                )}`}
              >
                <div className="flex items-start gap-3">
                  <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white/70">
                    <PackagePlus size={17} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="font-bold leading-snug">{notification.title}</p>
                    <p className="mt-1 text-sm font-medium opacity-80">
                      {notification.detail}
                    </p>
                    <Link
                      to={notification.actionPath}
                      onClick={() => setOpen(false)}
                      className="mt-3 inline-flex h-9 items-center justify-center rounded-lg bg-zinc-950 px-3 text-sm font-bold text-white transition hover:bg-zinc-800"
                    >
                      {notification.actionLabel}
                    </Link>
                  </div>
                </div>
              </article>
            ))}

            {notifications.length === 0 ? (
              <div className="rounded-lg border border-dashed border-zinc-300 p-6 text-center text-sm font-medium text-zinc-500">
                No low stock or reorder alerts right now.
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  )
}

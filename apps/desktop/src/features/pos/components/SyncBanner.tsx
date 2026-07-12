import { useEffect, useState } from "react"
import { Cloud, CloudOff, RefreshCw, AlertTriangle, Wifi, WifiOff } from "lucide-react"
import { getSyncStatus, getConnectionMode, subscribeSync, type SyncStatus } from "../services/sync.service"
import type { ConnectionMode } from "../services/settings.service"
import { isHubDeviceAutoApproved } from "../services/deviceRegistry.service"

type BannerLevel = "ok" | "warning" | "error" | "info"

type Banner = {
  level: BannerLevel
  icon: typeof Cloud
  message: string
}

function statusToBanner(s: SyncStatus, mode: ConnectionMode): Banner | null {
  if (mode === "CONNECT_TO_HUB") {
    const paired = isHubDeviceAutoApproved()
    if (!paired || s.rejected > 0) {
      return {
        level: "error",
        icon: AlertTriangle,
        message: "This register is not paired — sales cannot sync to the hub",
      }
    }
    if (!s.online) {
      return {
        level: "error",
        icon: CloudOff,
        message: "Not connected to hub — stock sales are paused until it reconnects",
      }
    }
    if (s.failed > 0 || s.rejected > 0) {
      return {
        level: "warning",
        icon: AlertTriangle,
        message: `${s.failed + s.rejected} sync item(s) need attention`,
      }
    }
    return {
      level: "ok",
      icon: Cloud,
      message: "Hub connected",
    }
  }

  if (mode === "STORE_HUB") {
    if (!s.online) {
      return {
        level: "warning",
        icon: WifiOff,
        message: "Hub unreachable — sales are saved locally",
      }
    }
    if (s.failed > 0 || s.rejected > 0) {
      return {
        level: "warning",
        icon: AlertTriangle,
        message: `${s.failed + s.rejected} sync item(s) need attention`,
      }
    }
    return {
      level: "ok",
      icon: Wifi,
      message: "Hub connected",
    }
  }

  // DIRECT_RAILWAY
  if (!s.online) {
    return {
      level: "warning",
      icon: CloudOff,
      message: "Cloud unreachable — sales are saved locally",
    }
  }
  if (s.failed > 0 || s.rejected > 0) {
    return {
      level: "warning",
      icon: AlertTriangle,
      message: `${s.failed + s.rejected} sync item(s) need attention`,
    }
  }
  return null
}

const levelStyles: Record<BannerLevel, string> = {
  ok: "bg-emerald-100 text-emerald-800 border-emerald-200",
  info: "bg-sky-100 text-sky-800 border-sky-200",
  warning: "bg-amber-100 text-amber-800 border-amber-200",
  error: "bg-rose-100 text-rose-800 border-rose-200",
}

export default function SyncBanner() {
  const [banner, setBanner] = useState<Banner | null>(null)

  useEffect(() => {
    function update() {
      const status = getSyncStatus()
      const mode = getConnectionMode()
      setBanner(statusToBanner(status, mode))
    }
    update()
    return subscribeSync(update)
  }, [])

  if (!banner) return null

  const Icon = banner.icon

  return (
    <div className={`flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-semibold ${levelStyles[banner.level]}`}>
      <Icon size={14} className="shrink-0" />
      <span>{banner.message}</span>
      {(banner.level === "warning" || banner.level === "error") && (
        <button
          type="button"
          onClick={() => {
            import("../services/sync.service").then((m) => {
              m.retryFailedSync()
              m.flushSyncQueue().catch(() => {})
            })
          }}
          className="ml-auto flex items-center gap-1 rounded-md px-2 py-0.5 transition hover:opacity-70"
          style={{ background: "rgba(0,0,0,0.08)" }}
        >
          <RefreshCw size={12} />
          Retry
        </button>
      )}
    </div>
  )
}

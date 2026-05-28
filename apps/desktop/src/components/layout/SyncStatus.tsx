import { useEffect, useState } from "react"
import { Cloud, CloudOff, RotateCw } from "lucide-react"

import { useI18n } from "@lebanonpos/shared"
import {
  flushSyncQueue,
  getSyncStatus,
  pullFromServer,
  retryFailedSync,
  subscribeSync,
  type SyncStatus as RegisterSyncStatus,
} from "../../features/pos/services/sync.service"

function getLabel(status: RegisterSyncStatus, t: (key: string, params?: Record<string, unknown>) => string) {
  if (!status.online) {
    return t("sync.offline", { n: status.pending + status.failed })
  }

  if (status.pending > 0) {
    return t("sync.pending", { n: status.pending })
  }

  if (status.failed > 0) {
    return t("sync.failed", { n: status.failed })
  }

  return t("sync.synced")
}

export default function SyncStatus() {
  const { t } = useI18n()
  const [status, setStatus] = useState<RegisterSyncStatus>(getSyncStatus())

  useEffect(
    () => subscribeSync(() => setStatus(getSyncStatus())),
    []
  )

  async function handleSyncNow() {
    retryFailedSync()
    await flushSyncQueue()
    await pullFromServer()
    setStatus(getSyncStatus())
  }

  const hasWork = status.pending > 0 || status.failed > 0
  const tooltip = status.online
    ? t("sync.tooltip", { pending: status.pending, synced: status.synced, failed: status.failed })
    : t("sync.tooltip_offline", { n: status.pending + status.failed })

  return (
    <button
      type="button"
      onClick={handleSyncNow}
      title={tooltip}
      className={`group relative hidden h-11 items-center gap-2 rounded-lg border px-3 text-sm font-semibold transition lg:flex ${
        status.online
          ? hasWork
            ? "border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100"
            : "border-sky-200 bg-sky-50 text-sky-800 hover:bg-sky-100"
          : "border-rose-200 bg-rose-50 text-rose-800"
      }`}
    >
      {status.online ? <Cloud size={17} /> : <CloudOff size={17} />}
      <span>{getLabel(status, t)}</span>
      {hasWork ? <RotateCw size={15} /> : null}
      <span className="absolute -top-8 left-1/2 -translate-x-1/2 whitespace-nowrap rounded bg-zinc-900 px-2 py-1 text-xs text-white opacity-0 transition group-hover:opacity-100">
        {tooltip}
      </span>
    </button>
  )
}

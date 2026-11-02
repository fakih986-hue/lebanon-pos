import { useEffect, useState } from "react"
import { useI18n } from "@lebanonpos/shared"
import { checkWaitingWorkNow, getWaitingWork, subscribeSync, type WaitingWork as Waiting } from "../../features/pos/services/sync.service"
import { serverReason } from "../../features/pos/lib/serverReason"

/**
 * Release batch: work the server keeps for now — waiting for something to reach it (a product, a recipe revision) or
 * for a manager's decision there. Never stuck and never lost: it is sent again until the outcome is known (applied
 * once, or declined by a manager). "Check now" asks the server immediately.
 */
export default function WaitingWork() {
  const { t } = useI18n()
  const [items, setItems] = useState<Waiting[]>(() => getWaitingWork())
  const [busy, setBusy] = useState<string | null>(null)
  useEffect(() => subscribeSync(() => setItems(getWaitingWork())), [])
  if (items.length === 0) return null
  return (
    <section className="mb-3 flex flex-col gap-2" aria-label={t("sync.waiting.title")}>
      <p className="text-[13px] font-semibold" style={{ color: "var(--v2-warn)" }}>{t("sync.waiting.title")}</p>
      {items.map((w) => (
        <div key={w.operationId} className="rounded-lg p-2 text-[12px] flex flex-col gap-1" style={{ background: "var(--surface-2)", color: "var(--text-2)" }}>
          <p className="font-semibold" style={{ color: "var(--text)" }}>{w.summary}</p>
          <p>{t(`sync.waiting.${w.state}`)}</p>
          <p>{serverReason(t, w.error)}</p>
          {w.lastAttemptAt && new Date(w.lastAttemptAt).getTime() > 0 && <p style={{ color: "var(--text-3)" }}>{t("sync.waiting.checked", { time: new Date(w.lastAttemptAt).toLocaleTimeString() })}</p>}
          <button type="button" className="mg2-btn" style={{ minHeight: 44, fontSize: 12, alignSelf: "flex-start" }} disabled={busy === w.operationId}
            onClick={async () => { setBusy(w.operationId); try { await checkWaitingWorkNow(w.operationId) } finally { setBusy(null); setItems(getWaitingWork()) } }}>
            {t("sync.waiting.check_now")}
          </button>
        </div>
      ))}
    </section>
  )
}

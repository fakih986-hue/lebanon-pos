import { useEffect, useState } from "react"
import { useI18n } from "@lebanonpos/shared"
import { getPendingHubSale, settlePendingHubSale, type PendingHubSale } from "../services/hubCheckout.service"

/**
 * A write-through sale whose hub answer was lost stays visible until it is settled on the hub
 * (committed, or cancelled with the hub's guarantee it cannot commit afterwards). While it is
 * shown, a different cart cannot be charged (hubCheckout.service).
 */
export default function PendingHubSaleBanner({ refreshKey }: { refreshKey?: unknown }) {
  const { t } = useI18n()
  const [pending, setPending] = useState<PendingHubSale | null>(() => { try { return getPendingHubSale() } catch { return null } })
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState("")
  useEffect(() => {
    let alive = true
    Promise.resolve().then(() => { if (alive) { try { setPending(getPendingHubSale()) } catch { setPending(null) } } })
    return () => { alive = false }
  }, [refreshKey])
  if (!pending) return message ? <p className="mg2-banner mg2-t-ok" role="status">{message}</p> : null

  async function check() {
    setBusy(true)
    try {
      const r = await settlePendingHubSale()
      if (r.state === "committed") setMessage(t("pos.hub_pending.committed", { number: pending!.sale.saleNumber }))
      else if (r.state === "cancelled") setMessage(t("pos.hub_pending.cancelled", { number: pending!.sale.saleNumber }))
      else setMessage(t("pos.hub_pending.unreachable"))
      setPending(getPendingHubSale())
    } finally { setBusy(false) }
  }
  return (
    <div className="mg2-banner mg2-t-warn" role="alert" style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
      <span style={{ flex: "1 1 240px" }}>{t("pos.hub_pending.text", { number: pending.sale.saleNumber, total: pending.sale.total })}</span>
      {message && <span>{message}</span>}
      <button type="button" className="mg2-btn" disabled={busy} aria-busy={busy || undefined} onClick={() => void check()}>{t("pos.hub_pending.check")}</button>
    </div>
  )
}

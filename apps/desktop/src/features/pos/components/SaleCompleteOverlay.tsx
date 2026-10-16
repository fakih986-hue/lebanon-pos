import { useEffect, useState } from "react"
import { CircleCheck, MessageCircle, Printer, X } from "lucide-react"
import { useI18n } from "@lebanonpos/shared"

import { formatCurrency, formatNumber } from "../lib/currency"
import { playSaleChime } from "../lib/sound"

type Props = {
  sale: {
    number: string
    total: number
    totalLbp: number
    payableLbp?: number
    payableUsd?: number
    paymentMethod?: string
    tender?: { changeUsd?: number; changeLbp?: number; paidUsd?: number; paidLbp?: number; changeCurrency?: string }
    profit?: number
  } | null
  /** True once the cashier starts the next sale (an item is in the cart). */
  nextSaleStarted?: boolean
  onViewReceipt?: () => void
  onWhatsApp?: () => void
}

/**
 * Sale complete (Midnight Gold v2): a NON-modal receipt panel. It announces
 * the result (role=status), shows the change to give in both currencies and
 * offers Print / WhatsApp — but never takes focus, so the scan field keeps it
 * and the next barcode simply starts the next sale (which closes the panel).
 */
export default function SaleCompleteOverlay({ sale, nextSaleStarted = false, onViewReceipt, onWhatsApp }: Props) {
  const { t } = useI18n()
  // Visibility is derived: the latest sale, unless it was closed, timed out,
  // or the next sale has started. No state is set synchronously in an effect.
  const [closed, setClosed] = useState<Props["sale"]>(null)

  useEffect(() => {
    if (!sale) return
    playSaleChime()
    const timer = window.setTimeout(() => setClosed(sale), 20000)
    return () => window.clearTimeout(timer)
  }, [sale])

  // Once the next sale starts this receipt is done, even if that cart is cleared
  // again (React's "adjust state while rendering" pattern; guarded, runs once).
  if (nextSaleStarted && sale && closed !== sale) setClosed(sale)
  const snapshot = sale && sale !== closed && !nextSaleStarted ? sale : null
  const close = () => setClosed(sale)

  if (!snapshot) return null
  const lbp = t("pos.v2.lbp")
  const isCash = snapshot.paymentMethod === "Cash"
  const changeLbp = snapshot.tender?.changeLbp ?? 0
  const changeUsd = snapshot.tender?.changeUsd ?? 0
  const changeInLbp = snapshot.tender?.changeCurrency === "LBP"
  const paidLbp = isCash && snapshot.payableLbp ? snapshot.payableLbp : snapshot.totalLbp
  const paidUsd = isCash && snapshot.payableUsd ? snapshot.payableUsd : snapshot.total

  return (
    <section className="mg2 mg2-receipt" role="status" aria-live="polite" aria-label={t("pos.last_sale.completed", { number: snapshot.number })}>
      <div className="flex items-center gap-3" style={{ padding: "14px 16px", borderBottom: "1px solid var(--border)" }}>
        <CircleCheck size={22} style={{ color: "var(--v2-ok)" }} aria-hidden="true" />
        <div className="min-w-0" style={{ flex: 1 }}>
          <div className="mg2-sub" style={{ color: "var(--text)" }}>{t("pos.v2.sale_complete")}</div>
          <div className="mg2-cap num">{snapshot.number}</div>
        </div>
        <button type="button" className="mg2-btn mg2-btn-ghost" style={{ minHeight: 44, width: 44, padding: 0 }} aria-label={t("pos.v2.close")} onClick={close}>
          <X size={18} />
        </button>
      </div>
      <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
        <div className="flex justify-between gap-3">
          <span className="mg2-cap">{t("pos.v2.paid")}</span>
          <span className="num font-semibold" style={{ color: "var(--text)" }}>{formatCurrency(paidUsd)} · {formatNumber(Math.round(paidLbp))} {lbp}</span>
        </div>
        {isCash && (changeLbp > 0 || changeUsd > 0) && (
          <div className="mg2-banner mg2-t-ok">
            <span className="mg2-sub" style={{ color: "inherit" }}>{t("pos.v2.change_to_give")}</span>
            <span className="num" style={{ marginInlineStart: "auto", textAlign: "end" }}>
              <span className="block font-semibold" style={{ fontSize: 24, lineHeight: 1.2, color: "var(--ok-money)" }}>{changeInLbp ? `${formatNumber(Math.round(changeLbp))} ${lbp}` : formatCurrency(changeUsd)}</span>
              <span className="mg2-cap block" style={{ color: "inherit" }}>{changeInLbp ? formatCurrency(changeUsd) : `${formatNumber(Math.round(changeLbp))} ${lbp}`}</span>
            </span>
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          {onViewReceipt && <button type="button" className="mg2-btn" onClick={onViewReceipt}><Printer size={16} />{t("pos.v2.print_receipt")}</button>}
          {onWhatsApp && <button type="button" className="mg2-btn" onClick={onWhatsApp}><MessageCircle size={16} />WhatsApp</button>}
        </div>
        <p className="mg2-cap" style={{ margin: 0 }}>{t("pos.v2.scan_next")}</p>
      </div>
    </section>
  )
}

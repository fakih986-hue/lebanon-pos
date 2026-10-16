import { useEffect, useRef } from "react"
import { ArrowLeft, CloudOff } from "lucide-react"
import { useI18n } from "@lebanonpos/shared"

import MoneyDue from "./MoneyDue"
import { formatCurrency, formatNumber } from "../lib/currency"

type PaymentMethod = "Cash" | "Card" | "Wallet" | "Debt"

/**
 * Payment review (DESIGN-SYSTEM §8 "Review overlay"): one dialog for the full
 * register and Simple POS. Customer-facing amount at hero size, what was
 * paid, and the change to give. Enter confirms (only when checkout is
 * allowed), Esc goes back. Focus moves into the dialog on open; the caller
 * returns it to the scan field on close. Presentation only.
 */
export default function PaymentReviewDialog({
  lines, units, total, totalLbp, payableLbp, payableUsd, paymentMethod,
  paidUsd, paidLbp, changeUsd, changeLbp, stillDueUsd,
  blockedReason, offline, customerName, shiftLabel,
  onBack, onConfirm,
}: {
  lines: number
  units: number
  total: number
  totalLbp: number
  payableLbp: number
  payableUsd: number
  paymentMethod: PaymentMethod
  paidUsd: number
  paidLbp: number
  changeUsd: number
  changeLbp: number
  stillDueUsd: number
  /** Why checkout is not allowed, or null when it is. */
  blockedReason: string | null
  offline?: boolean
  customerName?: string
  shiftLabel?: string
  onBack: () => void
  onConfirm: () => void
}) {
  const { t } = useI18n()
  const dialogRef = useRef<HTMLDivElement>(null)
  const confirmRef = useRef<HTMLButtonElement>(null)
  const isCash = paymentMethod === "Cash"
  const changeInLbp = paidLbp > 0 && paidUsd === 0 // USD and mixed tenders give USD change
  const amountLabel = isCash && payableLbp !== totalLbp
    ? `${formatCurrency(payableUsd)} · ${formatNumber(Math.round(payableLbp))} ${t("pos.v2.lbp")}`
    : `${formatCurrency(total)} · ${formatNumber(Math.round(totalLbp))} ${t("pos.v2.lbp")}`

  useEffect(() => {
    const id = window.setTimeout(() => (confirmRef.current && !blockedReason ? confirmRef.current : dialogRef.current)?.focus(), 30)
    return () => window.clearTimeout(id)
  }, [blockedReason])

  return (
    <div className="mg2 fixed inset-0 z-[200] grid place-items-center p-4" style={{ background: "rgba(5,7,13,.78)" }}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="mg2-review-title"
        tabIndex={-1}
        className="w-full outline-none"
        style={{ maxWidth: 640, maxHeight: "calc(100dvh - 32px)", overflowY: "auto", borderRadius: 16, background: "var(--surface)", border: "1px solid var(--border)", boxShadow: "0 16px 40px rgba(0,0,0,.45)", padding: "clamp(16px, 4vw, 28px)", display: "flex", flexDirection: "column", gap: 16 }}
        onKeyDown={(e) => {
          // Focus trap: Tab / Shift+Tab cycle inside the dialog (aria-modal).
          if (e.key === "Tab") {
            const focusables = [...(dialogRef.current?.querySelectorAll<HTMLElement>("button:not([disabled]), [href], input:not([disabled]), [tabindex]:not([tabindex='-1'])") ?? [])]
            if (focusables.length === 0) { e.preventDefault(); return }
            const first = focusables[0], last = focusables[focusables.length - 1]
            const active = document.activeElement as HTMLElement | null
            if (e.shiftKey && (active === first || active === dialogRef.current)) { e.preventDefault(); last.focus() }
            else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus() }
            return
          }
          if (e.key === "Escape") { e.preventDefault(); onBack() }
          if (e.key === "Enter" && !blockedReason) { e.preventDefault(); onConfirm() }
        }}
      >
        <div className="flex items-center justify-between gap-2">
          <h2 id="mg2-review-title" className="mg2-sub" style={{ margin: 0, fontSize: 20, lineHeight: "28px", color: "var(--text)" }}>{t("pos.v2.review_payment")}</h2>
          {offline && <span className="mg2-t-warn inline-flex items-center gap-1 rounded-md px-2 text-[12px] font-semibold" style={{ minHeight: 24 }}><CloudOff size={12} />{t("pos.v2.will_sync_later")}</span>}
        </div>

        <div className="rounded-xl p-5" style={{ background: "var(--surface-2)", border: "1px solid var(--border)" }}>
          <div className="mg2-cap" style={{ textAlign: "center" }}>{t("pos.v2.amount_due")}</div>
          <MoneyDue total={total} totalLbp={totalLbp} payableLbp={payableLbp} payableUsd={payableUsd} isCash={isCash} size="hero" align="center" />
        </div>

        {isCash ? (
          <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,200px),1fr))" }}>
            <div className="rounded-lg p-3.5" style={{ background: "var(--surface-2)", border: "1px solid var(--border)" }}>
              <div className="mg2-cap">{t("pos.v2.paid")}</div>
              <div className="num font-semibold" style={{ fontSize: 18, color: "var(--text)" }}>
                {[paidUsd > 0 ? formatCurrency(paidUsd) : "", paidLbp > 0 ? `${formatNumber(Math.round(paidLbp))} ${t("pos.v2.lbp")}` : ""].filter(Boolean).join(" + ") || formatCurrency(0)}
              </div>
            </div>
            {stillDueUsd > 0 ? (
              <div className="mg2-t-err rounded-lg p-3.5">
                <div className="mg2-cap" style={{ color: "inherit" }}>{t("pos.remaining")}</div>
                <div className="num font-semibold" style={{ fontSize: 22 }}>{formatCurrency(stillDueUsd)}</div>
              </div>
            ) : (
              <div className="mg2-t-ok rounded-lg p-3.5">
                <div className="mg2-cap" style={{ color: "inherit" }}>{t("pos.v2.change_to_give")}</div>
                <div className="num font-semibold" style={{ fontSize: 22, color: "var(--ok-money)" }}>
                  {changeUsd <= 0 && changeLbp <= 0 ? t("pos.v2.no_change") : changeInLbp ? `${formatNumber(Math.round(changeLbp))} ${t("pos.v2.lbp")}` : formatCurrency(changeUsd)}
                </div>
                <div className="mg2-cap num" style={{ color: "inherit" }}>{changeUsd <= 0 && changeLbp <= 0 ? "" : changeInLbp ? formatCurrency(changeUsd) : `${formatNumber(Math.round(changeLbp))} ${t("pos.v2.lbp")}`}</div>
              </div>
            )}
          </div>
        ) : null}

        <div className="mg2-cap">
          {t("pos.v2.review_meta", { lines: formatNumber(lines), units: formatNumber(units), method: t("pos.payment." + paymentMethod.toLowerCase()) })}
          {customerName ? ` · ${customerName}` : ""}{shiftLabel ? ` · ${shiftLabel}` : ""}
        </div>

        {blockedReason && <div role="alert" className="mg2-t-err mg2-banner text-[14px] font-semibold">{blockedReason}</div>}

        <div className="flex flex-wrap gap-3">
          <button type="button" className="mg2-btn" style={{ flex: "0 0 auto", minHeight: 56 }} onClick={onBack}>
            <ArrowLeft size={18} className="mg2-dir" />{t("pos.v2.back")} <span className="mg2-kbd">Esc</span>
          </button>
          <button ref={confirmRef} type="button" className="mg2-pay" style={{ flex: "1 1 240px", minHeight: 56, width: "auto", fontSize: 17, flexWrap: "wrap", justifyContent: "space-between" }}
            disabled={!!blockedReason} onClick={onConfirm}>
            <span>{paymentMethod === "Debt" ? t("pos.record_debt") : t("pos.v2.confirm_and_pay")}</span>
            <span className="num" style={{ whiteSpace: "nowrap" }}>{amountLabel}</span>
            <span className="mg2-kbd hidden sm:inline">Enter</span>
          </button>
        </div>
      </div>
    </div>
  )
}

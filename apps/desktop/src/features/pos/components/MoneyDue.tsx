import { useI18n } from "@lebanonpos/shared"

import { formatCurrency, formatNumber } from "../lib/currency"

/**
 * The amount due, Midnight Gold v2 money rule (DESIGN-SYSTEM §7 "Money"):
 * USD first at total size. When the tender is cash and LBP rounding applies,
 * the second line is the PAYABLE cash amount the change is computed from
 * (both currencies), with what it was rounded from directly under it — never
 * a nominal LBP figure next to a change computed from a different one.
 * Presentation only: all amounts come from POSPage.
 */
export default function MoneyDue({
  total, totalLbp, payableLbp, payableUsd, isCash, size = "total", label, align = "end",
}: {
  total: number
  totalLbp: number
  payableLbp: number
  payableUsd: number
  isCash: boolean
  size?: "total" | "hero"
  label?: string
  align?: "end" | "center"
}) {
  const { t } = useI18n()
  const rounded = isCash && payableLbp !== totalLbp
  return (
    <div className="flex items-start justify-between gap-3">
      {label && <span className="mg2-sub shrink-0 whitespace-nowrap" style={{ color: "var(--text-2)", lineHeight: size === "hero" ? "68px" : "48px" }}>{label}</span>}
      <div className="num min-w-0" style={align === "center" ? { textAlign: "center", margin: "0 auto" } : { textAlign: "end", marginInlineStart: "auto" }}>
        <div className={size === "hero" ? "mg2-hero" : "mg2-total"}>{formatCurrency(total)}</div>
        {rounded ? (
          <>
            <div className="mg2-sub" style={{ color: "var(--text)" }}>
              {t("pos.v2.cash_payable", { lbp: formatNumber(Math.round(payableLbp)), usd: formatCurrency(payableUsd) })}
            </div>
            <div className="mg2-cap">{t("pos.v2.rounded_from", { lbp: formatNumber(Math.round(totalLbp)) })}</div>
          </>
        ) : (
          <div className="mg2-sub" style={{ color: "var(--text-2)" }}>{formatNumber(Math.round(totalLbp))} {t("pos.v2.lbp")}</div>
        )}
      </div>
    </div>
  )
}

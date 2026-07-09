import type { RefObject } from "react"
import { CreditCard, HandCoins, Landmark, WalletCards } from "lucide-react"
import type { LucideIcon } from "lucide-react"
import { Link } from "react-router"
import { useI18n } from "@lebanonpos/shared"

import { formatCurrency, formatLbpCurrency, usdToLbp } from "../lib/currency"

type PaymentMethod = "Cash" | "Card" | "Wallet" | "Debt"

type TenderCustomer = {
  id: string
  name: string
  mobile: string
  balance: number
  creditLimit?: number
}

const paymentOptions: { label: PaymentMethod; icon: LucideIcon }[] = [
  { label: "Cash",   icon: Landmark    },
  { label: "Card",   icon: CreditCard  },
  { label: "Wallet", icon: WalletCards },
  { label: "Debt",   icon: HandCoins   },
]

export interface TenderPanelProps {
  /** "full" = main POS cart rail density; "quick" = QuickPOS XL touch density. */
  density: "full" | "quick"
  paymentMethod: PaymentMethod
  onSelectPayment: (method: PaymentMethod) => void
  itemsCount: number
  paidUsd: string
  paidLbp: string
  onPaidUsdChange: (value: string) => void
  onPaidLbpChange: (value: string) => void
  onFillExactTender: (currency: "USD" | "LBP") => void
  cashTenderValid: boolean
  paidTotalUsd: number
  paidTotalLbp: number
  cashChangeUsd: number
  cashChangeLbp: number
  cashStillDueUsd: number
  exchangeRate: number
  total: number
  customers: TenderCustomer[]
  selectedCustomerId: string
  onSelectCustomer: (id: string) => void
  selectedCustomer?: TenderCustomer
  creditLimitExceeded?: boolean
  usdInputRef?: RefObject<HTMLInputElement | null>
  lbpInputRef?: RefObject<HTMLInputElement | null>
  onUsdEnter?: () => void
  onLbpEnter?: () => void
}

/**
 * The single tender engine (Midnight Gold): payment method row, cash tender
 * (inputs, quick-cash banknote chips, exact buttons, change/still-due), and
 * debt customer picker. Consumed by both the main POS cart and QuickPOS —
 * one payment UX standard, two densities. Pure presentation: all state and
 * money math live in POSPage.
 */
export default function TenderPanel({
  density,
  paymentMethod, onSelectPayment,
  itemsCount,
  paidUsd, paidLbp, onPaidUsdChange, onPaidLbpChange, onFillExactTender,
  cashTenderValid, paidTotalUsd, paidTotalLbp,
  cashChangeUsd, cashChangeLbp, cashStillDueUsd,
  exchangeRate, total,
  customers, selectedCustomerId, onSelectCustomer, selectedCustomer,
  creditLimitExceeded,
  usdInputRef, lbpInputRef, onUsdEnter, onLbpEnter,
}: TenderPanelProps) {
  const { t } = useI18n()
  const quick = density === "quick"

  const inputStyle: React.CSSProperties = quick
    ? { height: 56, fontSize: 22, fontWeight: 700, background: "var(--surface-2)", color: "var(--text)", border: "1px solid var(--border)" }
    : { height: 38, fontSize: 14, fontWeight: 700, background: "var(--surface-2)", color: "var(--text)", border: "1px solid var(--border)" }

  const chipClass = quick
    ? "min-h-[44px] flex-1 basis-[28%] rounded-lg border text-[13px] font-bold tabular-nums transition active:scale-[0.94] disabled:opacity-30"
    : "rounded-lg border px-2.5 py-1.5 text-[11px] font-bold tabular-nums transition active:scale-[0.95] disabled:opacity-30"

  return (
    <div className="space-y-3">
      {/* Payment method */}
      <div className={quick ? "grid grid-cols-4 gap-1.5" : "flex items-center gap-1.5"}>
        {paymentOptions.map(({ label, icon: Icon }) => {
          const active = paymentMethod === label
          return (
            <button
              key={label}
              type="button"
              onClick={() => onSelectPayment(label)}
              aria-pressed={active}
              className={`flex items-center justify-center gap-1.5 rounded-lg border font-bold transition active:scale-[0.96] ${
                quick ? "py-3 text-[12px]" : "flex-1 py-2 text-[11px]"
              }`}
              style={active
                ? { background: "var(--brand)", borderColor: "var(--brand)", color: "var(--brand-contrast)" }
                : { background: "var(--surface-2)", borderColor: "var(--border)", color: "var(--text-2)" }}
            >
              <Icon size={quick ? 15 : 13} />
              {t("pos.payment." + label.toLowerCase())}
            </button>
          )
        })}
      </div>

      {/* Cash tender */}
      {paymentMethod === "Cash" && (
        <div
          className="rounded-xl border p-3 space-y-3"
          style={{ borderColor: "var(--brand-border)", background: "var(--surface)" }}
        >
          <p className="text-[11px] font-bold uppercase tracking-wide" style={{ color: "var(--brand-text)" }}>
            {t("pos.cash_tender")}
          </p>

          <div className="grid gap-2 sm:grid-cols-2">
            <label className="block text-[11px] font-bold" style={{ color: "var(--text)" }}>
              {t("pos.paid_usd")}
              <input
                ref={usdInputRef}
                type="number" min="0" step="0.01" inputMode="decimal"
                value={paidUsd}
                onChange={(e) => onPaidUsdChange(e.target.value)}
                onKeyDown={onUsdEnter ? (e) => { if (e.key === "Enter") { e.preventDefault(); onUsdEnter() } } : undefined}
                className="input mt-1 w-full tabular-nums"
                style={inputStyle}
              />
            </label>
            <label className="block text-[11px] font-bold" style={{ color: "var(--text)" }}>
              {t("pos.paid_lbp")}
              <input
                ref={lbpInputRef}
                type="number" min="0" step="1000" inputMode="decimal"
                value={paidLbp}
                onChange={(e) => onPaidLbpChange(e.target.value)}
                onKeyDown={onLbpEnter ? (e) => { if (e.key === "Enter") { e.preventDefault(); onLbpEnter() } } : undefined}
                className="input mt-1 w-full tabular-nums"
                style={inputStyle}
              />
            </label>
          </div>

          {/* Quick-cash chips: tap a banknote to ADD it to the tender */}
          <div className="flex flex-wrap gap-1.5">
            {[1, 5, 10, 20, 50, 100].map((note) => (
              <button
                key={`usd-${note}`}
                type="button"
                disabled={itemsCount === 0}
                onClick={() => onPaidUsdChange(String((parseFloat(paidUsd) || 0) + note))}
                className={chipClass}
                style={{ borderColor: "var(--border-strong)", background: "var(--surface-2)", color: "var(--text)" }}
              >
                ${note}
              </button>
            ))}
            {[100_000, 250_000, 500_000, 1_000_000].map((note) => (
              <button
                key={`lbp-${note}`}
                type="button"
                disabled={itemsCount === 0}
                onClick={() => onPaidLbpChange(String((parseFloat(paidLbp) || 0) + note))}
                className={chipClass}
                style={{ borderColor: "var(--border-strong)", background: "var(--surface-2)", color: "var(--text-2)" }}
              >
                {note >= 1_000_000 ? `${note / 1_000_000}M` : `${note / 1000}k`} LL
              </button>
            ))}
          </div>

          <div className="flex gap-2">
            <button type="button" onClick={() => onFillExactTender("USD")} disabled={itemsCount === 0}
              className={`flex-1 rounded-lg font-bold transition active:scale-[0.97] disabled:opacity-30 ${quick ? "py-2.5 text-[12px]" : "py-1.5 text-[11px]"}`}
              style={{ background: "var(--brand)", color: "var(--brand-contrast)" }}>
              {t("pos.exact_usd")}
            </button>
            <button type="button" onClick={() => onFillExactTender("LBP")} disabled={itemsCount === 0}
              className={`flex-1 rounded-lg font-bold transition active:scale-[0.97] disabled:opacity-30 ${quick ? "py-2.5 text-[12px]" : "py-1.5 text-[11px]"}`}
              style={{ background: "var(--brand)", color: "var(--brand-contrast)" }}>
              {t("pos.exact_lbp")}
            </button>
          </div>

          {!cashTenderValid && itemsCount > 0 && (
            <p className="text-[11px] font-semibold" style={{ color: "var(--rose)" }}>{t("pos.insufficient_payment")}</p>
          )}

          {cashTenderValid && paidTotalUsd > 0 && (
            <div
              className="rounded-xl p-3 space-y-2"
              style={{ background: "var(--brand-soft)", border: "1px solid var(--brand-border)" }}
            >
              <div className="flex items-center justify-between text-[12px]" style={{ color: "var(--text)" }}>
                <span className="font-semibold">{t("pos.paid_total")}</span>
                <span className="font-bold tabular-nums">
                  {formatCurrency(paidTotalUsd)}
                  <span className="mx-1 opacity-40">/</span>
                  {formatLbpCurrency(paidTotalLbp)}
                </span>
              </div>

              {/* Change / Remaining — semantic green/red, the second-loudest number */}
              <div
                className="flex items-center justify-between rounded-lg px-3 py-2"
                style={{ background: "var(--surface)", border: "1px solid var(--brand-border)" }}
              >
                <span className="text-[13px] font-bold" style={{ color: cashChangeUsd > 0 ? "var(--success-text)" : "var(--danger-text)" }}>
                  {cashChangeUsd > 0 ? t("pos.change") : t("pos.remaining")}
                </span>
                <div className="text-end">
                  <span
                    className="block tabular-nums leading-none font-bold"
                    style={{
                      fontSize: quick ? 40 : cashChangeUsd > 0 ? 22 : 28,
                      color: cashChangeUsd > 0 ? "var(--success-text)" : "var(--danger-text)",
                    }}
                  >
                    {cashChangeUsd > 0 ? formatCurrency(cashChangeUsd) : formatCurrency(cashStillDueUsd)}
                  </span>
                  <span className="block text-[11px] font-semibold tabular-nums mt-0.5" style={{ color: "var(--text-2)" }}>
                    {cashChangeUsd > 0
                      ? formatLbpCurrency(cashChangeLbp)
                      : formatLbpCurrency(usdToLbp(cashStillDueUsd, exchangeRate))
                    }
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Debt: customer picker */}
      {paymentMethod === "Debt" && (
        <div
          className="rounded-xl border p-3 space-y-2"
          style={{ borderColor: "var(--amber-soft)", background: "var(--amber-soft)" }}
        >
          <p className="text-[11px] font-bold uppercase tracking-wide" style={{ color: "var(--amber-text)" }}>
            {t("pos.customer_debt")}
          </p>
          {customers.length > 0 ? (
            <>
              {!selectedCustomerId && (
                <p className="text-[12px] font-semibold" style={{ color: "var(--rose)" }}>{t("pos.select_customer_hint")}</p>
              )}
              <select
                value={selectedCustomerId}
                onChange={(e) => onSelectCustomer(e.target.value)}
                className="input w-full"
                style={{ height: quick ? 52 : 38, fontSize: quick ? 14 : 13 }}
              >
                {quick && <option value="">— {t("pos.select_customer_hint")} —</option>}
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>{c.name} — {c.mobile}</option>
                ))}
              </select>
              <div className="space-y-1">
                <div className="flex justify-between text-[12px]" style={{ color: "var(--amber-text)" }}>
                  <span>{t("pos.current_balance")}</span>
                  <span className="font-bold tabular-nums">{formatCurrency(selectedCustomer?.balance ?? 0)}</span>
                </div>
                <div className="flex justify-between text-[12px]" style={{ color: "var(--amber-text)" }}>
                  <span>{t("pos.after_sale")}</span>
                  <span className="font-bold tabular-nums">{formatCurrency((selectedCustomer?.balance ?? 0) + total)}</span>
                </div>
                {(selectedCustomer?.creditLimit ?? 0) > 0 && (
                  <div className="flex justify-between text-[12px]" style={{ color: creditLimitExceeded ? "var(--rose)" : "var(--amber-text)" }}>
                    <span>{t("pos.credit_limit")}</span>
                    <span className="font-bold tabular-nums">{formatCurrency(selectedCustomer!.creditLimit!)}</span>
                  </div>
                )}
              </div>
            </>
          ) : (
            <Link to="/customers"
              className="flex h-9 w-full items-center justify-center rounded-lg text-[12px] font-bold transition hover:opacity-90"
              style={{ background: "var(--text)", color: "var(--text-inverse)" }}>
              {t("pos.add_customer")}
            </Link>
          )}
        </div>
      )}
    </div>
  )
}

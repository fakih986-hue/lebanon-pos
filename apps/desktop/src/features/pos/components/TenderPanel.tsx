import { useMemo, useState, type RefObject } from "react"
import { Banknote, Check, CreditCard, HandCoins, WalletCards } from "lucide-react"
import type { LucideIcon } from "lucide-react"
import { Link } from "react-router"
import { useI18n } from "@lebanonpos/shared"

import { formatCurrency, formatNumber, usdToLbp } from "../lib/currency"

type PaymentMethod = "Cash" | "Card" | "Wallet" | "Debt"

type TenderCustomer = {
  id: string
  name: string
  mobile: string
  balance: number
  creditLimit?: number
}

/** F2–F5 select the tender from anywhere in the register (POSPage hotkeys). */
const paymentOptions: { label: PaymentMethod; icon: LucideIcon; key: string }[] = [
  { label: "Cash",   icon: Banknote,    key: "F2" },
  { label: "Card",   icon: CreditCard,  key: "F3" },
  { label: "Wallet", icon: WalletCards, key: "F4" },
  { label: "Debt",   icon: HandCoins,   key: "F5" },
]

export interface TenderPanelProps {
  /** "full" = main POS cart rail density; "quick" = Simple POS XL touch density. */
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
 * The single tender engine (Midnight Gold v2, DESIGN-SYSTEM §7–8): tender
 * SegmentedControl on native radios, LTR money inputs, banknote and exact
 * buttons, live change / still due, and the debt customer picker. Used by the
 * register rail and Simple POS. Pure presentation: all state and money math
 * live in POSPage (the exact buttons fill the cash-payable amount).
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
  const [customerSearch, setCustomerSearch] = useState("")

  const filteredCustomers = useMemo(() => {
    if (!customerSearch.trim()) return customers
    const q = customerSearch.trim().toLowerCase()
    return customers.filter(c =>
      c.name.toLowerCase().includes(q) || c.mobile.includes(q)
    )
  }, [customers, customerSearch])

  const noItems = itemsCount === 0
  // Change is given in LBP only for a pure-LBP tender; USD and mixed tenders give USD change
  // (POSPage tender.changeCurrency). The display leads with the currency actually handed back.
  const changeInLbp = (parseFloat(paidLbp) || 0) > 0 && !(parseFloat(paidUsd) || 0)
  const lbp = t("pos.v2.lbp")

  return (
    <div className="flex flex-col gap-3">
      {/* Tender: one radiogroup, arrow keys move and select */}
      <div className={`mg2-seg ${quick ? "mg2-seg-xl" : ""}`} role="radiogroup" aria-label={t("pos.v2.payment_method")}
        style={{ gridTemplateColumns: "repeat(4,minmax(0,1fr))" }}>
        {paymentOptions.map(({ label, icon: Icon, key }) => (
          <label key={label}>
            <input type="radio" name={`tender-${density}`} value={label} checked={paymentMethod === label} onChange={() => onSelectPayment(label)} />
            <Icon size={16} className="mg2-ico" aria-hidden="true" />
            <Check size={14} className="mg2-chk" aria-hidden="true" />
            <span>{t("pos.payment." + label.toLowerCase())}</span>
            {!quick && <span className="mg2-kbd hidden xl:inline">{key}</span>}
          </label>
        ))}
      </div>

      {/* Cash tender */}
      {paymentMethod === "Cash" && (
        <>
          <div className="grid gap-2" style={{ gridTemplateColumns: "repeat(2,minmax(0,1fr))" }}>
            <label className="block">
              <span className="mg2-label">{t("pos.paid_usd")}</span>
              <span className={`mg2-money ${quick ? "mg2-money-xl" : ""}`} dir="ltr">
                <span className="mg2-adorn">$</span>
                <input
                  ref={usdInputRef}
                  type="number" min="0" step="0.01" inputMode="decimal"
                  aria-label={t("pos.paid_usd")}
                  value={paidUsd}
                  onChange={(e) => onPaidUsdChange(e.target.value)}
                  onKeyDown={onUsdEnter ? (e) => { if (e.key === "Enter") { e.preventDefault(); onUsdEnter() } } : undefined}
                />
              </span>
            </label>
            <label className="block">
              <span className="mg2-label">{t("pos.paid_lbp")}</span>
              <span className={`mg2-money ${quick ? "mg2-money-xl" : ""}`} dir="ltr">
                <input
                  ref={lbpInputRef}
                  type="number" min="0" step="1000" inputMode="decimal"
                  aria-label={t("pos.paid_lbp")}
                  value={paidLbp}
                  onChange={(e) => onPaidLbpChange(e.target.value)}
                  onKeyDown={onLbpEnter ? (e) => { if (e.key === "Enter") { e.preventDefault(); onLbpEnter() } } : undefined}
                />
                <span className="mg2-adorn">{lbp}</span>
              </span>
            </label>
          </div>

          {/* Exact amounts and banknotes: tapping a note ADDS it to the tender */}
          <div className="flex flex-wrap gap-2" role="group" aria-label={t("pos.v2.quick_cash")}>
            <button type="button" className="mg2-btn" disabled={noItems} onClick={() => onFillExactTender("USD")}>{t("pos.exact_usd")}</button>
            <button type="button" className="mg2-btn" disabled={noItems} onClick={() => onFillExactTender("LBP")}>{t("pos.exact_lbp")}</button>
            {[5, 10, 20, 50, 100].map((note) => (
              <button key={`usd-${note}`} type="button" className="mg2-btn num" style={{ padding: "0 14px" }} disabled={noItems}
                aria-label={t("pos.v2.add_note", { note: `$${note}` })}
                onClick={() => onPaidUsdChange(String((parseFloat(paidUsd) || 0) + note))}>
                +${note}
              </button>
            ))}
            {[100_000, 500_000, 1_000_000].map((note) => (
              <button key={`lbp-${note}`} type="button" className="mg2-btn num" style={{ padding: "0 14px" }} disabled={noItems}
                aria-label={t("pos.v2.add_note", { note: `${formatNumber(note)} ${lbp}` })}
                onClick={() => onPaidLbpChange(String((parseFloat(paidLbp) || 0) + note))}>
                +{note >= 1_000_000 ? `${note / 1_000_000}M` : `${note / 1000}k`}
              </button>
            ))}
          </div>

          {/* Change due / still due — computed from the cash-payable amount */}
          {!noItems && (cashTenderValid && paidTotalUsd > 0 ? (
            <div className="mg2-banner mg2-t-ok" role="status" aria-live="polite">
              <span className="mg2-sub" style={{ color: "inherit" }}>{t("pos.v2.change_due")}</span>
              <span className="num" style={{ marginInlineStart: "auto", textAlign: "end" }}>
                <span className="block font-semibold" style={{ fontSize: quick ? 32 : 22, lineHeight: 1.2, color: "var(--ok-money)" }}>{cashChangeUsd <= 0 && cashChangeLbp <= 0 ? t("pos.v2.no_change") : changeInLbp ? `${formatNumber(Math.round(cashChangeLbp))} ${lbp}` : formatCurrency(cashChangeUsd)}</span>
                <span className="mg2-cap block" style={{ color: "inherit" }}>{changeInLbp ? formatCurrency(cashChangeUsd) : `${formatNumber(Math.round(cashChangeLbp))} ${lbp}`} · {t("pos.v2.paid")} {formatCurrency(paidTotalUsd)} / {formatNumber(Math.round(paidTotalLbp))} {lbp}</span>
              </span>
            </div>
          ) : paidTotalUsd > 0 ? (
            <div className="mg2-banner mg2-t-warn" role="status" aria-live="polite">
              <span className="mg2-sub" style={{ color: "inherit" }}>{t("pos.v2.still_due")}</span>
              <span className="num font-semibold" style={{ marginInlineStart: "auto", textAlign: "end", fontSize: quick ? 28 : 20 }}>
                {formatCurrency(cashStillDueUsd)}
                <span className="mg2-cap block" style={{ color: "inherit" }}>{formatNumber(Math.round(usdToLbp(cashStillDueUsd, exchangeRate)))} {lbp}</span>
              </span>
            </div>
          ) : (
            <p className="mg2-cap" style={{ margin: 0 }}>{t("pos.v2.enter_cash")}</p>
          ))}
        </>
      )}

      {/* Debt: customer picker */}
      {paymentMethod === "Debt" && (
        <div className="rounded-xl p-3 flex flex-col gap-2" style={{ background: "var(--v2-warn-soft)", border: "1px solid var(--border)" }}>
          <p className="mg2-sub" style={{ margin: 0, color: "var(--text)" }}>{t("pos.customer_debt")}</p>
          {customers.length > 0 ? (
            <>
              {!selectedCustomerId && (
                <p className="mg2-cap" style={{ margin: 0, color: "var(--v2-err)" }}>{t("pos.select_customer_hint")}</p>
              )}
              <input
                type="text"
                value={customerSearch}
                onChange={(e) => setCustomerSearch(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && filteredCustomers.length > 0) {
                    e.preventDefault()
                    onSelectCustomer(filteredCustomers[0].id)
                    setCustomerSearch("")
                  }
                }}
                placeholder={selectedCustomer ? `${selectedCustomer.name} · ${selectedCustomer.mobile}` : t("pos.v2.search_customer")}
                className="input w-full"
                style={{ minHeight: 48, fontSize: 14, borderColor: "var(--border-input)" }}
                aria-label={t("pos.v2.search_customer")}
                autoComplete="off"
              />
              {(!selectedCustomerId || customerSearch.trim()) && filteredCustomers.length > 0 && (
                <div className="max-h-48 overflow-y-auto rounded-lg border" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
                  {filteredCustomers.slice(0, 10).map(c => (
                    <button key={c.id} type="button"
                      onClick={() => { onSelectCustomer(c.id); setCustomerSearch("") }}
                      className="flex w-full items-center justify-between px-3 text-[14px] font-semibold"
                      style={{ minHeight: 48, color: "var(--text)" }}>
                      <span>{c.name} · <span className="num" dir="ltr">{c.mobile}</span></span>
                      {c.balance > 0 && (
                        <span className={`num rounded-md px-2 text-[12px] font-semibold ${c.creditLimit && c.balance > c.creditLimit ? "mg2-t-err" : "mg2-t-warn"}`}>
                          {formatCurrency(c.balance)}
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              )}
              {selectedCustomer && !customerSearch.trim() && (
                <div className="flex flex-col gap-1 text-[14px]" style={{ color: "var(--text)" }}>
                  <div className="flex justify-between"><span style={{ color: "var(--text-2)" }}>{t("pos.current_balance")}</span><span className="num font-semibold">{formatCurrency(selectedCustomer.balance ?? 0)}</span></div>
                  <div className="flex justify-between"><span style={{ color: "var(--text-2)" }}>{t("pos.after_sale")}</span><span className="num font-semibold">{formatCurrency((selectedCustomer.balance ?? 0) + total)}</span></div>
                  {(selectedCustomer.creditLimit ?? 0) > 0 && (
                    <div className="flex justify-between"><span style={{ color: "var(--text-2)" }}>{t("pos.credit_limit")}</span><span className="num font-semibold">{formatCurrency(selectedCustomer.creditLimit!)}</span></div>
                  )}
                  {creditLimitExceeded && (
                    <p role="alert" className="mg2-t-err rounded-md px-2 py-1.5 text-[14px] font-semibold" style={{ margin: 0 }}>
                      {t("pos.v2.over_limit", { amount: formatCurrency((selectedCustomer.balance ?? 0) + total - (selectedCustomer.creditLimit ?? 0)) })}
                    </p>
                  )}
                </div>
              )}
            </>
          ) : (
            <Link to="/customers" className="mg2-btn" style={{ textDecoration: "none" }}>{t("pos.add_customer")}</Link>
          )}
        </div>
      )}
    </div>
  )
}

import { useState, useRef, useEffect } from "react"
import { useI18n } from "@lebanonpos/shared"
import {
  BadgePercent,
  ChevronDown,
  CreditCard,
  Eraser,
  HandCoins,
  Landmark,
  MessageSquare,
  PauseCircle,
  PlayCircle,
  ShoppingCart,
  WalletCards,
} from "lucide-react"
import type { LucideIcon } from "lucide-react"
import { Link } from "react-router"

import CartItemCard from "./CartItemCard"
import {
  formatCurrency,
  formatLbpCurrency,
  usdToLbp,
} from "../lib/currency"
import type { HeldSale } from "../services/heldSale.service"
import {
  formatVatRate,
  getHeldSaleItemCount,
  getHeldSaleTotal,
} from "../lib/helpers"
import type { CustomerLedger } from "../services/customer.service"

type PaymentMethod = "Cash" | "Card" | "Wallet" | "Debt"
type TenderMode = "USD" | "LBP" | "Mixed"
type DiscountMode = "USD" | "Percent"

type PaymentOption = { label: PaymentMethod; icon: LucideIcon }

// Design law: payment methods carry no per-method color in tender UI.
// Active = the zone's single gold element (dark text on gold).
const paymentOptions: PaymentOption[] = [
  { label: "Cash",   icon: Landmark    },
  { label: "Card",   icon: CreditCard  },
  { label: "Wallet", icon: WalletCards },
  { label: "Debt",   icon: HandCoins   },
]

interface CartItem { id: number; name: string; price: number; quantity: number; stock: number }

interface Props {
  items: CartItem[]
  onIncreaseQty: (id: number) => void
  onDecreaseQty: (id: number) => void
  onRemoveItem: (id: number) => void
  onSetQuantity: (id: number, qty: number) => void
  onSetPrice: (id: number, price: number) => void
  saleNote: string
  onSaleNoteChange: (note: string) => void
  heldSales: HeldSale[]
  onResumeHeld: (sale: HeldSale) => void
  onDiscardHeld: (sale: HeldSale) => void
  vatRate: number
  customers: CustomerLedger[]
  selectedCustomerId: string
  onSelectCustomer: (id: string) => void
  selectedCustomer: CustomerLedger | undefined
  paymentMethod: PaymentMethod
  onSelectPayment: (method: PaymentMethod) => void
  paidUsd: string
  paidLbp: string
  onPaidUsdChange: (value: string) => void
  onPaidLbpChange: (value: string) => void
  onFillExactTender: (currency: "USD" | "LBP") => void
  discountMode: DiscountMode
  discountValue: string
  onDiscountModeChange: (mode: DiscountMode) => void
  onDiscountValueChange: (value: string) => void
  onHold: () => void
  onClean: () => void
  onCompleteSale: () => void
  itemCount: number
  grossSubtotal: number
  discountTotal: number
  subtotal: number
  tax: number
  total: number
  totalLbp: number
  exchangeRate: number
  paidTotalUsd: number
  paidTotalLbp: number
  cashChangeUsd: number
  cashChangeLbp: number
  cashStillDueUsd: number
  cashTenderValid: boolean
  creditLimitExceeded: boolean
  checkoutBlocked: boolean
  hasDiscount: boolean
  heldSalesItemCount: number
  canApplyDiscount: boolean
  sellAtCost: boolean
  onToggleSellAtCost: () => void
}

export default function CartBody({
  items, onIncreaseQty, onDecreaseQty, onRemoveItem,
  onSetQuantity, onSetPrice,
  saleNote, onSaleNoteChange,
  heldSales, onResumeHeld, onDiscardHeld,
  vatRate, customers, selectedCustomerId, onSelectCustomer, selectedCustomer,
  paymentMethod, onSelectPayment,
  paidUsd, paidLbp, onPaidUsdChange, onPaidLbpChange, onFillExactTender,
  discountMode, discountValue, onDiscountModeChange, onDiscountValueChange,
  onHold, onClean, onCompleteSale,
  itemCount, grossSubtotal, discountTotal, subtotal, tax, total, totalLbp, exchangeRate,
  paidTotalUsd, paidTotalLbp, cashChangeUsd, cashChangeLbp, cashStillDueUsd,
  cashTenderValid, creditLimitExceeded, checkoutBlocked, hasDiscount, heldSalesItemCount,   canApplyDiscount,
  sellAtCost, onToggleSellAtCost,
}: Props) {
  const [discountOpen, setDiscountOpen] = useState(false)
  const [heldOpen, setHeldOpen] = useState(false)
  const { t } = useI18n()
  const usdInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (paymentMethod === "Cash" && usdInputRef.current) {
      usdInputRef.current.focus()
    }
  }, [paymentMethod])

  const checkoutLabel = creditLimitExceeded
    ? t("pos.credit_exceeded")
    : paymentMethod === "Cash" && !cashTenderValid
      ? `${t("pos.complete_sale")} — ${formatCurrency(total)}`
      : paymentMethod === "Debt"
        ? `${t("pos.record_debt")} — ${formatCurrency(total)}`
        : `${t("pos.complete_sale")} — ${formatCurrency(total)}`

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-3 space-y-3" style={{ background: "var(--surface-2)" }}>
      {/* Items */}
      {items.length > 0 ? (
        <div className="space-y-2">
          {items.map((item) => (
            <CartItemCard
              key={item.id}
              name={item.name}
              quantity={item.quantity}
              unitPrice={item.price}
              totalPrice={item.price * item.quantity}
              atCost={sellAtCost}
              onIncrease={() => onIncreaseQty(item.id)}
              onDecrease={() => onDecreaseQty(item.id)}
              onRemove={() => onRemoveItem(item.id)}
              onSetQuantity={(qty) => onSetQuantity(item.id, qty)}
              onSetPrice={(price) => onSetPrice(item.id, price)}
            />
          ))}
        </div>
      ) : (
        <div
          className="flex min-h-56 flex-col items-center justify-center rounded-xl border-2 border-dashed gap-3"
          style={{ borderColor: "var(--border)", background: "var(--surface)" }}
        >
          <ShoppingCart size={36} style={{ color: "var(--text-3)" }} />
          <div className="text-center">
            <p className="text-[14px] font-semibold" style={{ color: "var(--text-2)" }}>{t("pos.cart_empty")}</p>
            <p className="text-[12px] mt-0.5" style={{ color: "var(--text-3)" }}>{t("pos.cart_empty_hint")}</p>
          </div>
        </div>
      )}

      {/* Held sales */}
      {heldSales.length > 0 && (
        <div className="rounded-xl border overflow-hidden" style={{ borderColor: "var(--border)" }}>
          <button
            type="button"
            onClick={() => setHeldOpen(!heldOpen)}
            className="flex w-full items-center justify-between gap-3 px-3 py-2.5"
            style={{ background: "var(--surface-2)" }}
          >
            <span className="flex items-center gap-2 text-[12px] font-semibold" style={{ color: "var(--text-2)" }}>
              <PauseCircle size={14} />
              {t("pos.held_sales")}
              <span
                className="rounded-full px-2 py-0.5 text-[10px] font-bold"
                style={{ background: "var(--surface-3)", color: "var(--text-2)" }}
              >
                {heldSales.length}
              </span>
            </span>
            <ChevronDown size={14} className={`transition ${heldOpen ? "rotate-180" : ""}`} style={{ color: "var(--text-3)" }} />
          </button>

          {heldOpen && (
            <div className="divide-y p-2 space-y-1.5" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
              {heldSales.slice(0, 4).map((sale) => (
                <div key={sale.id} className="rounded-lg p-2.5" style={{ background: "var(--surface-2)" }}>
                  <div className="flex items-center justify-between gap-3 mb-2">
                    <p className="text-[12px] font-bold" style={{ color: "var(--text)" }}>{sale.holdNumber}</p>
                    <p className="text-[12px] font-bold" style={{ color: "var(--text)" }}>
                      {formatCurrency(getHeldSaleTotal(sale, vatRate))}
                    </p>
                  </div>
                  <div className="grid grid-cols-2 gap-1.5">
                    <button
                      type="button"
                      onClick={() => onResumeHeld(sale)}
                      disabled={items.length > 0}
                      className="flex h-8 items-center justify-center gap-1.5 rounded-lg text-[12px] font-semibold transition disabled:opacity-30"
                      style={{ background: "var(--text)", color: "var(--surface)" }}
                    >
                      <PlayCircle size={13} />
                      {t("pos.resume")}
                    </button>
                    <button
                      type="button"
                      onClick={() => onDiscardHeld(sale)}
                      className="flex h-8 items-center justify-center gap-1.5 rounded-lg border text-[12px] font-semibold transition hover:opacity-80"
                      style={{ borderColor: "var(--border)", color: "var(--text-2)" }}
                    >
                      <Eraser size={12} />
                      {t("pos.discard")}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Sale note */}
      <div>
        <label className="flex items-center gap-1.5 mb-1.5 text-[11px] font-semibold uppercase tracking-wide" style={{ color: "var(--text-3)" }}>
          <MessageSquare size={12} />
          {t("pos.sale_note")}
        </label>
        <input
          type="text"
          value={saleNote}
          onChange={(e) => onSaleNoteChange(e.target.value)}
          placeholder={t("pos.sale_note_placeholder")}
          maxLength={120}
          className="input w-full"
          style={{ height: 36, fontSize: 13 }}
        />
      </div>

      {/* Payment method */}
      <div className="flex items-center gap-1.5">
        {paymentOptions.map(({ label, icon: Icon }) => {
          const active = paymentMethod === label
          return (
            <button
              key={label}
              type="button"
              onClick={() => onSelectPayment(label)}
              aria-pressed={active}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border py-2 text-[11px] font-bold transition active:scale-[0.96]"
              style={active
                ? { background: "var(--brand)", borderColor: "var(--brand)", color: "var(--brand-contrast)" }
                : { background: "var(--surface-2)", borderColor: "var(--border)", color: "var(--text-2)" }}
            >
              <Icon size={13} />
              {t("pos.payment." + label.toLowerCase())}
            </button>
          )
        })}
      </div>

      {/* Discount */}
      <div className="rounded-xl border overflow-hidden" style={{ borderColor: "var(--border)" }}>
        <button
          type="button"
          onClick={() => setDiscountOpen(!discountOpen)}
          className="flex w-full items-center justify-between gap-3 px-3 py-2.5"
          style={{ background: "var(--surface-2)" }}
        >
          <span className="flex items-center gap-2 text-[12px] font-semibold" style={{ color: "var(--text-2)" }}>
            <BadgePercent size={14} />
            {t("pos.discount")}
          </span>
          <div className="flex items-center gap-2">
            {hasDiscount && (
              <span
                className="rounded-full px-2 py-0.5 text-[10px] font-bold"
                style={{ background: "var(--brand-soft)", color: "var(--brand-text)" }}
              >
                -{formatCurrency(discountTotal)}
              </span>
            )}
            <ChevronDown size={14} className={`transition ${discountOpen ? "rotate-180" : ""}`} style={{ color: "var(--text-3)" }} />
          </div>
        </button>

        {discountOpen && (
          <div className="px-3 pb-3 pt-2" style={{ background: "var(--surface)" }}>
            {canApplyDiscount ? (
              <div className="space-y-2">
                <div className="grid grid-cols-2 gap-2">
                  {(["USD", "Percent"] as DiscountMode[]).map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => onDiscountModeChange(mode)}
                      className={`h-8 rounded-lg border text-[12px] font-bold transition ${
                        discountMode === mode
                          ? "border-[var(--text)] bg-[var(--text)] text-[var(--surface)]"
                          : "border-[var(--border)] bg-[var(--surface-2)] text-[var(--text-2)]"
                      }`}
                    >
                      {mode === "USD" ? t("pos.dollar_off") : t("pos.percent_off")}
                    </button>
                  ))}
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="number" min="0"
                    max={discountMode === "Percent" ? 100 : undefined}
                    step={discountMode === "Percent" ? 1 : 0.01}
                    value={discountValue}
                    onChange={(e) => onDiscountValueChange(e.target.value)}
                    placeholder={discountMode === "Percent" ? "10" : "1.00"}
                    className="input flex-1"
                    style={{ height: 36, fontSize: 13 }}
                  />
                  {(discountMode === "Percent" ? [5, 10, 15] : [1, 5, 10]).map((v) => (
                    <button
                      key={v}
                      type="button"
                      onClick={() => onDiscountValueChange(String(v))}
                      className="h-9 rounded-lg border px-2.5 text-[11px] font-bold transition hover:opacity-80"
                      style={{ borderColor: "var(--border)", background: "var(--surface-2)", color: "var(--text-2)" }}
                    >
                      {discountMode === "Percent" ? `${v}%` : `$${v}`}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <p className="text-[12px]" style={{ color: "var(--text-3)" }}>{t("pos.permission_required")}</p>
            )}
          </div>
        )}
      </div>

      {/* Cash tender */}
      {paymentMethod === "Cash" && (
        <div
          className="rounded-xl border p-3 space-y-3"
          style={{ borderColor: "var(--brand-border)", background: "var(--surface)" }}
        >
          <div className="flex items-center justify-between">
            <p className="text-[11px] font-bold uppercase tracking-wide" style={{ color: "var(--brand-text)" }}>
              {t("pos.cash_tender")}
            </p>
          </div>

          <div className="grid gap-2 sm:grid-cols-2">
            <label className="block text-[11px] font-bold" style={{ color: "var(--text)" }}>
              {t("pos.paid_usd")}
              <input
                ref={usdInputRef}
                type="number" min="0" step="0.01"
                value={paidUsd}
                onChange={(e) => onPaidUsdChange(e.target.value)}
                className="input mt-1 w-full"
                style={{ height: 38, fontSize: 14, fontWeight: 700, background: "var(--surface-2)", color: "var(--text)", border: "1px solid var(--border)" }}
              />
            </label>
            <label className="block text-[11px] font-bold" style={{ color: "var(--text)" }}>
              {t("pos.paid_lbp")}
              <input
                type="number" min="0" step="1000"
                value={paidLbp}
                onChange={(e) => onPaidLbpChange(e.target.value)}
                className="input mt-1 w-full"
                style={{ height: 38, fontSize: 14, fontWeight: 700, background: "var(--surface-2)", color: "var(--text)", border: "1px solid var(--border)" }}
              />
            </label>
          </div>

          <div className="flex gap-2">
            <button type="button" onClick={() => onFillExactTender("USD")} disabled={items.length === 0}
              className="flex-1 rounded-lg border py-1.5 text-[11px] font-bold transition active:scale-[0.97] disabled:opacity-30"
              style={{ borderColor: "var(--brand)", borderWidth: 1.5, color: "var(--brand)", background: "var(--bg)" }}>
              {t("pos.exact_usd")}
            </button>
            <button type="button" onClick={() => onFillExactTender("LBP")} disabled={items.length === 0}
              className="flex-1 rounded-lg border py-1.5 text-[11px] font-bold transition active:scale-[0.97] disabled:opacity-30"
              style={{ borderColor: "var(--brand)", borderWidth: 1.5, color: "var(--brand)", background: "var(--bg)" }}>
              {t("pos.exact_lbp")}
            </button>
          </div>

          {!cashTenderValid && items.length > 0 && (
            <p className="text-[11px] font-semibold" style={{ color: "var(--rose)" }}>{t("pos.insufficient_payment")}</p>
          )}

          {cashTenderValid && paidTotalUsd > 0 && (
            <div
              className="rounded-xl p-3 space-y-2"
              style={{ background: "var(--brand-soft)", border: "1px solid var(--brand-border)" }}
            >
              {/* Paid total row */}
              <div className="flex items-center justify-between text-[12px]" style={{ color: "var(--text)" }}>
                <span className="font-semibold">{t("pos.paid_total")}</span>
                <span className="font-bold tabular-nums">
                  {formatCurrency(paidTotalUsd)}
                  <span className="mx-1 opacity-40">/</span>
                  {formatLbpCurrency(paidTotalLbp)}
                </span>
              </div>

              {/* Change / Remaining row */}
              <div
                className="flex items-center justify-between rounded-lg px-3 py-2"
                style={{
                  background: "var(--surface)",
                  border: "1px solid var(--brand-border)",
                }}
              >
                <span className="text-[13px] font-bold" style={{ color: cashChangeUsd > 0 ? "#16a34a" : "var(--rose)" }}>
                  {cashChangeUsd > 0 ? t("pos.change") : t("pos.remaining")}
                </span>
                <div className="text-right">
                  <span
                    className="block tabular-nums leading-none font-black"
                    style={{ fontSize: cashChangeUsd > 0 ? 22 : 28, color: "var(--text)" }}
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
                style={{ height: 38, fontSize: 13 }}
              >
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>{c.name} — {c.mobile}</option>
                ))}
              </select>
              <div className="space-y-1">
                <div className="flex justify-between text-[12px]" style={{ color: "var(--amber-text)" }}>
                  <span>{t("pos.current_balance")}</span>
                  <span className="font-bold">{formatCurrency(selectedCustomer?.balance ?? 0)}</span>
                </div>
                <div className="flex justify-between text-[12px]" style={{ color: "var(--amber-text)" }}>
                  <span>{t("pos.after_sale")}</span>
                  <span className="font-bold">{formatCurrency((selectedCustomer?.balance ?? 0) + total)}</span>
                </div>
                {(selectedCustomer?.creditLimit ?? 0) > 0 && (
                  <div className="flex justify-between text-[12px]" style={{ color: creditLimitExceeded ? "var(--rose)" : "var(--amber-text)" }}>
                    <span>{t("pos.credit_limit")}</span>
                    <span className="font-bold">{formatCurrency(selectedCustomer!.creditLimit)}</span>
                  </div>
                )}
              </div>
            </>
          ) : (
            <Link to="/customers"
              className="flex h-9 w-full items-center justify-center rounded-lg text-[12px] font-bold text-white transition hover:opacity-90"
              style={{ background: "var(--text)" }}>
              {t("pos.add_customer")}
            </Link>
          )}
        </div>
      )}

      {/* Sell at Cost toggle */}
      {items.length > 0 && (
        <button
          type="button"
          onClick={onToggleSellAtCost}
          className={`w-full flex items-center justify-center gap-2 rounded-xl px-3 py-2 text-[12px] font-bold transition ${
            sellAtCost
              ? "bg-amber-500/15 border border-amber-500/30 text-amber-400"
              : "border text-[var(--text-3)] hover:text-[var(--text-2)]"
          }`}
          style={!sellAtCost ? { borderColor: "var(--border)" } : undefined}
        >
          <span className={`h-1.5 w-1.5 rounded-full ${sellAtCost ? "bg-amber-400" : "bg-[var(--text-3)]"}`} />
          {sellAtCost ? t("pos.sell_at_cost") + " — ON" : t("pos.sell_at_cost")}
        </button>
      )}

      {/* Totals */}
      <div className="rounded-xl border p-3" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>

        {/* Secondary lines — subtotal, discount, vat */}
        <div className="space-y-1 mb-2">
          {hasDiscount && (
            <>
              <div className="flex justify-between text-[11px]" style={{ color: "var(--text-3)" }}>
                <span>{t("pos.items_subtotal")}</span>
                <span className="tabular-nums font-bold" style={{ color: "var(--text)" }}>{formatCurrency(grossSubtotal)}</span>
              </div>
              <div className="flex justify-between text-[11px]" style={{ color: "var(--brand-text)" }}>
                <span>{t("pos.discount")}</span>
                <span className="font-bold tabular-nums">-{formatCurrency(discountTotal)}</span>
              </div>
            </>
          )}
          <div className="flex justify-between text-[11px]" style={{ color: "var(--text-3)" }}>
            <span>{t("pos.subtotal")}</span>
            <span className="tabular-nums font-bold" style={{ color: "var(--text)" }}>{formatCurrency(subtotal)}</span>
          </div>
          <div className="flex justify-between text-[11px]" style={{ color: "var(--text-3)" }}>
            <span>{t("pos.vat")} {formatVatRate(vatRate)}</span>
            <span className="tabular-nums font-bold" style={{ color: "var(--text)" }}>{formatCurrency(tax)}</span>
          </div>
        </div>

        {/* THE number — total */}
        <div className="flex items-end justify-between border-t pt-2.5" style={{ borderColor: "var(--border)" }}>
          <div>
            <span className="block text-[11px] font-semibold uppercase tracking-wide" style={{ color: "var(--text-3)" }}>
              {t("pos.total_usd")}
            </span>
            <span className="block text-[11px] font-semibold tabular-nums" style={{ color: "var(--text-2)" }}>
              {formatLbpCurrency(totalLbp)}
            </span>
          </div>
          <span className="text-[32px] font-black tabular-nums leading-none" style={{ color: "var(--text)" }}>
            {formatCurrency(total)}
          </span>
        </div>

        {hasDiscount && (
          <div className="mt-2 rounded-lg px-2.5 py-1 text-center text-[10px] font-bold" style={{ background: "var(--brand-soft)", color: "var(--brand-text)" }}>
            You save {formatCurrency(discountTotal)}
          </div>
        )}
      </div>

      {/* Checkout button */}
      <button
        type="button"
        onClick={onCompleteSale}
        disabled={checkoutBlocked}
        className="btn-checkout sticky bottom-0 z-10 w-full h-14 text-[16px] font-black tracking-tight"
      >
        {checkoutLabel}
      </button>
    </div>
  )
}

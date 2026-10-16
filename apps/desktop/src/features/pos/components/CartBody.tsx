import { useState } from "react"
import { useI18n } from "@lebanonpos/shared"
import {
  BadgePercent,
  ChevronDown,
  MessageSquare,
  ShoppingCart,
} from "lucide-react"

import CartItemCard from "./CartItemCard"
import MoneyDue from "./MoneyDue"
import TenderPanel from "./TenderPanel"
import {
  formatCurrency,
  formatNumber,
} from "../lib/currency"
import {
  formatVatRate,
} from "../lib/helpers"
import type { CustomerLedger } from "../services/customer.service"

type PaymentMethod = "Cash" | "Card" | "Wallet" | "Debt"
type DiscountMode = "USD" | "Percent"

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
  /** Enter pressed in a cash tender field — jump straight to checkout. */
  onTenderEnter?: (field: "usd" | "lbp") => void
  itemCount: number
  grossSubtotal: number
  discountTotal: number
  subtotal: number
  tax: number
  total: number
  totalLbp: number
  /** Cash payable after LBP rounding (POSPage), and its USD equivalent. */
  payableLbp?: number
  payableUsd?: number
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
  canApplyDiscount: boolean
  canOverridePrice?: boolean
  sellAtCost: boolean
  onToggleSellAtCost: () => void
}

export default function CartBody({
  items, onIncreaseQty, onDecreaseQty, onRemoveItem,
  onSetQuantity, onSetPrice,
  saleNote, onSaleNoteChange,
  vatRate, customers, selectedCustomerId, onSelectCustomer, selectedCustomer,
  paymentMethod, onSelectPayment,
  paidUsd, paidLbp, onPaidUsdChange, onPaidLbpChange, onFillExactTender,
  discountMode, discountValue, onDiscountModeChange, onDiscountValueChange,
  onHold, onClean, onCompleteSale, onTenderEnter,
  itemCount, grossSubtotal, discountTotal, subtotal, tax, total, totalLbp, exchangeRate,
  payableLbp = totalLbp, payableUsd = total,
  paidTotalUsd, paidTotalLbp, cashChangeUsd, cashChangeLbp, cashStillDueUsd,
  cashTenderValid, creditLimitExceeded, checkoutBlocked, hasDiscount, canApplyDiscount,
  canOverridePrice = true,
  sellAtCost, onToggleSellAtCost,
}: Props) {
  const [discountOpen, setDiscountOpen] = useState(false)
  const [saleNoteOpen, setSaleNoteOpen] = useState(false)
  const { t } = useI18n()

  const isCash = paymentMethod === "Cash"
  const lbp = t("pos.v2.lbp")
  // The pay button names the amount the customer actually pays (§7 "pay").
  const payAmount = isCash && payableLbp !== totalLbp
    ? `${formatCurrency(payableUsd)} · ${formatNumber(Math.round(payableLbp))} ${lbp}`
    : `${formatCurrency(total)} · ${formatNumber(Math.round(totalLbp))} ${lbp}`
  const checkoutLabel = creditLimitExceeded
    ? t("pos.credit_exceeded")
    : paymentMethod === "Debt" ? t("pos.record_debt") : t("pos.pay")

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-4 space-y-3" style={{ background: "var(--surface)" }}>
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
              onSetPrice={canOverridePrice ? (price) => onSetPrice(item.id, price) : undefined}
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

      {/* Items-only content — no cash drawer, no TenderPanel */}
      {items.length > 0 && (<>

        {/* Sell at Cost toggle — requires the price-override permission */}
        {canOverridePrice && (
        <button
          type="button"
          onClick={onToggleSellAtCost}
          className="w-full flex items-center justify-center gap-2 rounded-lg border px-3 text-[14px] font-semibold transition"
          aria-pressed={sellAtCost}
          style={sellAtCost
            ? { minHeight: 48, background: "var(--v2-warn-soft)", borderColor: "var(--v2-warn)", color: "var(--v2-warn)" }
            : { minHeight: 48, borderColor: "var(--border-strong)", color: "var(--text-2)" }}
        >
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: sellAtCost ? "var(--warning)" : "var(--text-3)" }} />
          {sellAtCost ? t("pos.sell_at_cost") + " — ON" : t("pos.sell_at_cost")}
        </button>
        )}

        {/* Sale note + Discount — side by side */}
        <div className="flex gap-2">
          {/* Sale note */}
          <div className="flex-1 rounded-xl border overflow-hidden" style={{ borderColor: "var(--border)" }}>
            <button
              type="button"
              onClick={() => setSaleNoteOpen(!saleNoteOpen)}
              className="flex w-full items-center justify-between gap-3 px-3"
              style={{ minHeight: 48, background: "var(--surface-2)" }}
            >
              <span className="flex items-center gap-2 text-[14px] font-semibold" style={{ color: "var(--text-2)" }}>
                <MessageSquare size={14} />
                {t("pos.sale_note")}
              </span>
              {saleNote && (
                <span className="truncate text-[10px] max-w-[80px]" style={{ color: "var(--text-3)" }}>{saleNote}</span>
              )}
              <ChevronDown size={14} className={`shrink-0 transition ${saleNoteOpen ? "rotate-180" : ""}`} style={{ color: "var(--text-3)" }} />
            </button>
            {saleNoteOpen && (
              <div className="px-3 pb-3 pt-2" style={{ background: "var(--surface)" }}>
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
            )}
          </div>

          {/* Discount */}
          <div className="flex-1 rounded-xl border overflow-hidden" style={{ borderColor: "var(--border)" }}>
            <button
              type="button"
              onClick={() => setDiscountOpen(!discountOpen)}
              className="flex w-full items-center justify-between gap-3 px-3"
              style={{ minHeight: 48, background: "var(--surface-2)" }}
            >
              <span className="flex items-center gap-2 text-[14px] font-semibold" style={{ color: "var(--text-2)" }}>
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
        </div>

        {/* Totals (v2 money rule) */}
        <div className="flex flex-col gap-2 pt-1">

          {/* Secondary lines — subtotal, discount, vat */}
          <div className="space-y-1 mb-2">
            {hasDiscount && (
              <>
                <div className="flex justify-between text-[14px]" style={{ color: "var(--text)" }}>
                  <span>{t("pos.items_subtotal")}</span>
                  <span className="num">{formatCurrency(grossSubtotal)}</span>
                </div>
                <div className="flex justify-between text-[14px]" style={{ color: "var(--text)" }}>
                  <span>{t("pos.discount")}</span>
                  <span className="num">−{formatCurrency(discountTotal)}</span>
                </div>
              </>
            )}
            <div className="flex justify-between text-[14px]" style={{ color: "var(--text)" }}>
              <span>{t("pos.subtotal")}</span>
              <span className="num">{formatCurrency(subtotal)}</span>
            </div>
            <div className="flex justify-between text-[14px]" style={{ color: "var(--text)" }}>
              <span>{t("pos.vat")} {formatVatRate(vatRate)}</span>
              <span className="num">{formatCurrency(tax)}</span>
            </div>
          </div>

          {/* THE number — total due, cash payable when rounding applies */}
          <div className="border-t pt-2" style={{ borderColor: "var(--border)" }}>
            <MoneyDue total={total} totalLbp={totalLbp} payableLbp={payableLbp} payableUsd={payableUsd} isCash={isCash} label={t("pos.v2.total_due")} />
          </div>
        </div>

        {/* TenderPanel */}
        <TenderPanel
          density="full"
          paymentMethod={paymentMethod}
          onSelectPayment={onSelectPayment}
          itemsCount={items.length}
          paidUsd={paidUsd}
          paidLbp={paidLbp}
          onPaidUsdChange={onPaidUsdChange}
          onPaidLbpChange={onPaidLbpChange}
          onFillExactTender={onFillExactTender}
          cashTenderValid={cashTenderValid}
          paidTotalUsd={paidTotalUsd}
          paidTotalLbp={paidTotalLbp}
          cashChangeUsd={cashChangeUsd}
          cashChangeLbp={cashChangeLbp}
          cashStillDueUsd={cashStillDueUsd}
          exchangeRate={exchangeRate}
          total={total}
          customers={customers}
          selectedCustomerId={selectedCustomerId}
          onSelectCustomer={onSelectCustomer}
          selectedCustomer={selectedCustomer}
          creditLimitExceeded={creditLimitExceeded}
          onUsdEnter={onTenderEnter ? () => onTenderEnter("usd") : undefined}
          onLbpEnter={onTenderEnter ? () => onTenderEnter("lbp") : undefined}
        />

        {/* Checkout button */}
        <button
          type="button"
          onClick={onCompleteSale}
          disabled={checkoutBlocked}
          className="mg2-pay sticky bottom-0 z-10"
        >
          <span>{checkoutLabel}</span>
          {!creditLimitExceeded && <span className="num">{payAmount}</span>}
          <span className="mg2-kbd">Enter</span>
        </button>

      </>)}
    </div>
  )
}

import { useState } from "react"
import { useI18n } from "@lebanonpos/shared"
import {
  BadgePercent,
  ChevronDown,
  MessageSquare,
  ShoppingCart,
} from "lucide-react"

import CartItemCard from "./CartItemCard"
import TenderPanel from "./TenderPanel"
import {
  formatCurrency,
  formatLbpCurrency,
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
  onHold, onClean, onCompleteSale,
  itemCount, grossSubtotal, discountTotal, subtotal, tax, total, totalLbp, exchangeRate,
  paidTotalUsd, paidTotalLbp, cashChangeUsd, cashChangeLbp, cashStillDueUsd,
  cashTenderValid, creditLimitExceeded, checkoutBlocked, hasDiscount, canApplyDiscount,
  canOverridePrice = true,
  sellAtCost, onToggleSellAtCost,
}: Props) {
  const [discountOpen, setDiscountOpen] = useState(false)
  const [saleNoteOpen, setSaleNoteOpen] = useState(false)
  const { t } = useI18n()

  const checkoutLabel = creditLimitExceeded
    ? t("pos.credit_exceeded")
    : paymentMethod === "Debt"
      ? `${t("pos.record_debt")} — ${formatCurrency(total)}`
      : `${t("pos.pay")} ${formatCurrency(total)}`

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
          className="w-full flex items-center justify-center gap-2 rounded-xl border px-3 py-2 text-[12px] font-bold transition"
          aria-pressed={sellAtCost}
          style={sellAtCost
            ? { background: "var(--warning-soft)", borderColor: "var(--warning)", color: "var(--warning-text)" }
            : { borderColor: "var(--border)", color: "var(--text-3)" }}
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
              className="flex w-full items-center justify-between gap-3 px-3 py-2.5"
              style={{ background: "var(--surface-2)" }}
            >
              <span className="flex items-center gap-2 text-[12px] font-semibold" style={{ color: "var(--text-2)" }}>
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
        />

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

      </>)}
    </div>
  )
}

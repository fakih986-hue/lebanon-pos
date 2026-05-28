import { useState } from "react"
import { useI18n } from "@lebanonpos/shared"
import { AnimatePresence, motion } from "framer-motion"
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
  X,
} from "lucide-react"
import type { LucideIcon } from "lucide-react"
import { Link } from "react-router"

import CartItemCard from "./CartItemCard"
import {
  formatCurrency,
  formatLbpCurrency,
  formatNumber,
  usdToLbp,
} from "../lib/currency"
import type { HeldSale } from "../services/heldSale.service"
import {
  formatVatRate,
  getHeldSaleItemCount,
  getHeldSaleTotal,
  parseMoney,
} from "../lib/helpers"
import type { CustomerLedger } from "../services/customer.service"

type PaymentMethod = "Cash" | "Card" | "Wallet" | "Debt"
type TenderMode = "USD" | "LBP" | "Mixed"
type DiscountMode = "USD" | "Percent"

type PaymentOption = { label: PaymentMethod; icon: LucideIcon; color: string }

const paymentOptions: PaymentOption[] = [
  { label: "Cash",   icon: Landmark,    color: "emerald" },
  { label: "Card",   icon: CreditCard,  color: "indigo"  },
  { label: "Wallet", icon: WalletCards, color: "violet"  },
  { label: "Debt",   icon: HandCoins,   color: "amber"   },
]

const paymentColors: Record<string, { active: string; inactive: string }> = {
  emerald: { active: "bg-emerald-600 border-emerald-600 text-white shadow-emerald-600/25", inactive: "border-[var(--border)] bg-[var(--surface-2)] text-[var(--text-2)] hover:border-emerald-300 hover:bg-emerald-50 hover:text-emerald-700" },
  indigo:  { active: "bg-indigo-600 border-indigo-600 text-white shadow-indigo-600/25",   inactive: "border-[var(--border)] bg-[var(--surface-2)] text-[var(--text-2)] hover:border-indigo-300 hover:bg-indigo-50 hover:text-indigo-700" },
  violet:  { active: "bg-violet-600 border-violet-600 text-white shadow-violet-600/25",   inactive: "border-[var(--border)] bg-[var(--surface-2)] text-[var(--text-2)] hover:border-violet-300 hover:bg-violet-50 hover:text-violet-700" },
  amber:   { active: "bg-amber-500 border-amber-500 text-white shadow-amber-500/25",      inactive: "border-[var(--border)] bg-[var(--surface-2)] text-[var(--text-2)] hover:border-amber-300 hover:bg-amber-50 hover:text-amber-700" },
}

interface CartItem { id: number; name: string; price: number; quantity: number; stock: number }

interface Props {
  isOpen: boolean
  onClose: () => void
  items: CartItem[]
  onIncreaseQty: (id: number) => void
  onDecreaseQty: (id: number) => void
  onRemoveItem: (id: number) => void
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
  tenderMode: TenderMode
  onSelectTenderMode: (mode: TenderMode) => void
  paidUsd: string
  paidLbp: string
  onPaidUsdChange: (value: string) => void
  onPaidLbpChange: (value: string) => void
  onFillExactTender: (currency: "USD" | "LBP") => void
  discountMode: DiscountMode
  discountValue: string
  onDiscountModeChange: (mode: DiscountMode) => void
  onDiscountValueChange: (value: string) => void
  onSetQuantity: (id: number, qty: number) => void
  onSetPrice: (id: number, price: number) => void
  saleNote: string
  onSaleNoteChange: (note: string) => void
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
}

export default function CartDrawer({
  isOpen, onClose,
  items, onIncreaseQty, onDecreaseQty, onRemoveItem,
  heldSales, onResumeHeld, onDiscardHeld,
  vatRate, customers, selectedCustomerId, onSelectCustomer, selectedCustomer,
  paymentMethod, onSelectPayment,
  tenderMode, onSelectTenderMode, paidUsd, paidLbp, onPaidUsdChange, onPaidLbpChange, onFillExactTender,
  discountMode, discountValue, onDiscountModeChange, onDiscountValueChange,
  onSetQuantity, onSetPrice, saleNote, onSaleNoteChange,
  onHold, onClean, onCompleteSale,
  itemCount, grossSubtotal, discountTotal, subtotal, tax, total, totalLbp, exchangeRate,
  paidTotalUsd, paidTotalLbp, cashChangeUsd, cashChangeLbp, cashStillDueUsd,
  cashTenderValid, creditLimitExceeded, checkoutBlocked, hasDiscount, heldSalesItemCount, canApplyDiscount,
}: Props) {
  const [discountOpen, setDiscountOpen] = useState(false)
  const [heldOpen, setHeldOpen] = useState(false)
  const { t, dir } = useI18n()
  const drawerX = dir === "rtl" ? "-100%" : "100%"

  const checkoutLabel = creditLimitExceeded
    ? t("pos.credit_exceeded")
    : paymentMethod === "Cash" && !cashTenderValid
      ? t("pos.enter_amount")
      : paymentMethod === "Debt"
        ? t("pos.record_debt")
        : t("pos.complete_sale")

  return (
    <AnimatePresence>
      {isOpen && (
        <div
          className="fixed inset-0 z-50 flex justify-end"
          onKeyDown={(e) => { if (e.key === "Escape") onClose() }}
          tabIndex={-1}
        >
          {/* Backdrop */}
          <motion.div
            className="fixed inset-0"
            style={{ background: "rgba(0,0,0,0.45)", backdropFilter: "blur(2px)" }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />

          {/* Drawer */}
          <motion.aside
            role="dialog"
            aria-modal="true"
            aria-label={t("pos.current_sale")}
            initial={{ x: drawerX }}
            animate={{ x: 0 }}
            exit={{ x: drawerX }}
            transition={{ type: "spring", damping: 30, stiffness: 320 }}
            className="relative z-10 flex h-full w-full max-w-[440px] flex-col overflow-hidden sm:rounded-xl"
            style={{ background: "var(--surface)", boxShadow: "var(--shadow-xl)" }}
          >
            {/* ── Header ── */}
            <div
              className="flex shrink-0 items-center justify-between gap-3 border-b px-4 py-3"
              style={{ background: "var(--surface)", borderColor: "var(--border)" }}
            >
              <div className="flex items-center gap-3">
                <div
                  className="flex h-9 w-9 items-center justify-center rounded-xl"
                  style={{ background: "var(--brand-soft)" }}
                >
                  <ShoppingCart size={18} style={{ color: "var(--brand)" }} />
                </div>
                <div>
                  <p className="text-[15px] font-bold leading-tight" style={{ color: "var(--text)" }}>
                    {t("pos.current_sale")}
                  </p>
                  <p className="text-[12px]" style={{ color: "var(--text-3)" }}>
                    {formatNumber(itemCount)} {t("pos.items_short") || "items"} · {formatCurrency(total)}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={onHold}
                  disabled={items.length === 0}
                  className="btn btn-ghost h-8 px-3 text-[12px] gap-1.5 rounded-lg border"
                  style={{ borderColor: "var(--border)" }}
                >
                  <PauseCircle size={14} />
                  {t("pos.hold")}
                </button>
                <button
                  type="button"
                  onClick={onClean}
                  disabled={items.length === 0}
                  className="btn btn-ghost btn-icon h-8 w-8 rounded-lg border"
                  style={{ borderColor: "var(--border)" }}
                  aria-label={t("pos.clean_sale")}
                >
                  <Eraser size={15} />
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  className="btn btn-ghost btn-icon h-8 w-8 rounded-lg"
                  aria-label={t("pos.close_checkout")}
                >
                  <X size={17} />
                </button>
              </div>
            </div>

            {/* ── Items ── */}
            <div className="min-h-0 flex-1 overflow-y-auto p-3" style={{ background: "var(--surface-2)" }}>
              {items.length > 0 ? (
                <div className="space-y-2">
                  {items.map((item) => (
                    <CartItemCard
                      key={item.id}
                      name={item.name}
                      quantity={item.quantity}
                      unitPrice={item.price}
                      totalPrice={item.price * item.quantity}
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
                  className="flex h-full min-h-56 flex-col items-center justify-center rounded-xl border-2 border-dashed gap-3"
                  style={{ borderColor: "var(--border)", background: "var(--surface)" }}
                >
                  <ShoppingCart size={36} style={{ color: "var(--text-3)" }} />
                  <div className="text-center">
                    <p className="text-[14px] font-semibold" style={{ color: "var(--text-2)" }}>{t("pos.cart_empty")}</p>
                    <p className="text-[12px] mt-0.5" style={{ color: "var(--text-3)" }}>{t("pos.cart_empty_hint")}</p>
                  </div>
                </div>
              )}
            </div>

            {/* ── Payment panel ── */}
            <div
              className="shrink-0 overflow-y-auto border-t p-3 space-y-3"
              style={{ borderColor: "var(--border)", maxHeight: "62vh" }}
            >
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
              <div>
                <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide" style={{ color: "var(--text-3)" }}>
                  {t("pos.payment_method")}
                </p>
                <div className="grid grid-cols-4 gap-1.5">
                  {paymentOptions.map(({ label, icon: Icon, color }) => {
                    const active = paymentMethod === label
                    const colors = paymentColors[color]
                    return (
                      <button
                        key={label}
                        type="button"
                        onClick={() => onSelectPayment(label)}
                        className={`flex flex-col items-center gap-1.5 rounded-xl border py-3 text-[11px] font-bold transition shadow-sm ${
                          active ? colors.active : colors.inactive
                        }`}
                      >
                        <Icon size={18} />
                        {t("pos.payment." + label.toLowerCase())}
                      </button>
                    )
                  })}
                </div>
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
                  style={{ borderColor: "var(--brand-border)", background: "var(--brand-soft)" }}
                >
                  <p className="text-[11px] font-bold uppercase tracking-wide" style={{ color: "var(--brand-text)" }}>
                    {t("pos.cash_tender")}
                  </p>
                  <div className="grid grid-cols-3 gap-1.5">
                    {(["USD", "LBP", "Mixed"] as TenderMode[]).map((mode) => (
                      <button
                        key={mode}
                        type="button"
                        onClick={() => onSelectTenderMode(mode)}
                        className={`h-9 rounded-lg border text-[12px] font-bold transition ${
                          tenderMode === mode
                            ? "border-[var(--brand)] bg-[var(--brand)] text-white"
                            : "border-[var(--brand-border)] bg-white/60 text-[var(--brand-text)]"
                        }`}
                      >
                        {mode === "Mixed" ? t("pos.tender.both") : t("pos.tender." + mode.toLowerCase())}
                      </button>
                    ))}
                  </div>

                  <div className="grid gap-2 sm:grid-cols-2">
                    {tenderMode !== "LBP" && (
                      <label className="block text-[11px] font-bold" style={{ color: "var(--brand-text)" }}>
                        {t("pos.paid_usd")}
                        <input
                          type="number" min="0" step="0.01"
                          value={paidUsd}
                          onChange={(e) => onPaidUsdChange(e.target.value)}
                          className="input mt-1 w-full"
                          style={{ height: 40, fontSize: 15, fontWeight: 700 }}
                        />
                      </label>
                    )}
                    {tenderMode !== "USD" && (
                      <label className="block text-[11px] font-bold" style={{ color: "var(--brand-text)" }}>
                        {t("pos.paid_lbp")}
                        <input
                          type="number" min="0" step="1000"
                          value={paidLbp}
                          onChange={(e) => onPaidLbpChange(e.target.value)}
                          className="input mt-1 w-full"
                          style={{ height: 40, fontSize: 15, fontWeight: 700 }}
                        />
                      </label>
                    )}
                  </div>

                  <div className="flex gap-2">
                    <button type="button" onClick={() => onFillExactTender("USD")} disabled={items.length === 0}
                      className="h-8 flex-1 rounded-lg border text-[11px] font-bold transition hover:opacity-80 disabled:opacity-30"
                      style={{ borderColor: "var(--brand-border)", color: "var(--brand-text)", background: "white/40" }}>
                      {t("pos.exact_usd")}
                    </button>
                    <button type="button" onClick={() => onFillExactTender("LBP")} disabled={items.length === 0}
                      className="h-8 flex-1 rounded-lg border text-[11px] font-bold transition hover:opacity-80 disabled:opacity-30"
                      style={{ borderColor: "var(--brand-border)", color: "var(--brand-text)", background: "white/40" }}>
                      {t("pos.exact_lbp")}
                    </button>
                  </div>

                  {!cashTenderValid && items.length > 0 && (
                    <p className="text-[11px] font-semibold" style={{ color: "var(--rose)" }}>{t("pos.insufficient_payment")}</p>
                  )}

                  {cashTenderValid && paidTotalUsd > 0 && (
                    <div className="rounded-lg p-2.5 space-y-1" style={{ background: "rgba(255,255,255,0.5)" }}>
                      <div className="flex justify-between text-[12px]" style={{ color: "var(--brand-text)" }}>
                        <span>{t("pos.paid_total")}</span>
                        <span className="font-bold">{formatCurrency(paidTotalUsd)} / {formatLbpCurrency(paidTotalLbp)}</span>
                      </div>
                      <div className="flex justify-between text-[12px] font-bold" style={{ color: cashChangeUsd > 0 ? "#059669" : "var(--rose)" }}>
                        <span>{cashChangeUsd > 0 ? t("pos.change") : t("pos.remaining")}</span>
                        <span>
                          {cashChangeUsd > 0
                            ? `${formatCurrency(cashChangeUsd)} / ${formatLbpCurrency(cashChangeLbp)}`
                            : `${formatCurrency(cashStillDueUsd)} / ${formatLbpCurrency(usdToLbp(cashStillDueUsd, exchangeRate))}`
                          }
                        </span>
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

              {/* Totals */}
              <div className="rounded-xl border p-3 space-y-2" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
                {hasDiscount && (
                  <>
                    <div className="flex justify-between text-[13px]" style={{ color: "var(--text-3)" }}>
                      <span>{t("pos.items_subtotal")}</span>
                      <span className="font-semibold" style={{ color: "var(--text-2)" }}>{formatCurrency(grossSubtotal)}</span>
                    </div>
                    <div className="flex justify-between text-[13px]" style={{ color: "var(--brand-text)" }}>
                      <span>{t("pos.discount")}</span>
                      <span className="font-bold">-{formatCurrency(discountTotal)}</span>
                    </div>
                  </>
                )}
                <div className="flex justify-between text-[13px]" style={{ color: "var(--text-3)" }}>
                  <span>{t("pos.subtotal")}</span>
                  <span className="font-semibold" style={{ color: "var(--text-2)" }}>{formatCurrency(subtotal)}</span>
                </div>
                <div className="flex justify-between text-[13px]" style={{ color: "var(--text-3)" }}>
                  <span>{t("pos.vat")} {formatVatRate(vatRate)}</span>
                  <span className="font-semibold" style={{ color: "var(--text-2)" }}>{formatCurrency(tax)}</span>
                </div>
                <div className="flex justify-between border-t pt-2" style={{ borderColor: "var(--border)" }}>
                  <span className="text-[18px] font-bold" style={{ color: "var(--text)" }}>{t("pos.total_usd")}</span>
                  <span className="text-[22px] font-black tabular-nums" style={{ color: "var(--text)" }}>{formatCurrency(total)}</span>
                </div>
                <div className="flex justify-between text-[12px]" style={{ color: "var(--text-3)" }}>
                  <span>{t("pos.total_lbp")}</span>
                  <span className="font-semibold">{formatLbpCurrency(totalLbp)}</span>
                </div>
              </div>

              {/* Checkout button */}
              <button
                type="button"
                onClick={onCompleteSale}
                disabled={checkoutBlocked}
                className="btn-checkout w-full h-14 text-[16px] font-black tracking-tight"
              >
                {checkoutLabel}
              </button>
            </div>
          </motion.aside>
        </div>
      )}
    </AnimatePresence>
  )
}

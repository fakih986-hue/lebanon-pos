import { useState } from "react"
import { useI18n } from "@lebanonpos/shared"
import { AnimatePresence, motion } from "framer-motion"
import {
  BadgeDollarSign,
  BadgePercent,
  ChevronDown,
  CreditCard,
  Eraser,
  HandCoins,
  Landmark,
  PauseCircle,
  PlayCircle,
  ReceiptText,
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
  getHeldSaleDiscountTotal,
  getHeldSaleGrossSubtotal,
  getHeldSaleItemCount,
  getHeldSaleTotal,
  parseMoney,
} from "../lib/helpers"
import type { CustomerLedger } from "../services/customer.service"

type PaymentMethod = "Cash" | "Card" | "Wallet" | "Debt"
type TenderMode = "USD" | "LBP" | "Mixed"
type DiscountMode = "USD" | "Percent"

type PaymentOption = {
  label: PaymentMethod
  icon: LucideIcon
}

const paymentOptions: PaymentOption[] = [
  { label: "Cash", icon: Landmark },
  { label: "Card", icon: CreditCard },
  { label: "Wallet", icon: WalletCards },
  { label: "Debt", icon: HandCoins },
]

interface CartItem {
  id: number
  name: string
  price: number
  quantity: number
  stock: number
}

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
  isOpen,
  onClose,
  items,
  onIncreaseQty,
  onDecreaseQty,
  onRemoveItem,
  heldSales,
  onResumeHeld,
  onDiscardHeld,
  vatRate,
  customers,
  selectedCustomerId,
  onSelectCustomer,
  selectedCustomer,
  paymentMethod,
  onSelectPayment,
  tenderMode,
  onSelectTenderMode,
  paidUsd,
  paidLbp,
  onPaidUsdChange,
  onPaidLbpChange,
  onFillExactTender,
  discountMode,
  discountValue,
  onDiscountModeChange,
  onDiscountValueChange,
  onSetQuantity,
  onSetPrice,
  saleNote,
  onSaleNoteChange,
  onHold,
  onClean,
  onCompleteSale,
  itemCount,
  grossSubtotal,
  discountTotal,
  subtotal,
  tax,
  total,
  totalLbp,
  exchangeRate,
  paidTotalUsd,
  paidTotalLbp,
  cashChangeUsd,
  cashChangeLbp,
  cashStillDueUsd,
  cashTenderValid,
  creditLimitExceeded,
  checkoutBlocked,
  hasDiscount,
  heldSalesItemCount,
  canApplyDiscount,
}: Props) {
  const [discountOpen, setDiscountOpen] = useState(false)
  const [heldSalesOpen, setHeldSalesOpen] = useState(false)

  const { t, dir } = useI18n()
  const drawerX = dir === "rtl" ? "-100%" : "100%"

  return (
    <AnimatePresence>
      {isOpen ? (
        <div
          className="fixed inset-0 z-50 flex justify-end"
          onKeyDown={(e) => { if (e.key === "Escape") onClose() }}
          tabIndex={0}
        >
          <motion.div
            className="fixed inset-0 bg-black/20"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />

          <motion.aside
            role="dialog"
            aria-modal="true"
            aria-label={t("pos.current_sale")}
            initial={{ x: drawerX }}
            animate={{ x: 0 }}
            exit={{ x: drawerX }}
            transition={{ type: "spring", damping: 28, stiffness: 300 }}
            className="relative z-10 flex h-full w-full max-w-xl flex-col overflow-hidden bg-white shadow-2xl sm:rounded-xl"
          >
        <div className="border-b border-zinc-200 p-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-zinc-950 text-white">
                <ShoppingCart size={22} />
              </div>
              <div>
                <h2 className="text-xl font-bold text-zinc-950">
                  {t("pos.current_sale")}
                </h2>
                <p className="text-sm font-medium text-zinc-500">
                  {t("pos.items_total", { n: formatNumber(itemCount), total: formatCurrency(total) })}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onHold}
                disabled={items.length === 0}
                className="flex h-10 items-center justify-center gap-2 rounded-lg border border-zinc-200 bg-white px-3 text-sm font-bold text-zinc-700 transition hover:bg-zinc-50 disabled:opacity-30"
              >
                <PauseCircle size={17} />
                {t("pos.hold")}
              </button>
              <button
                type="button"
                onClick={onClean}
                disabled={items.length === 0}
                title={t("pos.clean_sale")}
                className="flex h-10 w-10 items-center justify-center rounded-lg text-zinc-400 transition hover:bg-rose-50 hover:text-rose-600 disabled:opacity-30"
                aria-label={t("pos.clean_sale")}
              >
                <Eraser size={18} />
              </button>
              <button
                type="button"
                onClick={onClose}
                className="flex h-10 w-10 items-center justify-center rounded-lg text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-950"
                aria-label={t("pos.close_checkout")}
              >
                <X size={20} />
              </button>
            </div>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto bg-zinc-50 p-4">
          {items.length > 0 ? (
            <div className="space-y-3">
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
            <div className="flex h-full min-h-72 items-center justify-center rounded-lg border border-dashed border-zinc-300 bg-white">
              <div className="px-6 text-center">
                <ShoppingCart size={44} className="mx-auto text-zinc-300" />
                <p className="mt-3 font-bold text-zinc-900">
                  {t("pos.cart_empty")}
                </p>
                <p className="mt-1 text-sm text-zinc-500">
                  {t("pos.cart_empty_hint")}
                </p>
              </div>
            </div>
          )}
        </div>

        <div className="max-h-[58vh] overflow-y-auto border-t border-zinc-200 p-4">
          {heldSales.length > 0 ? (
            <div className="mb-4 rounded-lg border border-zinc-200 bg-white p-3">
              <button
                type="button"
                onClick={() => setHeldSalesOpen(!heldSalesOpen)}
                className="flex w-full items-center justify-between gap-3"
              >
                <div className="flex items-center gap-2 text-sm font-bold text-zinc-800">
                  <PauseCircle size={16} />
                  {t("pos.held_sales")}
                </div>
                <div className="flex items-center gap-2">
                  <span className="rounded-full bg-zinc-100 px-2.5 py-1 text-xs font-bold text-zinc-600">
                    {t("pos.holds_items", { n: formatNumber(heldSales.length), n2: formatNumber(heldSalesItemCount) })}
                  </span>
                  <ChevronDown
                    size={16}
                    className={`text-zinc-400 transition ${heldSalesOpen ? "rotate-180" : ""}`}
                  />
                </div>
              </button>

              {heldSalesOpen ? (
                <div className="mt-3 space-y-2">
                  {heldSales.slice(0, 4).map((heldSale) => (
                    <div
                      key={heldSale.id}
                      className="rounded-lg border border-zinc-100 bg-zinc-50 p-3"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="font-bold text-zinc-950">
                            {heldSale.holdNumber}
                          </p>
                          <p className="mt-1 truncate text-xs font-semibold text-zinc-500">
                            {heldSale.note} -{" "}
                            {formatNumber(getHeldSaleItemCount(heldSale))} items
                          </p>
                        </div>
                        <p className="shrink-0 text-sm font-bold text-zinc-950">
                          {formatCurrency(
                            getHeldSaleTotal(heldSale, vatRate)
                          )}
                        </p>
                      </div>

                      <div className="mt-3 grid grid-cols-2 gap-2">
                        <button
                          type="button"
                          onClick={() => onResumeHeld(heldSale)}
                          disabled={items.length > 0}
                          className="flex h-10 items-center justify-center gap-2 rounded-lg bg-zinc-950 px-3 text-sm font-bold text-white transition hover:bg-zinc-800 disabled:bg-zinc-300 disabled:text-zinc-500"
                        >
                          <PlayCircle size={16} />
                          {t("pos.resume")}
                        </button>
                        <button
                          type="button"
                          onClick={() => onDiscardHeld(heldSale)}
                          className="flex h-10 items-center justify-center gap-2 rounded-lg border border-zinc-200 bg-white px-3 text-sm font-bold text-zinc-700 transition hover:bg-zinc-50"
                        >
                          <Eraser size={15} />
                          {t("pos.discard")}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}

          <div className="mb-4">
            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-zinc-500">
              {t("pos.sale_note")}
            </label>
            <input
              type="text"
              value={saleNote}
              onChange={(e) => onSaleNoteChange(e.target.value)}
              placeholder={t("pos.sale_note_placeholder")}
              maxLength={120}
              className="h-10 w-full rounded-lg border border-zinc-200 bg-white px-3 text-sm text-zinc-800 outline-none transition focus:border-emerald-400 focus:ring-4 focus:ring-emerald-100"
            />
          </div>

          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-500">
            {t("pos.payment_method")}
          </p>
          <div className="mb-4 grid grid-cols-2 gap-2">
            {paymentOptions.map((option) => {
              const Icon = option.icon
              const active = paymentMethod === option.label

              return (
                <button
                  key={option.label}
                  type="button"
                  onClick={() => onSelectPayment(option.label)}
                  className={`
                    flex h-14 items-center justify-center gap-2 rounded-lg border text-sm font-bold transition
                    ${
                      active
                        ? "border-emerald-600 bg-emerald-50 text-emerald-800 shadow-sm"
                        : "border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-50 hover:border-zinc-300"
                    }
                  `}
                >
                  <Icon size={18} />
                  {t("pos.payment." + option.label.toLowerCase())}
                </button>
              )
            })}
          </div>

          <div className="mb-4 rounded-lg border border-zinc-200 p-3">
            <button
              type="button"
              onClick={() => setDiscountOpen(!discountOpen)}
              className="flex w-full items-center justify-between gap-3"
            >
              <div className="flex items-center gap-2 text-sm font-bold text-zinc-700">
                <BadgePercent size={16} />
                {t("pos.discount")}
              </div>
              <div className="flex items-center gap-2">
                {hasDiscount ? (
                  <span className="rounded-full bg-zinc-100 px-2.5 py-1 text-xs font-bold text-zinc-600">
                    -{formatCurrency(discountTotal)}
                  </span>
                ) : null}
                <ChevronDown
                  size={16}
                  className={`text-zinc-400 transition ${discountOpen ? "rotate-180" : ""}`}
                />
              </div>
            </button>

            {discountOpen ? (
              canApplyDiscount ? (
                <div className="mt-3 space-y-3">
                  <div className="grid grid-cols-2 gap-2">
                    {(["USD", "Percent"] as DiscountMode[]).map((mode) => {
                      const active = discountMode === mode

                      return (
                        <button
                          key={mode}
                          type="button"
                          onClick={() => onDiscountModeChange(mode)}
                          className={`h-9 rounded-lg border text-xs font-bold transition ${
                            active
                              ? "border-zinc-950 bg-zinc-950 text-white"
                              : "border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50"
                          }`}
                        >
                          {mode === "USD" ? t("pos.dollar_off") : t("pos.percent_off")}
                        </button>
                      )
                    })}
                  </div>

                  <div className="flex items-end gap-2">
                    <div className="flex-1">
                      <input
                        type="number"
                        min="0"
                        max={discountMode === "Percent" ? 100 : undefined}
                        step={discountMode === "Percent" ? 1 : 0.01}
                        value={discountValue}
                        onChange={(event) =>
                          onDiscountValueChange(event.target.value)
                        }
                        placeholder={
                          discountMode === "Percent" ? "10" : "1.00"
                        }
                        className="h-10 w-full rounded-lg border border-zinc-200 bg-white px-3 text-sm text-zinc-900 outline-none focus:border-zinc-400 focus:ring-4 focus:ring-zinc-100"
                      />
                    </div>
                    <div className="flex gap-1.5">
                      {(discountMode === "Percent" ? [5, 10, 15] : [1, 5, 10]).map((value) => (
                        <button
                          key={value}
                          type="button"
                          onClick={() =>
                            onDiscountValueChange(String(value))
                          }
                          className="h-10 rounded-lg border border-zinc-200 bg-white px-3 text-xs font-bold text-zinc-600 transition hover:bg-zinc-50"
                        >
                          {discountMode === "Percent" ? `${value}%` : `$${value}`}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              ) : (
                <p className="mt-3 text-xs font-semibold text-zinc-500">
                  {t("pos.permission_required")}
                </p>
              )
            ) : null}
          </div>

          {paymentMethod === "Cash" ? (
            <div className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 p-3">
              <div className="mb-3 flex items-center gap-2 text-sm font-bold text-emerald-900">
                <BadgeDollarSign size={17} />
                {t("pos.cash_tender")}
              </div>

              <div className="grid grid-cols-3 gap-2">
                {(["USD", "LBP", "Mixed"] as TenderMode[]).map((mode) => {
                  const active = tenderMode === mode

                  return (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => onSelectTenderMode(mode)}
                      className={`h-10 rounded-lg border text-sm font-bold transition ${
                        active
                          ? "border-emerald-700 bg-emerald-700 text-white"
                          : "border-emerald-200 bg-white text-emerald-800 hover:bg-emerald-100"
                      }`}
                    >
                      {mode === "Mixed" ? t("pos.tender.both") : t("pos.tender." + mode.toLowerCase())}
                    </button>
                  )
                })}
              </div>

              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                {tenderMode !== "LBP" ? (
                  <label className="block text-sm font-bold text-emerald-900">
                    {t("pos.paid_usd")}
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={paidUsd}
                      onChange={(event) =>
                        onPaidUsdChange(event.target.value)
                      }
                      className="mt-2 h-11 w-full rounded-lg border border-emerald-200 bg-white px-3 text-zinc-900 outline-none focus:border-emerald-400 focus:ring-4 focus:ring-emerald-100"
                    />
                  </label>
                ) : null}

                {tenderMode !== "USD" ? (
                  <label className="block text-sm font-bold text-emerald-900">
                    {t("pos.paid_lbp")}
                    <input
                      type="number"
                      min="0"
                      step="1000"
                      value={paidLbp}
                      onChange={(event) =>
                        onPaidLbpChange(event.target.value)
                      }
                      className="mt-2 h-11 w-full rounded-lg border border-emerald-200 bg-white px-3 text-zinc-900 outline-none focus:border-emerald-400 focus:ring-4 focus:ring-emerald-100"
                    />
                  </label>
                ) : null}
              </div>

              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => onFillExactTender("USD")}
                  disabled={items.length === 0}
                  className="h-9 rounded-lg border border-emerald-200 bg-white px-3 text-xs font-bold text-emerald-800 transition hover:bg-emerald-100 disabled:opacity-40"
                >
                  {t("pos.exact_usd")}
                </button>
                <button
                  type="button"
                  onClick={() => onFillExactTender("LBP")}
                  disabled={items.length === 0}
                  className="h-9 rounded-lg border border-emerald-200 bg-white px-3 text-xs font-bold text-emerald-800 transition hover:bg-emerald-100 disabled:opacity-40"
                >
                  {t("pos.exact_lbp")}
                </button>
              </div>

              {!cashTenderValid ? (
                <p className="mt-2 text-xs font-medium text-rose-500">
                  {t("pos.insufficient_payment")}
                </p>
              ) : null}

              <div className="mt-3 space-y-2 text-sm text-emerald-950">
                <div className="flex justify-between gap-3">
                  <span>{t("pos.paid_total")}</span>
                  <span className="font-bold">
                    {formatCurrency(paidTotalUsd)} /{" "}
                    {formatLbpCurrency(paidTotalLbp)}
                  </span>
                </div>
                <div className="flex justify-between gap-3">
                  <span>
                    {cashChangeUsd > 0 ? t("pos.change") : t("pos.remaining")}
                  </span>
                  <span
                    className={`font-bold ${
                      cashTenderValid ? "" : "text-rose-700"
                    }`}
                  >
                    {cashChangeUsd > 0
                      ? `${formatCurrency(cashChangeUsd)} / ${formatLbpCurrency(
                          cashChangeLbp
                        )}`
                      : `${formatCurrency(
                          cashStillDueUsd
                        )} / ${formatLbpCurrency(
                          usdToLbp(cashStillDueUsd, exchangeRate)
                        )}`}
                  </span>
                </div>
              </div>
            </div>
          ) : null}

          {paymentMethod === "Debt" ? (
            <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3">
              <div className="mb-3 flex items-center gap-2 text-sm font-bold text-amber-900">
                <ReceiptText size={17} />
                {t("pos.customer_debt")}
              </div>

              {customers.length > 0 ? (
                <>
                  {!selectedCustomerId ? (
                    <p className="mb-2 text-xs font-medium text-rose-500">
                      {t("pos.select_customer_hint")}
                    </p>
                  ) : null}
                  <select
                    value={selectedCustomerId}
                    onChange={(event) =>
                      onSelectCustomer(event.target.value)
                    }
                    className="h-11 w-full rounded-lg border border-amber-200 bg-white px-3 text-sm font-semibold text-zinc-800 outline-none focus:border-amber-400 focus:ring-4 focus:ring-amber-100"
                  >
                    {customers.map((customer) => (
                      <option key={customer.id} value={customer.id}>
                        {customer.name} - {customer.mobile}
                      </option>
                    ))}
                  </select>

                  <div className="mt-3 flex justify-between text-sm text-amber-900">
                    <span>{t("pos.current_balance")}</span>
                    <span className="font-bold">
                      {formatCurrency(selectedCustomer?.balance ?? 0)}
                    </span>
                  </div>
                  <div className="mt-1 flex justify-between text-sm text-amber-900">
                    <span>{t("pos.after_sale")}</span>
                    <span className="font-bold">
                      {formatCurrency(
                        (selectedCustomer?.balance ?? 0) + total
                      )}
                    </span>
                  </div>
                  {(selectedCustomer?.creditLimit ?? 0) > 0 ? (
                    <div
                      className={`mt-1 flex justify-between text-sm ${
                        creditLimitExceeded
                          ? "text-rose-700"
                          : "text-amber-900"
                      }`}
                    >
                      <span>{t("pos.credit_limit")}</span>
                      <span className="font-bold">
                        {formatCurrency(
                          selectedCustomer?.creditLimit ?? 0
                        )}
                      </span>
                    </div>
                  ) : null}
                </>
              ) : (
                <Link
                  to="/customers"
                  className="flex h-11 items-center justify-center rounded-lg bg-zinc-950 px-3 text-sm font-bold text-white transition hover:bg-zinc-800"
                >
                  {t("pos.add_customer")}
                </Link>
              )}
            </div>
          ) : null}

          <div className="space-y-2.5 rounded-lg border border-zinc-200 bg-white p-4 text-sm">
            {hasDiscount ? (
              <>
                <div className="flex justify-between text-zinc-500">
                  <span>{t("pos.items_subtotal")}</span>
                  <span className="font-semibold text-zinc-800">
                    {formatCurrency(grossSubtotal)}
                  </span>
                </div>
                <div className="flex justify-between text-zinc-700">
                  <span>{t("pos.discount")}</span>
                  <span className="font-bold">
                    -{formatCurrency(discountTotal)}
                  </span>
                </div>
              </>
            ) : null}
            <div className="flex justify-between text-zinc-500">
              <span>{t("pos.subtotal")}</span>
              <span className="font-semibold text-zinc-800">
                {formatCurrency(subtotal)}
              </span>
            </div>
            <div className="flex justify-between text-zinc-500">
              <span>{t("pos.vat")} {formatVatRate(vatRate)}</span>
              <span className="font-semibold text-zinc-800">
                {formatCurrency(tax)}
              </span>
            </div>
            <div className="flex justify-between border-t-2 border-zinc-900 pt-3 text-2xl font-bold tracking-tight text-zinc-950">
              <span>{t("pos.total_usd")}</span>
              <span>{formatCurrency(total)}</span>
            </div>
            <div className="flex justify-between text-base font-bold text-zinc-600">
              <span>{t("pos.total_lbp")}</span>
              <span>{formatLbpCurrency(totalLbp)}</span>
            </div>
          </div>

          <button
            type="button"
            onClick={onCompleteSale}
            disabled={checkoutBlocked}
            className="mt-4 h-14 w-full rounded-xl bg-emerald-600 px-4 text-lg font-bold text-white shadow-md transition hover:bg-emerald-500 active:scale-[0.97] disabled:bg-zinc-300 disabled:text-zinc-500 disabled:active:scale-100"
          >
            {creditLimitExceeded
              ? t("pos.credit_exceeded")
              : paymentMethod === "Cash" && !cashTenderValid
                ? t("pos.enter_amount")
                : paymentMethod === "Debt"
                  ? t("pos.record_debt")
                  : t("pos.complete_sale")}
          </button>
        </div>
          </motion.aside>
        </div>
      ) : null}
    </AnimatePresence>
  )
}

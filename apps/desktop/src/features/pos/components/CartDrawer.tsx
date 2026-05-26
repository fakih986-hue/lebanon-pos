import { useState } from "react"
import {
  BadgeDollarSign,
  BadgePercent,
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
import { Link } from "react-router-dom"

import CartItemCard from "./CartItemCard"
import {
  formatCurrency,
  formatLbpCurrency,
  formatNumber,
  usdToLbp,
} from "../lib/currency"
import type { HeldSale } from "../services/heldSale.service"
import type { CustomerLedger } from "../services/customer.service"

type PaymentMethod = "Cash" | "Card" | "Wallet" | "Debt"
type TenderMode = "USD" | "LBP" | "Mixed"
type ChangeCurrency = "USD" | "LBP"
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

function parseMoney(value: string) {
  const parsedValue = Number(value.replace(/,/g, "").trim())
  return Number.isFinite(parsedValue) ? Math.max(0, parsedValue) : 0
}

function getHeldSaleItemCount(heldSale: HeldSale) {
  return heldSale.items.reduce((sum, item) => sum + item.quantity, 0)
}

function getHeldSaleGrossSubtotal(heldSale: HeldSale) {
  return heldSale.items.reduce(
    (sum, item) => sum + item.price * item.quantity,
    0
  )
}

function getHeldSaleDiscountTotal(heldSale: HeldSale) {
  const grossSubtotal = getHeldSaleGrossSubtotal(heldSale)
  const discountValue = parseMoney(heldSale.discountValue)
  return Math.min(
    grossSubtotal,
    heldSale.discountMode === "Percent"
      ? grossSubtotal * (Math.min(100, discountValue) / 100)
      : discountValue
  )
}

function getHeldSaleTotal(heldSale: HeldSale, vatRate: number) {
  const subtotal = Math.max(
    0,
    getHeldSaleGrossSubtotal(heldSale) - getHeldSaleDiscountTotal(heldSale)
  )
  return subtotal + subtotal * vatRate
}

function formatVatRate(value: number) {
  const rate = value * 100
  return Number.isInteger(rate) ? `${rate}%` : `${rate.toFixed(2)}%`
}

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

  changeCurrency: ChangeCurrency
  onChangeCurrencyChange: (currency: ChangeCurrency) => void

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
  changeCurrency,
  onChangeCurrencyChange,
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
  const [formErrors, setFormErrors] = useState<Partial<Record<"payment" | "customer" | "discount", string>>>({})

  return (
    <div
      className={`fixed inset-0 z-50 flex justify-end ${isOpen ? "" : "pointer-events-none"}`}
      onKeyDown={(e) => { if (e.key === "Escape") onClose() }}
      tabIndex={0}
    >
      <div
        className={`fixed inset-0 bg-black/20 transition-opacity duration-300 ${isOpen ? "opacity-100" : "opacity-0"}`}
        onClick={onClose}
      />

      <aside
        role="dialog"
        aria-modal="true"
        aria-label="Current sale checkout"
        className={`relative z-10 flex h-full w-full max-w-xl flex-col overflow-hidden bg-white shadow-2xl transition-transform duration-300 sm:rounded-xl ${isOpen ? "translate-x-0" : "translate-x-full"}`}
      >
        <div className="border-b border-zinc-200 p-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-zinc-950 text-white">
                <ShoppingCart size={22} />
              </div>
              <div>
                <h2 className="text-xl font-bold text-zinc-950">
                  Current sale
                </h2>
                <p className="text-sm font-medium text-zinc-500">
                  {formatNumber(itemCount)} items - {formatCurrency(total)}
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
                Hold
              </button>
              <button
                type="button"
                onClick={onClean}
                disabled={items.length === 0}
                title="Clean sale"
                className="flex h-10 w-10 items-center justify-center rounded-lg text-zinc-400 transition hover:bg-rose-50 hover:text-rose-600 disabled:opacity-30"
                aria-label="Clean sale"
              >
                <Eraser size={18} />
              </button>
              <button
                type="button"
                onClick={onClose}
                className="flex h-10 w-10 items-center justify-center rounded-lg text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-950"
                aria-label="Close checkout"
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
                />
              ))}
            </div>
          ) : (
            <div className="flex h-full min-h-72 items-center justify-center rounded-lg border border-dashed border-zinc-300 bg-white">
              <div className="px-6 text-center">
                <ShoppingCart size={44} className="mx-auto text-zinc-300" />
                <p className="mt-3 font-bold text-zinc-900">
                  Cart is empty
                </p>
                <p className="mt-1 text-sm text-zinc-500">
                  Add products from the quick-sale screen.
                </p>
              </div>
            </div>
          )}
        </div>

        <div className="max-h-[58vh] overflow-y-auto border-t border-zinc-200 p-4">
          {heldSales.length > 0 ? (
            <div className="mb-4 rounded-lg border border-sky-200 bg-sky-50 p-3">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-sm font-bold text-sky-950">
                  <PauseCircle size={17} />
                  Held sales
                </div>
                <span className="rounded-full bg-white px-2.5 py-1 text-xs font-bold text-sky-800 ring-1 ring-sky-200">
                  {formatNumber(heldSales.length)} holds /{" "}
                  {formatNumber(heldSalesItemCount)} items
                </span>
              </div>

              <div className="space-y-2">
                {heldSales.slice(0, 4).map((heldSale) => (
                  <div
                    key={heldSale.id}
                    className="rounded-lg border border-sky-100 bg-white p-3"
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
                        Resume
                      </button>
                      <button
                        type="button"
                        onClick={() => onDiscardHeld(heldSale)}
                        className="flex h-10 items-center justify-center gap-2 rounded-lg border border-zinc-200 bg-white px-3 text-sm font-bold text-zinc-700 transition hover:bg-zinc-50"
                      >
                        <Eraser size={15} />
                        Discard
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

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
                    flex h-12 items-center justify-center gap-2 rounded-lg border text-sm font-bold transition
                    ${
                      active
                        ? "border-emerald-600 bg-emerald-50 text-emerald-800"
                        : "border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-50"
                    }
                  `}
                >
                  <Icon size={17} />
                  {option.label}
                </button>
              )
            })}
          </div>

          <div className="mb-4 rounded-lg border border-violet-200 bg-violet-50 p-3">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-sm font-bold text-violet-950">
                <BadgePercent size={17} />
                Cart discount
              </div>
              {hasDiscount ? (
                <span className="rounded-full bg-white px-2.5 py-1 text-xs font-bold text-violet-800 ring-1 ring-violet-200">
                  -{formatCurrency(discountTotal)}
                </span>
              ) : null}
            </div>

            {canApplyDiscount ? (
              <>
                <div className="grid grid-cols-2 gap-2">
                  {(["USD", "Percent"] as DiscountMode[]).map((mode) => {
                    const active = discountMode === mode

                    return (
                      <button
                        key={mode}
                        type="button"
                        onClick={() => onDiscountModeChange(mode)}
                        className={`h-10 rounded-lg border text-sm font-bold transition ${
                          active
                            ? "border-violet-700 bg-violet-700 text-white"
                            : "border-violet-200 bg-white text-violet-800 hover:bg-violet-100"
                        }`}
                      >
                        {mode === "USD" ? "$ off" : "% off"}
                      </button>
                    )
                  })}
                </div>

                <label className="mt-3 block text-sm font-bold text-violet-950">
                  Discount value
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
                    className={`mt-2 h-11 w-full rounded-lg border bg-white px-3 text-zinc-900 outline-none focus:ring-4 ${
                      !discountValue
                        ? "border-rose-300 focus:border-rose-400 focus:ring-rose-100"
                        : "border-violet-200 focus:border-violet-400 focus:ring-violet-100"
                    }`}
                  />
                </label>
                {!discountValue ? (
                  <p className="mt-1 text-xs font-medium text-rose-500">
                    Enter a discount amount
                  </p>
                ) : null}

                <div className="mt-3 grid grid-cols-3 gap-2">
                  {discountMode === "Percent"
                    ? [5, 10, 15].map((value) => (
                        <button
                          key={value}
                          type="button"
                          onClick={() =>
                            onDiscountValueChange(String(value))
                          }
                          className="h-9 rounded-lg border border-violet-200 bg-white text-xs font-bold text-violet-800 transition hover:bg-violet-100"
                        >
                          {value}%
                        </button>
                      ))
                    : [1, 5, 10].map((value) => (
                        <button
                          key={value}
                          type="button"
                          onClick={() =>
                            onDiscountValueChange(String(value))
                          }
                          className="h-9 rounded-lg border border-violet-200 bg-white text-xs font-bold text-violet-800 transition hover:bg-violet-100"
                        >
                          ${value}
                        </button>
                      ))}
                </div>
              </>
            ) : (
              <p className="rounded-lg bg-white px-3 py-2 text-sm font-semibold text-violet-900 ring-1 ring-violet-100">
                Manager or admin permission required.
              </p>
            )}
          </div>

          {paymentMethod === "Cash" ? (
            <div className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 p-3">
              <div className="mb-3 flex items-center gap-2 text-sm font-bold text-emerald-900">
                <BadgeDollarSign size={17} />
                Cash tender
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
                      {mode === "Mixed" ? "Both" : mode}
                    </button>
                  )
                })}
              </div>

              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                {tenderMode !== "LBP" ? (
                  <label className="block text-sm font-bold text-emerald-900">
                    Paid USD
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
                    Paid LBP
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
                  Exact USD
                </button>
                <button
                  type="button"
                  onClick={() => onFillExactTender("LBP")}
                  disabled={items.length === 0}
                  className="h-9 rounded-lg border border-emerald-200 bg-white px-3 text-xs font-bold text-emerald-800 transition hover:bg-emerald-100 disabled:opacity-40"
                >
                  Exact LBP
                </button>
              </div>

              {!cashTenderValid ? (
                <p className="mt-2 text-xs font-medium text-rose-500">
                  Insufficient payment - enter enough to cover the total.
                </p>
              ) : null}

              <div className="mt-3 space-y-2 text-sm text-emerald-950">
                <div className="flex justify-between gap-3">
                  <span>Paid total</span>
                  <span className="font-bold">
                    {formatCurrency(paidTotalUsd)} /{" "}
                    {formatLbpCurrency(paidTotalLbp)}
                  </span>
                </div>
                <div className="flex justify-between gap-3">
                  <span>
                    {cashChangeUsd > 0 ? "Change" : "Remaining"}
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

              <div className="mt-3 grid grid-cols-2 gap-2">
                {(["USD", "LBP"] as ChangeCurrency[]).map((currency) => {
                  const active = changeCurrency === currency

                  return (
                    <button
                      key={currency}
                      type="button"
                      onClick={() => onChangeCurrencyChange(currency)}
                      className={`h-10 rounded-lg border text-sm font-bold transition ${
                        active
                          ? "border-zinc-950 bg-zinc-950 text-white"
                          : "border-emerald-200 bg-white text-emerald-800 hover:bg-emerald-100"
                      }`}
                    >
                      Return {currency}
                    </button>
                  )
                })}
              </div>
            </div>
          ) : null}

          {paymentMethod === "Debt" ? (
            <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3">
              <div className="mb-3 flex items-center gap-2 text-sm font-bold text-amber-900">
                <ReceiptText size={17} />
                Customer debt account
              </div>

              {customers.length > 0 ? (
                <>
                  {!selectedCustomerId ? (
                    <p className="mb-2 text-xs font-medium text-rose-500">
                      Please select a customer to record a debt sale.
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
                    <span>Current balance</span>
                    <span className="font-bold">
                      {formatCurrency(selectedCustomer?.balance ?? 0)}
                    </span>
                  </div>
                  <div className="mt-1 flex justify-between text-sm text-amber-900">
                    <span>After this sale</span>
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
                      <span>Credit limit</span>
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
                  Add Customer
                </Link>
              )}
            </div>
          ) : null}

          <div className="space-y-2 rounded-lg border border-zinc-200 bg-white p-3 text-sm">
            {hasDiscount ? (
              <>
                <div className="flex justify-between text-zinc-500">
                  <span>Items subtotal</span>
                  <span className="font-semibold text-zinc-800">
                    {formatCurrency(grossSubtotal)}
                  </span>
                </div>
                <div className="flex justify-between text-violet-700">
                  <span>Discount</span>
                  <span className="font-bold">
                    -{formatCurrency(discountTotal)}
                  </span>
                </div>
              </>
            ) : null}
            <div className="flex justify-between text-zinc-500">
              <span>Subtotal</span>
              <span className="font-semibold text-zinc-800">
                {formatCurrency(subtotal)}
              </span>
            </div>
            <div className="flex justify-between text-zinc-500">
              <span>VAT {formatVatRate(vatRate)}</span>
              <span className="font-semibold text-zinc-800">
                {formatCurrency(tax)}
              </span>
            </div>
            <div className="flex justify-between border-t border-zinc-200 pt-3 text-xl font-bold text-zinc-950">
              <span>Total USD</span>
              <span>{formatCurrency(total)}</span>
            </div>
            <div className="flex justify-between text-sm font-bold text-zinc-600">
              <span>Total LBP</span>
              <span>{formatLbpCurrency(totalLbp)}</span>
            </div>
          </div>

          <button
            type="button"
            onClick={onCompleteSale}
            disabled={checkoutBlocked}
            className="mt-4 h-12 w-full rounded-lg bg-emerald-600 px-4 text-base font-bold text-white shadow-sm transition hover:bg-emerald-500 disabled:bg-zinc-300 disabled:text-zinc-500"
          >
            {creditLimitExceeded
              ? "Credit Limit Exceeded"
              : paymentMethod === "Cash" && !cashTenderValid
                ? "Enter Paid Amount"
                : paymentMethod === "Debt"
                  ? "Record Debt Sale"
                  : "Complete Sale"}
          </button>
        </div>
      </aside>
    </div>
  )
}

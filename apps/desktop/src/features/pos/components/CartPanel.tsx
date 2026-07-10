import { useI18n } from "@lebanonpos/shared"
import { Eraser, PauseCircle, PlayCircle, ShoppingCart, X } from "lucide-react"

import CartBody from "./CartBody"
import CartRailWidgets from "./CartRailWidgets"
import { formatCurrency, formatNumber } from "../lib/currency"
import { getHeldSaleTotal } from "../lib/helpers"
import type { HeldSale } from "../services/heldSale.service"
import type { CustomerLedger } from "../services/customer.service"

type PaymentMethod = "Cash" | "Card" | "Wallet" | "Debt"
type DiscountMode = "USD" | "Percent"

interface CartItem {
  id: number
  name: string
  price: number
  quantity: number
  stock: number
}

interface Props {
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
  onHold: () => void
  onClean: () => void
  onCompleteSale: () => void
  saleNote: string
  onSaleNoteChange: (note: string) => void
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
  onCartOpen?: () => void
  sellAtCost: boolean
  onToggleSellAtCost: () => void
  quickMode?: boolean
}

export default function CartPanel({
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
  canApplyDiscount,
  sellAtCost,
  onToggleSellAtCost,
  quickMode,
}: Props) {
  const { t } = useI18n()

  return (
    <aside
      className={`pos-cart-rail flex-col border-l ${quickMode ? "flex" : "hidden shrink-0 w-[392px] lg:flex xl:w-[440px]"}`}
      style={quickMode ? { flex: "1.5 1 0%", minWidth: 0 } : undefined}>
      <div className="pos-cart-header shrink-0 px-4 py-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-white" style={{ background: "var(--ink)" }}>
              <ShoppingCart size={21} />
            </div>
            <div className="min-w-0">
              <p className="truncate text-[18px] font-bold leading-tight" style={{ color: "var(--text)" }}>
                {t("pos.current_sale")}
              </p>
              <p className="text-[12px] font-bold" style={{ color: "var(--text-3)" }}>
                {formatNumber(itemCount)} {t("pos.items_short") || "items"}
              </p>
            </div>
          </div>

          {items.length > 0 && (
            <div className="shrink-0 text-end">
              <p className="text-[10px] font-bold uppercase tracking-[0.14em]" style={{ color: "var(--text-3)" }}>
                Due now
              </p>
              <p className="text-[24px] font-bold leading-none tabular-nums" style={{ color: "var(--text)" }}>
                {formatCurrency(total)}
              </p>
            </div>
          )}
        </div>

        {items.length > 0 && (
          <div className="mt-4 grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={onHold}
              className="btn btn-ghost h-9 text-[12px]"
            >
              <PauseCircle size={14} />
              {t("pos.hold")}
            </button>
            <button
              type="button"
              onClick={onClean}
              className="btn btn-ghost h-9 text-[12px]"
            >
              <Eraser size={14} />
              {t("pos.clean")}
            </button>
          </div>
        )}
      </div>

      {items.length === 0 && <CartRailWidgets />}

      {/* Held sales pills — always visible above cart items */}
      {heldSales.length > 0 && (
        <div className="shrink-0 space-y-1 px-4 py-2" style={{ background: "var(--surface)" }}>
          <div className="flex items-center gap-1.5 mb-1.5">
            <PauseCircle size={12} style={{ color: "var(--text-3)" }} />
            <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: "var(--text-3)" }}>
              {t("pos.held_sales")}
            </span>
            <span
              className="rounded-full px-1.5 py-0.5 text-[9px] font-bold"
              style={{ background: "var(--surface-3)", color: "var(--text-2)" }}
            >
              {heldSales.length}
            </span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {heldSales.slice(0, 4).map((sale) => (
              <div
                key={sale.id}
                className="flex items-center gap-1.5 rounded-lg border px-2 py-1.5"
                style={{ borderColor: "var(--border)", background: "var(--surface-2)" }}
              >
                <button
                  type="button"
                  onClick={() => onResumeHeld(sale)}
                  disabled={items.length > 0}
                  className="flex items-center gap-1 text-[11px] font-bold transition disabled:opacity-30"
                  style={{ color: "var(--text)" }}
                  title={`Resume ${sale.holdNumber}`}
                >
                  <PlayCircle size={12} style={{ color: "var(--brand)" }} />
                  <span>{sale.holdNumber}</span>
                  <span className="tabular-nums" style={{ color: "var(--text-2)" }}>
                    {formatCurrency(getHeldSaleTotal(sale, vatRate))}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => onDiscardHeld(sale)}
                  className="flex items-center justify-center rounded p-0.5 transition hover:opacity-70"
                  style={{ color: "var(--text-3)" }}
                  aria-label={`Discard ${sale.holdNumber}`}
                >
                  <X size={12} />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      <CartBody
        items={items}
        onIncreaseQty={onIncreaseQty}
        onDecreaseQty={onDecreaseQty}
        onRemoveItem={onRemoveItem}
        onSetQuantity={onSetQuantity}
        onSetPrice={onSetPrice}
        saleNote={saleNote}
        onSaleNoteChange={onSaleNoteChange}
        vatRate={vatRate}
        customers={customers}
        selectedCustomerId={selectedCustomerId}
        onSelectCustomer={onSelectCustomer}
        selectedCustomer={selectedCustomer}
        paymentMethod={paymentMethod}
        onSelectPayment={onSelectPayment}
        paidUsd={paidUsd}
        paidLbp={paidLbp}
        onPaidUsdChange={onPaidUsdChange}
        onPaidLbpChange={onPaidLbpChange}
        onFillExactTender={onFillExactTender}
        discountMode={discountMode}
        discountValue={discountValue}
        onDiscountModeChange={onDiscountModeChange}
        onDiscountValueChange={onDiscountValueChange}
        onHold={onHold}
        onClean={onClean}
        onCompleteSale={onCompleteSale}
        itemCount={itemCount}
        grossSubtotal={grossSubtotal}
        discountTotal={discountTotal}
        subtotal={subtotal}
        tax={tax}
        total={total}
        totalLbp={totalLbp}
        exchangeRate={exchangeRate}
        paidTotalUsd={paidTotalUsd}
        paidTotalLbp={paidTotalLbp}
        cashChangeUsd={cashChangeUsd}
        cashChangeLbp={cashChangeLbp}
        cashStillDueUsd={cashStillDueUsd}
        cashTenderValid={cashTenderValid}
        creditLimitExceeded={creditLimitExceeded}
        checkoutBlocked={checkoutBlocked}
        hasDiscount={hasDiscount}
        canApplyDiscount={canApplyDiscount}
        sellAtCost={sellAtCost}
        onToggleSellAtCost={onToggleSellAtCost}
      />
    </aside>
  )
}

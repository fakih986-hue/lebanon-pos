import { useI18n } from "@lebanonpos/shared"
import { BadgePercent, Eraser, PauseCircle, ShoppingCart } from "lucide-react"

import CartBody from "./CartBody"
import { formatCurrency, formatNumber } from "../lib/currency"
import type { HeldSale } from "../services/heldSale.service"
import type { CustomerLedger } from "../services/customer.service"

type PaymentMethod = "Cash" | "Card" | "Wallet" | "Debt"
type TenderMode = "USD" | "LBP" | "Mixed"
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
  heldSalesItemCount: number
  canApplyDiscount: boolean
  onCartOpen?: () => void
  sellAtCost: boolean
  onToggleSellAtCost: () => void
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
  sellAtCost,
  onToggleSellAtCost,
}: Props) {
  const { t } = useI18n()

  return (
    <aside className="pos-cart-rail hidden w-[392px] shrink-0 flex-col border-l lg:flex xl:w-[440px]">
      <div className="pos-cart-header shrink-0 px-4 py-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-white" style={{ background: "var(--ink)" }}>
              <ShoppingCart size={21} />
            </div>
            <div className="min-w-0">
              <p className="truncate text-[18px] font-black leading-tight" style={{ color: "var(--text)" }}>
                {t("pos.current_sale")}
              </p>
              <p className="text-[12px] font-bold" style={{ color: "var(--text-3)" }}>
                {formatNumber(itemCount)} {t("pos.items_short") || "items"}
              </p>
            </div>
          </div>

          <div className="shrink-0 text-right">
            <p className="text-[10px] font-black uppercase tracking-[0.14em]" style={{ color: "var(--text-3)" }}>
              Due now
            </p>
            <p className="text-[24px] font-black leading-none tabular-nums" style={{ color: "var(--text)" }}>
              {formatCurrency(total)}
            </p>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-3 gap-2">
          <button
            type="button"
            onClick={onHold}
            disabled={items.length === 0}
            className="btn btn-ghost h-9 text-[12px]"
          >
            <PauseCircle size={14} />
            {t("pos.hold")}
          </button>
          <button
            type="button"
            onClick={onClean}
            disabled={items.length === 0}
            className="btn btn-ghost h-9 text-[12px]"
          >
            <Eraser size={14} />
            {t("pos.clean")}
          </button>
          <button
            type="button"
            disabled={items.length === 0}
            className="btn btn-ghost h-9 text-[12px]"
            style={items.length > 0 ? { color: "var(--brand-text)", borderColor: "var(--brand-border)" } : undefined}
            title={items.length > 0 ? "Scroll down to apply discount" : undefined}
          >
            <BadgePercent size={14} />
            Discount
          </button>
        </div>
      </div>

      <CartBody
        items={items}
        onIncreaseQty={onIncreaseQty}
        onDecreaseQty={onDecreaseQty}
        onRemoveItem={onRemoveItem}
        onSetQuantity={onSetQuantity}
        onSetPrice={onSetPrice}
        saleNote={saleNote}
        onSaleNoteChange={onSaleNoteChange}
        heldSales={heldSales}
        onResumeHeld={onResumeHeld}
        onDiscardHeld={onDiscardHeld}
        vatRate={vatRate}
        customers={customers}
        selectedCustomerId={selectedCustomerId}
        onSelectCustomer={onSelectCustomer}
        selectedCustomer={selectedCustomer}
        paymentMethod={paymentMethod}
        onSelectPayment={onSelectPayment}
        tenderMode={tenderMode}
        onSelectTenderMode={onSelectTenderMode}
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
        heldSalesItemCount={heldSalesItemCount}
        canApplyDiscount={canApplyDiscount}
        sellAtCost={sellAtCost}
        onToggleSellAtCost={onToggleSellAtCost}
      />
    </aside>
  )
}

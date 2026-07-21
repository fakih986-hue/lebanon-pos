import { useI18n } from "@lebanonpos/shared"
import { AnimatePresence, motion } from "framer-motion"
import {
  Eraser,
  PauseCircle,
  PlayCircle,
  ShoppingCart,
  X,
} from "lucide-react"

import CartBody from "./CartBody"
import {
  formatCurrency,
  formatNumber,
} from "../lib/currency"
import { getHeldSaleTotal } from "../lib/helpers"
import type { HeldSale } from "../services/heldSale.service"
import type { CustomerLedger } from "../services/customer.service"

type PaymentMethod = "Cash" | "Card" | "Wallet" | "Debt"
type DiscountMode = "USD" | "Percent"

const MotionDiv = motion.div as any
const MotionAside = motion.aside as any

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
  canApplyDiscount: boolean
  canOverridePrice?: boolean
  sellAtCost: boolean
  onToggleSellAtCost: () => void
}

export default function CartDrawer({
  isOpen, onClose,
  items, onIncreaseQty, onDecreaseQty, onRemoveItem,
  heldSales, onResumeHeld, onDiscardHeld,
  vatRate, customers, selectedCustomerId, onSelectCustomer, selectedCustomer,
  paymentMethod, onSelectPayment,
  paidUsd, paidLbp, onPaidUsdChange, onPaidLbpChange, onFillExactTender,
  discountMode, discountValue, onDiscountModeChange, onDiscountValueChange,
  onSetQuantity, onSetPrice, saleNote, onSaleNoteChange,
  onHold, onClean, onCompleteSale,
  itemCount, grossSubtotal, discountTotal, subtotal, tax, total, totalLbp, exchangeRate,
  paidTotalUsd, paidTotalLbp, cashChangeUsd, cashChangeLbp, cashStillDueUsd,
  cashTenderValid, creditLimitExceeded, checkoutBlocked, hasDiscount, canApplyDiscount, canOverridePrice,
  sellAtCost, onToggleSellAtCost,
}: Props) {
  const { t, dir } = useI18n()
  const drawerX = dir === "rtl" ? "-100%" : "100%"

  return (
    <AnimatePresence>
      {isOpen && (
        <div
          className="fixed inset-0 z-50 flex justify-end"
          onKeyDown={(e) => { if (e.key === "Escape") onClose() }}
          tabIndex={-1}
        >
          {/* Backdrop */}
          <MotionDiv
            className="fixed inset-0"
            style={{ background: "rgba(0,0,0,0.45)", backdropFilter: "blur(2px)" }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />

          {/* Drawer */}
          <MotionAside
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

            {/* ── CartBody ── */}
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
              canOverridePrice={canOverridePrice}
              sellAtCost={sellAtCost}
              onToggleSellAtCost={onToggleSellAtCost}
            />
          </MotionAside>
        </div>
      )}
    </AnimatePresence>
  )
}

import { memo, useRef, useState } from "react"
import { Minus, Plus, Trash2 } from "lucide-react"

import { useI18n } from "@lebanonpos/shared"
import { formatCurrency } from "../lib/currency"

type Props = {
  name: string
  quantity: number
  unitPrice: number
  totalPrice: number
  onIncrease: () => void
  onDecrease: () => void
  onRemove: () => void
  onSetQuantity: (qty: number) => void
  onSetPrice?: (price: number) => void
}

const CartItemCard = memo(function CartItemCard({
  name, quantity, unitPrice, totalPrice,
  onIncrease, onDecrease, onRemove,
  onSetQuantity, onSetPrice,
}: Props) {
  const { t } = useI18n()
  const [editingQty, setEditingQty] = useState(false)
  const [editingPrice, setEditingPrice] = useState(false)
  const [qtyInput, setQtyInput] = useState(String(quantity))
  const [priceInput, setPriceInput] = useState(String(unitPrice))
  const qtyRef = useRef<HTMLInputElement>(null)
  const priceRef = useRef<HTMLInputElement>(null)

  function openQtyEdit() {
    setQtyInput(String(quantity))
    setEditingQty(true)
    setTimeout(() => qtyRef.current?.select(), 0)
  }
  function commitQty() {
    const val = parseFloat(qtyInput)
    if (!isNaN(val) && val > 0) onSetQuantity(Math.round(val))
    setEditingQty(false)
  }
  function openPriceEdit() {
    setPriceInput(String(unitPrice))
    setEditingPrice(true)
    setTimeout(() => priceRef.current?.select(), 0)
  }
  function commitPrice() {
    const val = parseFloat(priceInput)
    if (!isNaN(val) && val >= 0 && onSetPrice) onSetPrice(val)
    setEditingPrice(false)
  }

  return (
    <div
      className="flex items-center gap-3 rounded-xl px-3 py-3"
      style={{
        background: "var(--surface)",
        border: "1px solid var(--border)",
      }}
    >
      {/* Info */}
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-semibold leading-tight" style={{ color: "var(--text)" }}>
          {name}
        </p>

        {editingPrice && onSetPrice ? (
          <div className="mt-1 flex items-center gap-1">
            <span className="text-[12px]" style={{ color: "var(--text-3)" }}>$</span>
            <input
              ref={priceRef}
              type="number" min="0" step="0.01"
              value={priceInput}
              onChange={(e) => setPriceInput(e.target.value)}
              onBlur={commitPrice}
              onKeyDown={(e) => { if (e.key === "Enter") commitPrice(); if (e.key === "Escape") setEditingPrice(false) }}
              className="w-20 rounded-md border px-1.5 py-0.5 text-[12px] font-bold outline-none"
              style={{ borderColor: "var(--brand)", boxShadow: "0 0 0 2px var(--brand-soft)", color: "var(--text)", background: "var(--surface)" }}
            />
          </div>
        ) : (
          <button
            type="button"
            onClick={onSetPrice ? openPriceEdit : undefined}
            className={`mt-0.5 text-[12px] font-medium leading-tight ${onSetPrice ? "cursor-pointer hover:underline" : "cursor-default"}`}
            style={{ color: "var(--text-3)" }}
          >
            {formatCurrency(unitPrice)} {t("pos.each")}
          </button>
        )}
      </div>

      {/* Qty controls */}
      <div className="flex items-center gap-1.5 shrink-0">
        <button
          type="button"
          onClick={onDecrease}
          className="flex h-7 w-7 items-center justify-center rounded-lg border transition hover:opacity-80"
          style={{ background: "var(--surface-2)", borderColor: "var(--border)", color: "var(--text-2)" }}
        >
          <Minus size={13} />
        </button>

        {editingQty ? (
          <input
            ref={qtyRef}
            type="number" min="1"
            value={qtyInput}
            onChange={(e) => setQtyInput(e.target.value)}
            onBlur={commitQty}
            onKeyDown={(e) => { if (e.key === "Enter") commitQty(); if (e.key === "Escape") setEditingQty(false) }}
            className="h-7 w-12 rounded-lg border text-center text-[13px] font-bold outline-none"
            style={{ borderColor: "var(--brand)", boxShadow: "0 0 0 2px var(--brand-soft)", color: "var(--text)", background: "var(--surface)" }}
          />
        ) : (
          <button
            type="button"
            onClick={openQtyEdit}
            title={t("pos.cart.set_quantity")}
            className="h-7 w-10 rounded-lg text-[13px] font-bold transition hover:opacity-80"
            style={{ background: "var(--surface-3)", color: "var(--text)" }}
          >
            {quantity}
          </button>
        )}

        <button
          type="button"
          onClick={onIncrease}
          className="flex h-7 w-7 items-center justify-center rounded-lg border transition hover:opacity-80"
          style={{ background: "var(--surface-2)", borderColor: "var(--border)", color: "var(--text-2)" }}
        >
          <Plus size={13} />
        </button>
      </div>

      {/* Total */}
      <span className="w-[62px] shrink-0 text-right text-[13px] font-bold tabular-nums" style={{ color: "var(--text)" }}>
        {formatCurrency(totalPrice)}
      </span>

      {/* Remove */}
      <button
        type="button"
        onClick={onRemove}
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg transition"
        style={{ color: "var(--text-3)" }}
        onMouseEnter={(e) => { e.currentTarget.style.color = "var(--rose)"; e.currentTarget.style.background = "var(--rose-soft)" }}
        onMouseLeave={(e) => { e.currentTarget.style.color = "var(--text-3)"; e.currentTarget.style.background = "transparent" }}
        aria-label={t("pos.remove_item", { name })}
      >
        <Trash2 size={14} />
      </button>
    </div>
  )
})

export default CartItemCard

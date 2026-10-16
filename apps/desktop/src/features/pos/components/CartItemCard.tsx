import { memo, useRef, useState, useLayoutEffect } from "react"
import { Minus, Plus, Trash2 } from "lucide-react"

import { useI18n } from "@lebanonpos/shared"
import { formatCurrency } from "../lib/currency"

type Props = {
  name: string
  quantity: number
  unitPrice: number
  totalPrice: number
  atCost?: boolean
  onIncrease: () => void
  onDecrease: () => void
  onRemove: () => void
  onSetQuantity: (qty: number) => void
  onSetPrice?: (price: number) => void
}

const CartItemCard = memo(function CartItemCard({
  name, quantity, unitPrice, totalPrice, atCost,
  onIncrease, onDecrease, onRemove,
  onSetQuantity, onSetPrice,
}: Props) {
  const { t } = useI18n()
  const [editingQty, setEditingQty] = useState(false)
  const [editingPrice, setEditingPrice] = useState(false)
  const [showPresets, setShowPresets] = useState(false)
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
    if (!isNaN(val) && val > 0) onSetQuantity(Math.floor(val))
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

  // Long names: two lines; when that cuts the name, the name itself expands
  // it (click, Enter/Space, tap) and the full text shows on hover.
  const nameRef = useRef<HTMLParagraphElement>(null)
  const [nameClipped, setNameClipped] = useState(false)
  const [showFullName, setShowFullName] = useState(false)
  // One stable element (never swapped, so the observer keeps watching it); a hidden element (0 px) is not measured.
  useLayoutEffect(() => {
    const el = nameRef.current
    if (!el || showFullName) return
    const measure = () => { if (el.clientHeight > 0) setNameClipped(el.scrollHeight > el.clientHeight + 1) }
    measure()
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null
    ro?.observe(el)
    return () => ro?.disconnect()
  }, [name, showFullName])
  const expandable = nameClipped || showFullName
  const toggleName = () => setShowFullName((v) => !v)

  return (
    <div
      className="rounded-xl px-3 py-3"
      style={{
        background: "var(--surface)",
        border: "1px solid var(--border)",
      }}
    >
      <div className="flex items-center gap-3">
        {/* Info */}
        <div className="min-w-0 flex-1">
          <p ref={nameRef}
            className={`${showFullName ? "" : "line-clamp-2 "}break-words text-[14px] font-semibold leading-tight${expandable ? " cursor-pointer" : ""}`}
            style={{ color: "var(--text)", margin: 0 }}
            role={expandable ? "button" : undefined}
            tabIndex={expandable ? 0 : undefined}
            aria-expanded={expandable ? showFullName : undefined}
            title={expandable && !showFullName ? name : undefined}
            onClick={expandable ? toggleName : undefined}
            onKeyDown={expandable ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggleName() } } : undefined}>
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
              {atCost && (
                <span className="ms-1.5 rounded px-1 py-0.5 text-[9px] font-bold uppercase text-amber-400" style={{ background: "rgba(214,166,58,0.15)" }}>
                  AT COST
                </span>
              )}
            </button>
          )}
        </div>

        {/* Qty controls */}
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={onDecrease}
            aria-label={`Decrease ${name}`}
            className="flex h-9 w-9 items-center justify-center rounded-lg border transition hover:opacity-80 active:scale-90"
            style={{ background: "var(--surface-2)", borderColor: "var(--surface-3)", color: "var(--text-2)" }}
          >
            <Minus size={14} />
          </button>

          {editingQty ? (
            <input
              ref={qtyRef}
              type="number" min="1"
              value={qtyInput}
              onChange={(e) => setQtyInput(e.target.value)}
              onBlur={commitQty}
              onKeyDown={(e) => { if (e.key === "Enter") commitQty(); if (e.key === "Escape") setEditingQty(false) }}
              className="h-9 w-12 rounded-lg border text-center text-[13px] font-bold outline-none"
              style={{ borderColor: "var(--brand)", boxShadow: "0 0 0 2px var(--brand-soft)", color: "var(--text)", background: "var(--surface)" }}
            />
          ) : (
            <button
              type="button"
              onClick={() => { openQtyEdit(); setShowPresets((v) => !v) }}
              title={t("pos.cart.set_quantity")}
              aria-label={t("pos.cart.set_quantity")}
              className="h-9 w-10 rounded-lg text-[13px] font-bold transition hover:opacity-80"
              style={{ background: "var(--surface-3)", color: "var(--text)" }}
            >
              {quantity}
            </button>
          )}

          <button
            type="button"
            onClick={onIncrease}
            aria-label={`Increase ${name}`}
            className="flex h-9 w-9 items-center justify-center rounded-lg border transition hover:opacity-80 active:scale-90"
            style={{ background: "var(--surface-2)", borderColor: "var(--surface-3)", color: "var(--text-2)" }}
          >
            <Plus size={14} />
          </button>
        </div>

        {/* Total */}
        <span className="w-[62px] shrink-0 text-end text-[13px] font-bold tabular-nums" style={{ color: "var(--text)" }}>
          {formatCurrency(totalPrice)}
        </span>

        {/* Remove */}
        <button
          type="button"
          onClick={onRemove}
          className="cart-remove-btn flex h-9 w-9 shrink-0 items-center justify-center rounded-lg active:scale-90"
          aria-label={t("pos.remove_item", { name })}
        >
          <Trash2 size={14} />
        </button>
      </div>

      {/* Preset quantity buttons — toggle on qty tap */}
      {showPresets && <div className="mt-2 flex gap-1.5">
        {[1, 2, 5, 10].map((preset) => (
          <button
            key={preset}
            type="button"
            onClick={() => onSetQuantity(preset)}
            className="h-6 flex-1 rounded-md text-[11px] font-bold transition hover:opacity-80"
            style={quantity === preset
              ? { background: "var(--brand)", color: "white", border: "1px solid var(--brand)" }
              : { background: "var(--surface-2)", color: "var(--text-2)", border: "1px solid var(--surface-3)" }
            }
          >
            {preset}
          </button>
        ))}
      </div>}
    </div>
  )
})

export default CartItemCard

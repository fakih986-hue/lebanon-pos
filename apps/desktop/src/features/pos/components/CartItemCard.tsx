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
  name,
  quantity,
  unitPrice,
  totalPrice,
  onIncrease,
  onDecrease,
  onRemove,
  onSetQuantity,
  onSetPrice,
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
    setTimeout(() => { qtyRef.current?.select() }, 0)
  }

  function commitQty() {
    const val = parseFloat(qtyInput)
    if (!isNaN(val) && val > 0) onSetQuantity(Math.round(val))
    setEditingQty(false)
  }

  function openPriceEdit() {
    setPriceInput(String(unitPrice))
    setEditingPrice(true)
    setTimeout(() => { priceRef.current?.select() }, 0)
  }

  function commitPrice() {
    const val = parseFloat(priceInput)
    if (!isNaN(val) && val >= 0 && onSetPrice) onSetPrice(val)
    setEditingPrice(false)
  }

  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-3 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate font-bold text-zinc-950">{name}</h3>
          {editingPrice && onSetPrice ? (
            <div className="mt-1 flex items-center gap-1">
              <span className="text-sm text-zinc-400">$</span>
              <input
                ref={priceRef}
                type="number"
                min="0"
                step="0.01"
                value={priceInput}
                onChange={(e) => setPriceInput(e.target.value)}
                onBlur={commitPrice}
                onKeyDown={(e) => { if (e.key === "Enter") commitPrice(); if (e.key === "Escape") setEditingPrice(false) }}
                className="w-20 rounded border border-emerald-400 bg-white px-1.5 py-0.5 text-sm font-bold text-zinc-950 outline-none ring-2 ring-emerald-100"
              />
            </div>
          ) : (
            <button
              type="button"
              onClick={onSetPrice ? openPriceEdit : undefined}
              title={onSetPrice ? t("pos.cart.edit_price") : undefined}
              className={`mt-1 text-sm text-zinc-500 ${onSetPrice ? "hover:text-emerald-600 hover:underline cursor-pointer" : "cursor-default"}`}
            >
              {formatCurrency(unitPrice)} {t("pos.each")}
              {onSetPrice && <span className="ml-1 text-xs text-zinc-300">{t("pos.cart.tap_to_edit")}</span>}
            </button>
          )}
        </div>

        <button
          type="button"
          onClick={onRemove}
          aria-label={t("pos.remove_item", { name })}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-zinc-400 transition hover:bg-rose-50 hover:text-rose-600"
        >
          <Trash2 size={16} />
        </button>
      </div>

      <div className="mt-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onDecrease}
            aria-label={t("pos.decrease_item", { name })}
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-zinc-200 bg-zinc-50 text-zinc-700 transition hover:border-zinc-300 hover:bg-zinc-100"
          >
            <Minus size={16} />
          </button>

          {editingQty ? (
            <input
              ref={qtyRef}
              type="number"
              min="1"
              value={qtyInput}
              onChange={(e) => setQtyInput(e.target.value)}
              onBlur={commitQty}
              onKeyDown={(e) => { if (e.key === "Enter") commitQty(); if (e.key === "Escape") setEditingQty(false) }}
              className="flex h-9 w-16 items-center justify-center rounded-lg border border-emerald-400 bg-white text-center text-sm font-bold text-zinc-900 outline-none ring-2 ring-emerald-100"
            />
          ) : (
            <button
              type="button"
              onClick={openQtyEdit}
              title={t("pos.cart.set_quantity")}
              className="flex h-9 w-10 items-center justify-center rounded-lg bg-zinc-100 text-sm font-bold text-zinc-900 transition hover:bg-emerald-100 hover:text-emerald-800"
            >
              {quantity}
            </button>
          )}

          <button
            type="button"
            onClick={onIncrease}
            aria-label={t("pos.increase_item", { name })}
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-zinc-200 bg-zinc-50 text-zinc-700 transition hover:border-zinc-300 hover:bg-zinc-100"
          >
            <Plus size={16} />
          </button>
        </div>

        <span className="text-base font-bold text-zinc-950">
          {formatCurrency(totalPrice)}
        </span>
      </div>
    </div>
  )
})

export default CartItemCard

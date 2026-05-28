import { memo } from "react"
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
}

const CartItemCard = memo(function CartItemCard({
  name,
  quantity,
  unitPrice,
  totalPrice,
  onIncrease,
  onDecrease,
  onRemove,
}: Props) {
  const { t } = useI18n()
  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-3 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate font-bold text-zinc-950">{name}</h3>
          <p className="mt-1 text-sm text-zinc-500">
            {formatCurrency(unitPrice)} {t("pos.each")}
          </p>
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

          <span className="flex h-9 w-10 items-center justify-center rounded-lg bg-zinc-100 text-sm font-bold text-zinc-900">
            {quantity}
          </span>

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

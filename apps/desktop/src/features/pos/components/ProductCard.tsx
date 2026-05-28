import { memo } from "react"
import { Barcode, BadgeDollarSign, Package, Star } from "lucide-react"

import { useI18n } from "@lebanonpos/shared"
import { formatCurrency } from "../lib/currency"
import type { Product, ProductAccent } from "../types/product"

type Props = {
  product: Product
  onClick: () => void
  onFavoriteToggle?: () => void
}

const accentStyles: Record<
  ProductAccent,
  {
    icon: string
    badge: string
    soft: string
  }
> = {
  amber: {
    icon: "bg-amber-100 text-amber-700",
    badge: "bg-amber-50 text-amber-800 border-amber-200",
    soft: "bg-amber-50",
  },
  cyan: {
    icon: "bg-cyan-100 text-cyan-700",
    badge: "bg-cyan-50 text-cyan-800 border-cyan-200",
    soft: "bg-cyan-50",
  },
  emerald: {
    icon: "bg-emerald-100 text-emerald-700",
    badge: "bg-emerald-50 text-emerald-800 border-emerald-200",
    soft: "bg-emerald-50",
  },
  indigo: {
    icon: "bg-indigo-100 text-indigo-700",
    badge: "bg-indigo-50 text-indigo-800 border-indigo-200",
    soft: "bg-indigo-50",
  },
  rose: {
    icon: "bg-rose-100 text-rose-700",
    badge: "bg-rose-50 text-rose-800 border-rose-200",
    soft: "bg-rose-50",
  },
  violet: {
    icon: "bg-violet-100 text-violet-700",
    badge: "bg-violet-50 text-violet-800 border-violet-200",
    soft: "bg-violet-50",
  },
}

const ProductCard = memo(function ProductCard({
  product,
  onClick,
  onFavoriteToggle,
}: Props) {
  const { t } = useI18n()
  const styles = accentStyles[product.accent]
  const outOfStock = product.stock <= 0

  return (
    <article className="group relative h-40 rounded-lg border border-zinc-200 bg-white shadow-sm transition hover:-translate-y-0.5 hover:border-emerald-300 hover:shadow-md sm:h-44">
      <button
        type="button"
        onClick={onClick}
        disabled={outOfStock}
        className="flex h-full w-full touch-manipulation flex-col justify-between rounded-lg p-3 text-left transition active:translate-y-0 disabled:opacity-50 disabled:hover:translate-y-0 sm:p-4"
      >
        <div className="flex items-start justify-between gap-3 pr-9">
          {product.image ? (
            <img
              src={product.image}
              alt={product.name}
              className="h-10 w-10 shrink-0 rounded-lg object-cover sm:h-12 sm:w-12"
            />
          ) : (
            <div
              className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg sm:h-12 sm:w-12 ${styles.icon}`}
            >
              <Package size={22} />
            </div>
          )}

          <span
            className={`max-w-28 truncate rounded-lg border px-2 py-1 text-xs font-bold ${styles.badge}`}
          >
            {product.category}
          </span>
        </div>

        <div className="min-w-0">
          <h3 className="line-clamp-2 text-base font-bold leading-snug text-zinc-950 sm:text-lg">
            {product.name}
          </h3>

          <div className="mt-3 flex items-center justify-between gap-3">
            <span className="inline-flex items-center gap-1 text-base font-bold text-zinc-950">
              <BadgeDollarSign size={18} className="text-emerald-700" />
              {formatCurrency(product.price)}
            </span>

            <span className="text-sm font-semibold text-zinc-500">
              {t("pos.stock_left", { n: product.stock })}
            </span>
          </div>

          <div
            className={`mt-3 flex items-center gap-2 rounded-lg px-2 py-1 text-xs font-medium text-zinc-500 ${styles.soft}`}
          >
            <Barcode size={14} />
            <span className="truncate">{product.barcode}</span>
          </div>
        </div>
      </button>

      {onFavoriteToggle ? (
        <button
          type="button"
          onClick={onFavoriteToggle}
          className={`absolute end-3 top-3 flex h-9 w-9 items-center justify-center rounded-lg border transition ${
            product.favorite
              ? "border-amber-200 bg-amber-50 text-amber-600"
              : "border-zinc-200 bg-white text-zinc-400 hover:bg-zinc-50 hover:text-zinc-700"
          }`}
          aria-label={
            product.favorite
              ? t("pos.remove_from_favorites", { name: product.name })
              : t("pos.add_to_favorites", { name: product.name })
          }
          title={product.favorite ? t("pos.favorite_item") : t("pos.add_to_favorites_short")}
        >
          <Star size={17} fill={product.favorite ? "currentColor" : "none"} />
        </button>
      ) : null}
    </article>
  )
})

export default ProductCard

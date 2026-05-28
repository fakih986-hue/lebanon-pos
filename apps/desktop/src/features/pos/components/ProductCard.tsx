import { memo } from "react"
import { Star } from "lucide-react"
import { useI18n } from "@lebanonpos/shared"
import { formatCurrency } from "../lib/currency"
import type { Product, ProductAccent } from "../types/product"

type Props = {
  product: Product
  onClick: () => void
  onFavoriteToggle?: () => void
}

// A single subtle color accent per category — just used for the left border stripe
const accentBorder: Record<ProductAccent, string> = {
  amber:   "#F59E0B",
  cyan:    "#06B6D4",
  emerald: "#10B981",
  indigo:  "#6366F1",
  rose:    "#F43F5E",
  violet:  "#8B5CF6",
}

const ProductCard = memo(function ProductCard({ product, onClick, onFavoriteToggle }: Props) {
  const { t } = useI18n()
  const outOfStock = product.stock <= 0
  const lowStock = !outOfStock && product.stock <= 5
  const accentColor = accentBorder[product.accent] ?? "#10B981"

  return (
    <article
      className={`group relative rounded-xl border overflow-hidden transition-all duration-150 select-none
        ${outOfStock ? "opacity-40" : "hover:-translate-y-0.5 cursor-pointer"}`}
      style={{
        background: "var(--surface)",
        borderColor: "var(--border)",
        boxShadow: "var(--shadow-xs)",
        borderLeft: `3px solid ${accentColor}`,
      }}
    >
      <button
        type="button"
        onClick={onClick}
        disabled={outOfStock}
        className="flex h-full w-full flex-col text-left p-3 gap-2.5"
        style={{ minHeight: 136 }}
      >
        {/* Top: image/initial + category badge */}
        <div className="flex items-start justify-between gap-2">
          {product.image ? (
            <img
              src={product.image}
              alt={product.name}
              className="h-10 w-10 shrink-0 rounded-lg object-cover"
              style={{ border: "1px solid var(--border)" }}
            />
          ) : (
            <div
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-sm font-bold"
              style={{
                background: "var(--surface-2)",
                color: accentColor,
                border: "1px solid var(--border)",
              }}
            >
              {product.name.charAt(0).toUpperCase()}
            </div>
          )}

          <span
            className="rounded-md px-1.5 py-0.5 text-[10px] font-semibold truncate max-w-[88px]"
            style={{ background: "var(--surface-2)", color: "var(--text-3)" }}
          >
            {product.category}
          </span>
        </div>

        {/* Name */}
        <p
          className="line-clamp-2 flex-1 text-[13px] font-semibold leading-snug"
          style={{ color: "var(--text)" }}
        >
          {product.name}
        </p>

        {/* Price + stock */}
        <div className="flex items-end justify-between gap-2">
          <span
            className="text-[16px] font-bold tabular-nums leading-none"
            style={{ color: "var(--text)" }}
          >
            {formatCurrency(product.price)}
          </span>

          <span
            className="text-[10px] font-semibold leading-none"
            style={{ color: outOfStock ? "var(--text-3)" : lowStock ? "var(--amber)" : "var(--text-3)" }}
          >
            {outOfStock ? "Out of stock" : lowStock ? `${product.stock} left` : `${product.stock}`}
          </span>
        </div>
      </button>

      {/* Favorite */}
      {onFavoriteToggle && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onFavoriteToggle() }}
          className="absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-md border transition opacity-0 group-hover:opacity-100"
          style={product.favorite
            ? { borderColor: "rgba(245,158,11,0.4)", background: "rgba(245,158,11,0.1)", color: "#F59E0B", opacity: 1 }
            : { borderColor: "var(--border)", background: "var(--surface-2)", color: "var(--text-3)" }
          }
        >
          <Star size={11} fill={product.favorite ? "currentColor" : "none"} />
        </button>
      )}

      {/* Out-of-stock overlay */}
      {outOfStock && (
        <div className="absolute inset-0 flex items-center justify-center rounded-xl pointer-events-none">
          <span
            className="rounded-lg px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide"
            style={{ background: "var(--surface-2)", color: "var(--text-3)", border: "1px solid var(--border)" }}
          >
            {t("pos.out_of_stock")}
          </span>
        </div>
      )}
    </article>
  )
})

export default ProductCard

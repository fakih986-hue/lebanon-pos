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

// Each accent maps to a hue used for the category badge
const accentColors: Record<ProductAccent, { bg: string; text: string; dot: string }> = {
  amber:   { bg: "rgba(245,158,11,0.10)",  text: "#92400E", dot: "#F59E0B" },
  cyan:    { bg: "rgba(6,182,212,0.10)",   text: "#0E7490", dot: "#06B6D4" },
  emerald: { bg: "rgba(16,185,129,0.10)",  text: "#065F46", dot: "#10B981" },
  indigo:  { bg: "rgba(99,102,241,0.10)",  text: "#3730A3", dot: "#6366F1" },
  rose:    { bg: "rgba(244,63,94,0.10)",   text: "#9F1239", dot: "#F43F5E" },
  violet:  { bg: "rgba(139,92,246,0.10)",  text: "#4C1D95", dot: "#8B5CF6" },
}

const accentDark: Record<ProductAccent, { bg: string; text: string; dot: string }> = {
  amber:   { bg: "rgba(245,158,11,0.12)",  text: "#FDE68A", dot: "#F59E0B" },
  cyan:    { bg: "rgba(6,182,212,0.12)",   text: "#A5F3FC", dot: "#06B6D4" },
  emerald: { bg: "rgba(16,185,129,0.12)",  text: "#6EE7B7", dot: "#10B981" },
  indigo:  { bg: "rgba(99,102,241,0.12)",  text: "#A5B4FC", dot: "#6366F1" },
  rose:    { bg: "rgba(244,63,94,0.12)",   text: "#FDA4AF", dot: "#F43F5E" },
  violet:  { bg: "rgba(139,92,246,0.12)",  text: "#C4B5FD", dot: "#8B5CF6" },
}

const ProductCard = memo(function ProductCard({ product, onClick, onFavoriteToggle }: Props) {
  const { t } = useI18n()
  const outOfStock = product.stock <= 0
  const lowStock = !outOfStock && product.stock <= 5

  return (
    <article
      className={`group relative rounded-xl border transition-all duration-150 overflow-hidden select-none
        ${outOfStock ? "opacity-50" : "hover:-translate-y-0.5 hover:shadow-[var(--shadow-md)] cursor-pointer"}`}
      style={{
        background: "var(--surface)",
        borderColor: "var(--border)",
        boxShadow: "var(--shadow-xs)",
      }}
    >
      <button
        type="button"
        onClick={onClick}
        disabled={outOfStock}
        className="flex h-full w-full flex-col text-left p-3.5 pb-3 gap-3"
        style={{ minHeight: 148 }}
      >
        {/* Top row: image/icon + category badge */}
        <div className="flex items-start justify-between gap-2">
          {product.image ? (
            <img
              src={product.image}
              alt={product.name}
              className="h-11 w-11 shrink-0 rounded-lg object-cover"
              style={{ border: "1px solid var(--border)" }}
            />
          ) : (
            <div
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-lg font-bold"
              style={{
                background: accentColors[product.accent]?.bg ?? accentColors.emerald.bg,
                color: accentColors[product.accent]?.dot ?? accentColors.emerald.dot,
              }}
            >
              {product.name.charAt(0).toUpperCase()}
            </div>
          )}

          <span
            className="rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide truncate max-w-[90px]"
            style={{
              background: accentColors[product.accent]?.bg ?? accentColors.emerald.bg,
              color: accentColors[product.accent]?.text ?? accentColors.emerald.text,
            }}
          >
            {product.category}
          </span>
        </div>

        {/* Product name */}
        <p
          className="line-clamp-2 flex-1 text-[14px] font-semibold leading-snug"
          style={{ color: "var(--text)" }}
        >
          {product.name}
        </p>

        {/* Price + stock row */}
        <div className="flex items-end justify-between gap-2">
          <span
            className="text-[17px] font-bold tabular-nums leading-none"
            style={{ color: "var(--text)" }}
          >
            {formatCurrency(product.price)}
          </span>

          <span
            className={`text-[11px] font-semibold leading-none ${
              outOfStock ? "" : lowStock ? "text-amber-600" : ""
            }`}
            style={!outOfStock && !lowStock ? { color: "var(--text-3)" } : undefined}
          >
            {outOfStock
              ? t("pos.out_of_stock")
              : lowStock
                ? `${product.stock} left`
                : `${product.stock} ${t("pos.in_stock_short") || "in stock"}`
            }
          </span>
        </div>
      </button>

      {/* Favorite button */}
      {onFavoriteToggle && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onFavoriteToggle() }}
          className={`absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-lg border transition
            ${product.favorite
              ? "border-amber-200 bg-amber-50 text-amber-500"
              : "border-[var(--border)] bg-[var(--surface-2)] text-[var(--text-3)] opacity-0 group-hover:opacity-100"
            }`}
          aria-label={product.favorite ? t("pos.remove_from_favorites", { name: product.name }) : t("pos.add_to_favorites", { name: product.name })}
        >
          <Star size={13} fill={product.favorite ? "currentColor" : "none"} />
        </button>
      )}

      {/* Out-of-stock overlay */}
      {outOfStock && (
        <div className="absolute inset-0 flex items-center justify-center rounded-xl pointer-events-none"
          style={{ background: "rgba(var(--bg-rgb,247,247,246),0.6)" }}>
          <span
            className="rounded-lg px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide"
            style={{ background: "var(--surface-3)", color: "var(--text-3)", border: "1px solid var(--border)" }}
          >
            {t("pos.out_of_stock")}
          </span>
        </div>
      )}
    </article>
  )
})

export default ProductCard

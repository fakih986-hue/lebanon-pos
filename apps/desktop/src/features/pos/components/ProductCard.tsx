import { memo } from "react"
import { ShoppingCart, Star } from "lucide-react"
import { useI18n } from "@lebanonpos/shared"

import { formatCurrency, formatLbpCurrency, usdToLbp } from "../lib/currency"
import type { Product, ProductAccent } from "../types/product"

type Props = {
  product: Product
  exchangeRate: number
  onClick: () => void
  onFavoriteToggle?: () => void
  wholesale?: boolean
}

const accents: Record<ProductAccent, { bg: string; border: string; text: string; top: string }> = {
  amber: { bg: "var(--amber-soft)", border: "rgba(217,119,6,0.28)", text: "var(--amber-text)", top: "#d97706" },
  cyan: { bg: "var(--cyan-soft)", border: "rgba(8,145,178,0.22)", text: "#0e7490", top: "#0891b2" },
  emerald: { bg: "var(--brand-soft)", border: "var(--brand-border)", text: "var(--brand-text)", top: "#047857" },
  indigo: { bg: "var(--blue-soft)", border: "rgba(37,99,235,0.22)", text: "var(--blue-text)", top: "#6366f1" },
  rose: { bg: "var(--rose-soft)", border: "rgba(220,38,38,0.22)", text: "var(--rose-text)", top: "#e11d48" },
  violet: { bg: "var(--blue-soft)", border: "rgba(37,99,235,0.22)", text: "var(--blue-text)", top: "#8b5cf6" },
}

const ProductCard = memo(function ProductCard({
  product,
  exchangeRate,
  onClick,
  onFavoriteToggle,
  wholesale,
}: Props) {
  const { t } = useI18n()
  const outOfStock = product.stock <= 0
  const lowStock = !outOfStock && product.stock <= 5
  const accent = accents[product.accent] ?? accents.emerald
  const effectivePrice = wholesale && product.wholesalePrice != null ? Number(product.wholesalePrice) : product.price

  const stockTone = outOfStock
    ? { bg: "var(--rose-soft)", text: "var(--rose-text)", label: t("pos.out_of_stock") }
    : lowStock
      ? { bg: "var(--amber-soft)", text: "var(--amber-text)", label: `${product.stock} in stock` }
      : { bg: "var(--brand-soft)", text: "var(--brand-text)", label: `${product.stock} in stock` }

  return (
    <article
      className={`pos-product-tile group relative select-none overflow-hidden ${
        outOfStock ? "opacity-50" : "cursor-pointer"
      }`}
      style={{ borderTop: `3px solid ${accent.top}` }}
    >
      <button
        type="button"
        onClick={onClick}
        disabled={outOfStock}
        className="flex min-h-[150px] w-full flex-col p-3 text-left"
      >
        <div className="flex items-start justify-between gap-2">
          {product.image ? (
            <img
              src={product.image}
              alt={product.name}
              className="h-12 w-12 shrink-0 rounded-lg object-cover"
              style={{ border: "1px solid var(--border)" }}
            />
          ) : (
            <span
              className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg text-lg font-black"
              style={{
                background: accent.bg,
                border: `1px solid ${accent.border}`,
                color: accent.text,
              }}
            >
              {product.name.charAt(0).toUpperCase()}
            </span>
          )}

          <span
            className="rounded-lg px-2 py-1 text-[10px] font-black"
            style={{ background: stockTone.bg, color: stockTone.text }}
          >
            {stockTone.label}
          </span>
        </div>

        <div className="mt-3 flex min-h-0 flex-1 flex-col">
          <p className="line-clamp-2 min-h-[34px] text-[13px] font-black leading-tight" style={{ color: "var(--text)" }}>
            {product.name}
          </p>
          <p className="mt-1 truncate text-[10px] font-bold tabular-nums" style={{ color: "var(--text-3)" }}>
            {product.barcode || product.category}
          </p>

          <div className="mt-auto pt-2.5">
            <div className="flex items-end justify-between gap-3">
              <div className="min-w-0">
                <span className="block text-[20px] font-black leading-none tabular-nums" style={{ color: wholesale && product.wholesalePrice != null ? "var(--green)" : "var(--text)" }}>
                  {formatCurrency(effectivePrice)}
                </span>
                {wholesale && product.wholesalePrice != null && (
                  <span className="block text-[10px] font-bold line-through mt-0.5" style={{ color: "var(--text-3)" }}>
                    {formatCurrency(product.price)}
                  </span>
                )}
                <span className="mt-1 block text-[10px] font-bold tabular-nums" style={{ color: "var(--text-3)" }}>
                  {formatLbpCurrency(usdToLbp(effectivePrice, exchangeRate))}
                </span>
              </div>

              <span
                className="flex h-[36px] w-[36px] shrink-0 items-center justify-center rounded-lg text-white"
                style={{ background: outOfStock ? "var(--surface-3)" : "var(--brand)" }}
              >
                <ShoppingCart size={16} />
              </span>
            </div>

            <div className="mt-2.5 flex items-center justify-between gap-2">
              <span
                className="truncate rounded-lg px-2 py-1 text-[10px] font-black"
                style={{ background: accent.bg, color: accent.text }}
              >
                {product.category}
              </span>
            </div>
          </div>
        </div>
      </button>

      {onFavoriteToggle ? (
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation()
            onFavoriteToggle()
          }}
          className="absolute right-3 top-3 flex h-7 w-7 items-center justify-center rounded-lg border transition"
          style={
            product.favorite
              ? { borderColor: "rgba(217,119,6,0.34)", background: "var(--amber-soft)", color: "var(--amber)" }
              : { borderColor: "var(--border)", background: "rgba(255,255,255,0.9)", color: "var(--text-3)" }
          }
          aria-label={product.favorite ? "Remove favorite" : "Add favorite"}
        >
          <Star size={13} fill={product.favorite ? "currentColor" : "none"} />
        </button>
      ) : null}
    </article>
  )
})

export default ProductCard

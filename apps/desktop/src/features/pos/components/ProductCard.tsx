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

const accentColors: Record<ProductAccent, { bar: string; bg: string; text: string }> = {
  amber:   { bar: "#F59E0B", bg: "rgba(245,158,11,0.08)", text: "#B45309" },
  cyan:    { bar: "#06B6D4", bg: "rgba(6,182,212,0.08)",  text: "#0E7490" },
  emerald: { bar: "#10B981", bg: "rgba(16,185,129,0.08)", text: "#047857" },
  indigo:  { bar: "#6366F1", bg: "rgba(99,102,241,0.08)", text: "#4338CA" },
  rose:    { bar: "#F43F5E", bg: "rgba(244,63,94,0.08)",  text: "#BE123C" },
  violet:  { bar: "#8B5CF6", bg: "rgba(139,92,246,0.08)", text: "#6D28D9" },
}

const ProductCard = memo(function ProductCard({ product, onClick, onFavoriteToggle }: Props) {
  const { t } = useI18n()
  const outOfStock = product.stock <= 0
  const lowStock = !outOfStock && product.stock <= 5
  const accent = accentColors[product.accent] ?? accentColors.emerald
  const stockLabel = outOfStock
    ? { text: t("pos.out_of_stock"), dot: "var(--rose)" }
    : lowStock
      ? { text: `${product.stock} left`, dot: "var(--amber)" }
      : { text: `${product.stock} in stock`, dot: "#22C55E" }

  return (
    <article
      className={`group relative rounded-xl border overflow-hidden transition-all duration-150 select-none
        ${outOfStock ? "opacity-45" : "cursor-pointer hover:-translate-y-0.5 hover:shadow-md"}`}
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
        className="flex h-full w-full flex-col text-left"
        style={{ minHeight: 136 }}
      >
        <div style={{ height: 4, background: accent.bar }} />

        <div className="flex flex-1 flex-col gap-2 p-3 pt-2.5">
          <div className="flex items-start gap-2.5">
            {product.image ? (
              <img
                src={product.image}
                alt={product.name}
                className="mt-0.5 h-11 w-11 shrink-0 rounded-lg object-cover"
                style={{ border: "1px solid var(--border)" }}
              />
            ) : (
              <div
                className="mt-0.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-sm font-bold"
                style={{
                  background: accent.bg,
                  color: accent.text,
                  border: "1px solid",
                  borderColor: accent.bar,
                }}
              >
                {product.name.charAt(0).toUpperCase()}
              </div>
            )}

            <div className="min-w-0 flex-1">
              <p
                className="line-clamp-2 text-[14px] font-semibold leading-snug pr-5"
                style={{ color: "var(--text)" }}
              >
                {product.name}
              </p>
              <p
                className="mt-0.5 truncate text-[11px] font-medium"
                style={{ color: "var(--text-3)" }}
              >
                {product.category}
              </p>
            </div>
          </div>

          <div className="mt-auto flex items-end justify-between gap-2">
            <span
              className="text-[18px] font-bold tabular-nums leading-none"
              style={{ color: "var(--text)" }}
            >
              {formatCurrency(product.price)}
            </span>

            <span className="flex items-center gap-1.5 text-[11px] font-semibold leading-none whitespace-nowrap" style={{ color: "var(--text-3)" }}>
              <span
                className="inline-block h-2 w-2 rounded-full"
                style={{ background: stockLabel.dot }}
              />
              {stockLabel.text}
            </span>
          </div>
        </div>
      </button>

      {onFavoriteToggle && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onFavoriteToggle() }}
          className="absolute right-2 top-2.5 flex h-6 w-6 items-center justify-center rounded-md border transition hover:opacity-100"
          style={product.favorite
            ? { borderColor: "rgba(245,158,11,0.4)", background: "rgba(245,158,11,0.1)", color: "#F59E0B", opacity: 1 }
            : { borderColor: "var(--border)", background: "var(--surface-2)", color: "var(--text-3)", opacity: 0.5 }
          }
        >
          <Star size={11} fill={product.favorite ? "currentColor" : "none"} />
        </button>
      )}

      {outOfStock && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-xl">
          <span
            className="rounded-lg px-3 py-1 text-[11px] font-bold uppercase tracking-wide shadow-sm"
            style={{ background: "var(--surface)", color: "var(--text-3)", border: "1px solid var(--border)" }}
          >
            {t("pos.out_of_stock")}
          </span>
        </div>
      )}
    </article>
  )
})

export default ProductCard

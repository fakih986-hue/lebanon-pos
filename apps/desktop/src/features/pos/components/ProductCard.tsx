import { memo, useCallback, useEffect, useRef, useState } from "react"
import { Check, ShoppingCart, Star, X, ZoomIn } from "lucide-react"
import { useI18n } from "@lebanonpos/shared"

import { formatCurrency, formatLbpCurrency, usdToLbp } from "../lib/currency"
import type { Product, ProductAccent } from "../types/product"

type Props = {
  product: Product
  exchangeRate: number
  onClick: () => void
  onFavoriteToggle?: () => void
  wholesale?: boolean
  cartQuantity?: number
  searchQuery?: string
}

const accents: Record<ProductAccent, { bg: string; border: string; text: string; top: string }> = {
  amber: { bg: "var(--amber-soft)", border: "rgba(217,119,6,0.28)", text: "var(--amber-text)", top: "#d97706" },
  cyan: { bg: "var(--cyan-soft)", border: "rgba(8,145,178,0.22)", text: "#0e7490", top: "#0891b2" },
  emerald: { bg: "var(--brand-soft)", border: "var(--brand-border)", text: "var(--brand-text)", top: "#047857" },
  indigo: { bg: "var(--blue-soft)", border: "rgba(37,99,235,0.22)", text: "var(--blue-text)", top: "#6366f1" },
  rose: { bg: "var(--rose-soft)", border: "rgba(220,38,38,0.22)", text: "var(--rose-text)", top: "#e11d48" },
  violet: { bg: "var(--blue-soft)", border: "rgba(37,99,235,0.22)", text: "var(--blue-text)", top: "#8b5cf6" },
}

function HighlightedText({ text, query }: { text: string; query?: string }) {
  if (!query || query.length < 2) return <>{text}</>
  const idx = text.toLowerCase().indexOf(query.toLowerCase())
  if (idx === -1) return <>{text}</>
  return (
    <>
      {text.slice(0, idx)}
      <mark style={{ background: "var(--brand-soft)", color: "var(--brand-text)", borderRadius: 2, padding: "0 1px" }}>
        {text.slice(idx, idx + query.length)}
      </mark>
      {text.slice(idx + query.length)}
    </>
  )
}

const ProductCard = memo(function ProductCard({
  product,
  exchangeRate,
  onClick,
  onFavoriteToggle,
  wholesale,
  cartQuantity = 0,
  searchQuery,
}: Props) {
  const { t } = useI18n()
  const outOfStock = product.stock <= 0
  const lowStock = !outOfStock && product.stock <= 5
  const accent = accents[product.accent] ?? accents.emerald
  const effectivePrice = wholesale && product.wholesalePrice != null ? Number(product.wholesalePrice) : product.price
  const [justAdded, setJustAdded] = useState(false)
  const [imageZoom, setImageZoom] = useState(false)
  const justAddedTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const stockTone = outOfStock
    ? { bg: "var(--rose-soft)", text: "var(--rose-text)", label: t("pos.out_of_stock") }
    : lowStock
      ? { bg: "var(--amber-soft)", text: "var(--amber-text)", label: `${product.stock} in stock` }
      : { bg: "var(--brand-soft)", text: "var(--brand-text)", label: `${product.stock} in stock` }

  const handleClick = useCallback(() => {
    if (outOfStock) return
    onClick()
    setJustAdded(true)
    if (justAddedTimer.current) clearTimeout(justAddedTimer.current)
    justAddedTimer.current = setTimeout(() => setJustAdded(false), 1200)
  }, [onClick, outOfStock])

  useEffect(() => {
    return () => { if (justAddedTimer.current) clearTimeout(justAddedTimer.current) }
  }, [])

  return (
    <>
      <article
        className={`pos-product-tile group relative select-none overflow-hidden ${
          outOfStock ? "opacity-50" : "cursor-pointer"
        }`}
        style={{
          borderTop: `3px solid ${accent.top}`,
          transform: justAdded ? "scale(1.03)" : undefined,
          transition: "transform 200ms ease",
        }}
      >
        <button
          type="button"
          onClick={handleClick}
          disabled={outOfStock}
          className="flex min-h-[150px] w-full flex-col p-3 text-left"
        >
          <div className="flex items-start justify-between gap-2">
            {product.image ? (
              <div className="relative">
                <img
                  src={product.image}
                  alt={product.name}
                  className="h-12 w-12 shrink-0 rounded-lg object-cover"
                  style={{ border: "1px solid var(--border)" }}
                />
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); setImageZoom(true) }}
                  className="absolute inset-0 flex items-center justify-center rounded-lg opacity-0 transition group-hover:opacity-100"
                  style={{ background: "rgba(0,0,0,0.3)" }}
                >
                  <ZoomIn size={14} className="text-white" />
                </button>
              </div>
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
              <HighlightedText text={product.name} query={searchQuery} />
            </p>
            <p className="mt-1 truncate text-[10px] font-bold tabular-nums opacity-0 transition group-hover:opacity-100" style={{ color: "var(--text-3)" }}>
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

        {cartQuantity > 0 && (
          <span
            className="absolute left-2 top-2 flex h-6 min-w-[24px] items-center justify-center rounded-full px-1.5 text-[11px] font-black text-white"
            style={{ background: "var(--brand)" }}
          >
            {cartQuantity}
          </span>
        )}

        {wholesale && product.wholesalePrice != null && (
          <span
            className="absolute left-2 bottom-2 rounded-md px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wide text-white"
            style={{ background: "#059669" }}
          >
            Wholesale
          </span>
        )}

        {justAdded && (
          <div
            className="absolute inset-0 flex items-center justify-center rounded-lg"
            style={{ background: "rgba(4, 120, 87, 0.85)" }}
          >
            <div className="flex flex-col items-center gap-1">
              <Check size={28} className="text-white" strokeWidth={3} />
              <span className="text-[11px] font-black text-white">Added</span>
            </div>
          </div>
        )}

        {onFavoriteToggle ? (
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation()
              onFavoriteToggle()
            }}
            className="absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-md border transition"
            style={
              product.favorite
                ? { borderColor: "rgba(217,119,6,0.34)", background: "var(--amber-soft)", color: "var(--amber)" }
                : { borderColor: "var(--border)", background: "rgba(255,255,255,0.9)", color: "var(--text-3)" }
            }
            aria-label={product.favorite ? "Remove favorite" : "Add favorite"}
          >
            <Star size={11} fill={product.favorite ? "currentColor" : "none"} />
          </button>
        ) : null}
      </article>

      {imageZoom && product.image && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-8"
          style={{ background: "rgba(0,0,0,0.8)", backdropFilter: "blur(8px)" }}
          onClick={() => setImageZoom(false)}
        >
          <button
            type="button"
            onClick={() => setImageZoom(false)}
            className="absolute right-4 top-4 flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white transition hover:bg-white/20"
          >
            <X size={20} />
          </button>
          <img
            src={product.image}
            alt={product.name}
            className="max-h-[80vh] max-w-[80vw] rounded-xl object-contain"
            onClick={(e) => e.stopPropagation()}
          />
          <p className="absolute bottom-8 left-1/2 -translate-x-1/2 rounded-lg bg-black/60 px-4 py-2 text-sm font-bold text-white">
            {product.name}
          </p>
        </div>
      )}
    </>
  )
})

export default ProductCard

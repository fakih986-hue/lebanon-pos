import { memo, useCallback, useEffect, useRef, useState } from "react"
import { AnimatePresence, motion } from "framer-motion"
import { Check, Plus, Star, X, ZoomIn } from "lucide-react"
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

/* Category accent ramp (Midnight Gold): muted hues that sit calmly on dark
 * surfaces — accents mark identity, never compete with money or actions. */
const accents: Record<ProductAccent, { solid: string; soft: string }> = {
  amber:   { solid: "#C9A25C", soft: "rgba(201,162,92,0.14)"  },
  cyan:    { solid: "#5CA8C9", soft: "rgba(92,168,201,0.14)"  },
  emerald: { solid: "#5CB894", soft: "rgba(92,184,148,0.14)"  },
  indigo:  { solid: "#7D8CD9", soft: "rgba(125,140,217,0.14)" },
  rose:    { solid: "#C97B8A", soft: "rgba(201,123,138,0.14)" },
  violet:  { solid: "#A186C9", soft: "rgba(161,134,201,0.14)" },
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

const MotionDiv = motion.div as any
const MotionSpan = motion.span as any
const MotionArticle = motion.article as any

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
  const outOfStock     = product.stock <= 0
  const lowStock       = !outOfStock && product.stock <= 5
  const accent         = accents[product.accent] ?? accents.emerald
  const effectivePrice = wholesale && product.wholesalePrice != null
    ? Number(product.wholesalePrice)
    : product.price

  const [justAdded, setJustAdded] = useState(false)
  const [imageZoom, setImageZoom] = useState(false)
  const [addCount,  setAddCount]  = useState(0)
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const stockLabel = outOfStock
    ? t("pos.out_of_stock")
    : lowStock
    ? `${product.stock} left`
    : `${product.stock} in stock`

  const stockColor = outOfStock
    ? "var(--rose)"
    : lowStock
    ? "var(--warning)"
    : "var(--text-3)"

  const handleClick = useCallback(() => {
    if (outOfStock) return
    onClick()
    setJustAdded(true)
    setAddCount((c) => c + 1)
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => setJustAdded(false), 550)
  }, [onClick, outOfStock])

  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current) }, [])

  return (
    <>
      <MotionArticle
        className={`pos-product-tile group relative select-none rounded-xl border ${
          outOfStock ? "opacity-40" : "cursor-pointer active:scale-[0.97]"
        }`}
        style={{
          background: "var(--surface)",
          borderColor: justAdded ? accent.solid : "var(--border)",
          transition: "border-color 200ms ease, transform 150ms ease",
        }}
        whileTap={!outOfStock ? { scale: 0.97 } : undefined}
        animate={{ scale: justAdded ? 1.02 : 1 }}
        transition={{ type: "spring", stiffness: 400, damping: 20 }}
      >
        <button
          type="button"
          onClick={handleClick}
          disabled={outOfStock}
          className="flex w-full flex-col gap-1.5 p-2.5 text-start"
        >
          {/* Row 1: Image + Name + Stock */}
          <div className="flex items-start gap-2">
            {/* Image / Initial */}
            {product.image ? (
              <div className="relative shrink-0">
                <img
                  src={product.image}
                  alt={product.name}
                  className="h-8 w-8 rounded-md object-cover"
                  style={{ border: `1px solid var(--border)` }}
                />
                <span
                  role="button"
                  tabIndex={0}
                  onClick={(e) => { e.stopPropagation(); setImageZoom(true) }}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.stopPropagation(); setImageZoom(true) } }}
                  className="absolute inset-0 flex cursor-pointer items-center justify-center rounded-md opacity-0 transition group-hover:opacity-100"
                  style={{ background: "rgba(0,0,0,0.45)" }}
                >
                  <ZoomIn size={10} className="text-white" />
                </span>
              </div>
            ) : (
              <span
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-[12px] font-bold"
                style={{ background: accent.soft, color: accent.solid }}
              >
                {product.name.charAt(0).toUpperCase()}
              </span>
            )}

            {/* Name + Stock */}
            <div className="min-w-0 flex-1">
              <p className="truncate text-[12px] font-bold leading-tight" style={{ color: "var(--text)" }}>
                <HighlightedText text={product.name} query={searchQuery} />
              </p>
              <p className="text-[10px] font-medium leading-tight mt-0.5" style={{ color: stockColor }}>
                {stockLabel}
                {wholesale && product.wholesalePrice != null && (
                  <span className="ms-1.5 rounded px-1 py-px text-[8px] font-bold" style={{ background: accent.soft, color: accent.solid }}>WS</span>
                )}
              </p>
            </div>

            {/* Cart quantity badge */}
            {cartQuantity > 0 && (
              <MotionSpan
                key={cartQuantity}
                className="flex h-[22px] min-w-[22px] shrink-0 items-center justify-center rounded-full text-[10px] font-bold tabular-nums"
                style={{ background: "var(--brand)", color: "var(--brand-contrast)" }}
                initial={{ scale: 1.4, opacity: 0.6 }}
                animate={{ scale: 1,   opacity: 1   }}
                transition={{ type: "spring", stiffness: 500, damping: 20 }}
              >
                {cartQuantity}
              </MotionSpan>
            )}
          </div>

          {/* Row 2: Price + Cart button */}
          <div className="flex items-end justify-between gap-2">
            <div className="min-w-0 leading-none">
              <span className="text-[15px] font-bold tabular-nums" style={{ color: "var(--text)" }}>
                {formatCurrency(effectivePrice)}
              </span>
              <span className="ms-1 text-[10px] font-medium tabular-nums" style={{ color: "var(--text-3)" }}>
                {formatLbpCurrency(usdToLbp(effectivePrice, exchangeRate))}
              </span>
            </div>

            <span
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg transition-colors"
              style={{
                background: outOfStock ? "var(--surface-3)" : accent.soft,
                color: outOfStock ? "var(--text-3)" : accent.solid,
              }}
            >
              <Plus size={13} strokeWidth={2.5} />
            </span>
          </div>
        </button>

        {/* Ring burst on add */}
        <AnimatePresence>
          {justAdded && (
            <MotionDiv
              key={`ring-${addCount}`}
              className="pointer-events-none absolute inset-0"
              style={{ border: `2px solid ${accent.solid}`, borderRadius: 12, zIndex: 20 }}
              initial={{ opacity: 0.8, scale: 0.9 }}
              animate={{ opacity: 0,   scale: 1.08 }}
              exit={{}}
              transition={{ duration: 0.3, ease: "easeOut" }}
            />
          )}
        </AnimatePresence>

        {/* Favorite star — top right */}
        {onFavoriteToggle && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onFavoriteToggle() }}
            className="absolute right-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-full transition"
            style={product.favorite
              ? { background: "var(--brand-soft)", color: "var(--brand)" }
              : { background: "transparent", color: "transparent" }
            }
            aria-label={product.favorite ? "Remove favorite" : "Add favorite"}
          >
            <Star size={10} fill={product.favorite ? "currentColor" : "none"}
              className={!product.favorite ? "opacity-0 transition-opacity group-hover:opacity-60" : ""}
              style={!product.favorite ? { color: "var(--text-3)" } : undefined}
            />
          </button>
        )}
      </MotionArticle>

      {/* Image zoom modal */}
      {imageZoom && product.image && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-8"
          style={{ background: "rgba(0,0,0,0.85)", backdropFilter: "blur(8px)" }}
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

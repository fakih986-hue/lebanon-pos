import { useState } from "react"
import type { Product } from "../types/product"
import { Star, X } from "lucide-react"

type Props = {
  products: Product[]
  selectedCategory: string
  onAddToCart: (p: Product) => void
}

export default function FavoritesBar({ products, selectedCategory, onAddToCart }: Props) {
  const [hintDismissed, setHintDismissed] = useState(() => {
    try { return localStorage.getItem("pos.fav-hint-dismissed") === "1" } catch { return false }
  })

  const favorites = products.filter((p) => p.favorite)

  function dismissHint() {
    try { localStorage.setItem("pos.fav-hint-dismissed", "1") } catch {}
    setHintDismissed(true)
  }

  if (selectedCategory === "Favorites") return null

  if (favorites.length === 0) {
    if (hintDismissed) return null
    return (
      <div className="flex items-center gap-2 px-2 py-1.5 text-[11px]" style={{ borderBottom: "1px solid var(--border)", background: "var(--surface)" }}>
        <Star size={12} fill="var(--amber)" style={{ color: "var(--amber)", flexShrink: 0 }} />
        <span style={{ color: "var(--text-3)" }}>Star products to pin them here for quick access</span>
        <button type="button" onClick={dismissHint} className="ms-auto shrink-0 hover:opacity-70" style={{ color: "var(--text-3)" }}>
          <X size={12} />
        </button>
      </div>
    )
  }

  return (
    <div className="flex items-center gap-1.5 overflow-x-auto py-1 [scrollbar-width:none]" style={{ borderBottom: "1px solid var(--border)" }}>
      {favorites.slice(0, 12).map((p) => (
        <button
          key={p.id}
          type="button"
          onClick={() => onAddToCart(p)}
          disabled={p.stock <= 0}
          className="flex shrink-0 items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-bold transition active:scale-[0.96] disabled:opacity-30"
          style={{
            borderColor: "var(--surface-3)",
            color: "var(--text-2)",
            background: "var(--surface)",
          }}
        >
          <Star size={12} fill="var(--amber)" style={{ color: "var(--amber)" }} />
          {p.name}
        </button>
      ))}
    </div>
  )
}

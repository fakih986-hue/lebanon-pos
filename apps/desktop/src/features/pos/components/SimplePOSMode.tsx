import { memo, useRef, useState } from "react"
import {
  CreditCard,
  HandCoins,
  Landmark,
  Minus,
  Plus,
  Search,
  ShoppingCart,
  Trash2,
  WalletCards,
  X,
  Zap,
} from "lucide-react"
import { useI18n } from "@lebanonpos/shared"
import { formatCurrency, formatLbpCurrency, usdToLbp, lbpToUsd } from "../lib/currency"
import { formatVatRate, parseMoney } from "../lib/helpers"
import type { Product } from "../types/product"

type PaymentMethod = "Cash" | "Card" | "Wallet"

type CartItem = Product & { quantity: number }

interface Props {
  // Browse
  products: Product[]
  categories: string[]
  // Cart
  items: CartItem[]
  onAddProduct: (product: Product, source: string) => void
  onIncreaseQty: (id: number) => void
  onDecreaseQty: (id: number) => void
  onRemoveItem: (id: number) => void
  // Checkout
  vatRate: number
  grossSubtotal: number
  subtotal: number
  tax: number
  total: number
  totalLbp: number
  exchangeRate: number
  // Complete the sale — returns the sale number on success, or null if blocked
  onCompleteSale: (paymentMethod: PaymentMethod, paidUsd: number) => string | null
  // Exit
  onExit: () => void
}

const PM_OPTIONS: { label: PaymentMethod; icon: typeof Landmark }[] = [
  { label: "Cash",   icon: Landmark   },
  { label: "Card",   icon: CreditCard },
  { label: "Wallet", icon: WalletCards },
]

const PM_COLORS: Record<PaymentMethod, { active: string; bg: string }> = {
  Cash:   { active: "#10B981", bg: "rgba(16,185,129,0.12)"  },
  Card:   { active: "#6366F1", bg: "rgba(99,102,241,0.12)"  },
  Wallet: { active: "#8B5CF6", bg: "rgba(139,92,246,0.12)"  },
}

// Minimal product card for simple mode
const SimpleProductCard = memo(function SimpleProductCard({
  product,
  onAdd,
}: { product: Product; onAdd: () => void }) {
  const outOfStock = product.stock <= 0
  return (
    <button
      type="button"
      onClick={onAdd}
      disabled={outOfStock}
      className="group relative flex flex-col items-start gap-1.5 rounded-xl border p-3 text-left transition-all active:scale-[0.97]"
      style={{
        background: outOfStock ? "var(--surface-2)" : "var(--surface)",
        borderColor: "var(--border)",
        opacity: outOfStock ? 0.4 : 1,
      }}
    >
      {product.image ? (
        <img src={product.image} alt={product.name} className="h-10 w-full rounded-lg object-cover mb-0.5" />
      ) : (
        <div
          className="flex h-10 w-full items-center justify-center rounded-lg text-sm font-bold"
          style={{ background: "var(--surface-2)", color: "var(--text-3)" }}
        >
          {product.name.charAt(0).toUpperCase()}
        </div>
      )}
      <p className="line-clamp-2 text-[12px] font-semibold leading-tight w-full" style={{ color: "var(--text)" }}>
        {product.name}
      </p>
      <p className="text-[14px] font-black tabular-nums" style={{ color: "var(--brand)" }}>
        {formatCurrency(product.price)}
      </p>
      {product.stock <= 5 && !outOfStock && (
        <span className="absolute top-2 right-2 text-[9px] font-bold rounded-full px-1.5 py-0.5"
          style={{ background: "var(--amber-soft)", color: "var(--amber)" }}>
          {product.stock}
        </span>
      )}
    </button>
  )
})

export default function SimplePOSMode({
  products, categories,
  items, onAddProduct, onIncreaseQty, onDecreaseQty, onRemoveItem,
  vatRate, grossSubtotal, subtotal, tax, total, totalLbp, exchangeRate,
  onCompleteSale, onExit,
}: Props) {
  const { t } = useI18n()
  const [search, setSearch] = useState("")
  const [activeCategory, setActiveCategory] = useState("All")
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("Cash")
  const [paidUsd, setPaidUsd] = useState("")
  const [completedSale, setCompletedSale] = useState<{ number: string; change: number } | null>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  const itemCount = items.reduce((s, i) => s + i.quantity, 0)
  const paidAmount = parseMoney(paidUsd)
  const changeUsd = Math.max(0, paidAmount - total)
  const cashValid = paymentMethod !== "Cash" || paidAmount + 0.005 >= total

  const filteredProducts = products.filter((p) => {
    const q = search.trim().toLowerCase()
    const matchCat = activeCategory === "All" || p.category === activeCategory
    const matchSearch = !q || p.name.toLowerCase().includes(q) || (p.barcode ?? "").includes(q)
    return matchCat && matchSearch && !p.isParent
  }).sort((a, b) => Number(Boolean(b.favorite)) - Number(Boolean(a.favorite)))

  const allCategories = ["All", ...categories]

  function handleCompleteSale() {
    if (!cashValid || items.length === 0) return
    const change = changeUsd
    const saleNumber = onCompleteSale(paymentMethod, parseMoney(paidUsd))
    if (!saleNumber) return  // completion was blocked
    setCompletedSale({ number: saleNumber, change })
    setPaidUsd("")
    setPaymentMethod("Cash")
    setTimeout(() => setCompletedSale(null), 2500)
  }

  return (
    <div
      className="fixed inset-0 z-[100] flex flex-col"
      style={{ background: "var(--bg)" }}
    >
      {/* ── Top bar ── */}
      <div
        className="flex h-14 shrink-0 items-center gap-3 border-b px-4"
        style={{ background: "var(--surface)", borderColor: "var(--border)" }}
      >
        <div className="flex items-center gap-2">
          <div
            className="flex h-8 w-8 items-center justify-center rounded-lg"
            style={{ background: "var(--brand-soft)" }}
          >
            <Zap size={16} style={{ color: "var(--brand)" }} />
          </div>
          <span className="text-[14px] font-bold" style={{ color: "var(--text)" }}>
            Quick Checkout
          </span>
        </div>

        {/* Search */}
        <div className="relative flex-1 max-w-sm mx-auto">
          <Search size={14} className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2" style={{ color: "var(--text-3)" }} />
          <input
            ref={searchRef}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") { if (search) setSearch(""); else onExit() }
            }}
            placeholder="Search or scan barcode…"
            className="input w-full ps-9"
            style={{ height: 36 }}
            autoFocus
          />
          {search && (
            <button type="button" onClick={() => setSearch("")} className="absolute end-2.5 top-1/2 -translate-y-1/2">
              <X size={13} style={{ color: "var(--text-3)" }} />
            </button>
          )}
        </div>

        {/* Cart badge */}
        <div
          className="flex items-center gap-2 rounded-xl border px-3 py-1.5"
          style={{ borderColor: "var(--border)", background: "var(--surface-2)" }}
        >
          <ShoppingCart size={16} style={{ color: itemCount > 0 ? "var(--brand)" : "var(--text-3)" }} />
          <span className="text-[13px] font-bold" style={{ color: "var(--text)" }}>{itemCount}</span>
          {itemCount > 0 && (
            <span className="text-[13px] font-bold" style={{ color: "var(--brand)" }}>{formatCurrency(total)}</span>
          )}
        </div>

        {/* Exit */}
        <button
          type="button"
          onClick={onExit}
          className="flex items-center gap-1.5 rounded-lg border px-3 h-8 text-[12px] font-semibold transition hover:opacity-80"
          style={{ borderColor: "var(--border)", color: "var(--text-2)" }}
        >
          <X size={14} />
          Exit
        </button>
      </div>

      {/* ── Main ── */}
      <div className="flex min-h-0 flex-1">
        {/* Left: Product browse */}
        <div className="flex min-w-0 flex-1 flex-col min-h-0">
          {/* Category strip */}
          <div
            className="flex gap-1 overflow-x-auto px-3 py-2 shrink-0 [scrollbar-width:none]"
            style={{ borderBottom: "1px solid var(--border)" }}
          >
            {allCategories.map((cat) => (
              <button
                key={cat}
                type="button"
                onClick={() => setActiveCategory(cat)}
                className="shrink-0 rounded-lg px-3 py-1.5 text-[12px] font-semibold transition"
                style={activeCategory === cat
                  ? { background: "var(--brand)", color: "#fff" }
                  : { background: "var(--surface-2)", color: "var(--text-2)" }
                }
              >
                {cat}
              </button>
            ))}
          </div>

          {/* Product grid — scrollable */}
          <div className="flex-1 overflow-y-auto p-3">
            {filteredProducts.length === 0 ? (
              <div className="flex h-full items-center justify-center">
                <p className="text-[14px]" style={{ color: "var(--text-3)" }}>No products found</p>
              </div>
            ) : (
              <div className="grid grid-cols-[repeat(auto-fill,minmax(110px,1fr))] gap-2 sm:grid-cols-[repeat(auto-fill,minmax(130px,1fr))]">
                {filteredProducts.map((p) => (
                  <SimpleProductCard key={p.id} product={p} onAdd={() => onAddProduct(p, "simple-tap")} />
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Right: Persistent cart */}
        <div
          className="flex w-[300px] xl:w-[340px] shrink-0 flex-col border-l"
          style={{ background: "var(--surface)", borderColor: "var(--border)" }}
        >
          {/* Cart header */}
          <div
            className="flex items-center justify-between border-b px-4 py-3 shrink-0"
            style={{ borderColor: "var(--border)" }}
          >
            <div className="flex items-center gap-2">
              <ShoppingCart size={16} style={{ color: "var(--brand)" }} />
              <span className="text-[14px] font-bold" style={{ color: "var(--text)" }}>Cart</span>
              {itemCount > 0 && (
                <span
                  className="rounded-full px-2 py-0.5 text-[10px] font-bold"
                  style={{ background: "var(--brand-soft)", color: "var(--brand-text)" }}
                >
                  {itemCount}
                </span>
              )}
            </div>
            {items.length > 0 && (
              <button
                type="button"
                onClick={() => items.forEach((i) => onRemoveItem(i.id))}
                className="text-[11px] font-semibold transition hover:opacity-60"
                style={{ color: "var(--text-3)" }}
              >
                Clear
              </button>
            )}
          </div>

          {/* Sale completed flash */}
          {completedSale && (
            <div
              className="mx-3 mt-3 rounded-xl p-3 text-center animate-scale-in"
              style={{ background: "var(--brand-soft)", border: "1px solid var(--brand-border)" }}
            >
              <p className="text-[15px] font-black" style={{ color: "var(--brand-text)" }}>✓ Sale {completedSale.number}</p>
              {completedSale.change > 0 && (
                <p className="text-[14px] font-bold mt-0.5" style={{ color: "var(--brand-text)" }}>
                  Change: {formatCurrency(completedSale.change)}
                </p>
              )}
            </div>
          )}

          {/* Items list */}
          <div className="flex-1 overflow-y-auto px-3 py-2 space-y-1.5">
            {items.length === 0 ? (
              <div className="flex h-full items-center justify-center flex-col gap-2 py-8">
                <ShoppingCart size={32} style={{ color: "var(--text-3)" }} />
                <p className="text-[13px]" style={{ color: "var(--text-3)" }}>Cart is empty</p>
                <p className="text-[11px]" style={{ color: "var(--text-3)" }}>Tap a product to add</p>
              </div>
            ) : items.map((item) => (
              <div
                key={item.id}
                className="flex items-center gap-2 rounded-lg p-2"
                style={{ background: "var(--surface-2)" }}
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[12px] font-semibold" style={{ color: "var(--text)" }}>{item.name}</p>
                  <p className="text-[11px]" style={{ color: "var(--text-3)" }}>{formatCurrency(item.price)}</p>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button onClick={() => onDecreaseQty(item.id)}
                    className="flex h-6 w-6 items-center justify-center rounded-md border transition hover:opacity-80"
                    style={{ borderColor: "var(--border)", color: "var(--text-2)" }}>
                    <Minus size={11} />
                  </button>
                  <span className="w-6 text-center text-[12px] font-bold" style={{ color: "var(--text)" }}>
                    {item.quantity}
                  </span>
                  <button onClick={() => onIncreaseQty(item.id)}
                    className="flex h-6 w-6 items-center justify-center rounded-md border transition hover:opacity-80"
                    style={{ borderColor: "var(--border)", color: "var(--text-2)" }}>
                    <Plus size={11} />
                  </button>
                </div>
                <span className="w-14 shrink-0 text-right text-[12px] font-bold tabular-nums" style={{ color: "var(--text)" }}>
                  {formatCurrency(item.price * item.quantity)}
                </span>
                <button onClick={() => onRemoveItem(item.id)}
                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md transition hover:opacity-60"
                  style={{ color: "var(--text-3)" }}>
                  <Trash2 size={11} />
                </button>
              </div>
            ))}
          </div>

          {/* Totals + Payment */}
          <div
            className="shrink-0 border-t p-3 space-y-3"
            style={{ borderColor: "var(--border)" }}
          >
            {/* Totals */}
            <div className="space-y-1 text-[12px]" style={{ color: "var(--text-2)" }}>
              <div className="flex justify-between">
                <span>Subtotal</span><span className="font-semibold">{formatCurrency(subtotal)}</span>
              </div>
              <div className="flex justify-between">
                <span>VAT {formatVatRate(vatRate)}</span><span className="font-semibold">{formatCurrency(tax)}</span>
              </div>
              <div
                className="flex justify-between border-t pt-2"
                style={{ borderColor: "var(--border)" }}
              >
                <span className="text-[16px] font-black" style={{ color: "var(--text)" }}>Total</span>
                <span className="text-[20px] font-black tabular-nums" style={{ color: "var(--text)" }}>
                  {formatCurrency(total)}
                </span>
              </div>
              <div className="flex justify-between text-[11px]" style={{ color: "var(--text-3)" }}>
                <span>≈ LBP</span><span>{formatLbpCurrency(totalLbp)}</span>
              </div>
            </div>

            {/* Payment method */}
            <div className="grid grid-cols-3 gap-1.5">
              {PM_OPTIONS.map(({ label, icon: Icon }) => {
                const active = paymentMethod === label
                const colors = PM_COLORS[label]
                return (
                  <button
                    key={label}
                    type="button"
                    onClick={() => setPaymentMethod(label)}
                    className="flex flex-col items-center gap-1 rounded-xl border py-2.5 text-[11px] font-semibold transition"
                    style={active
                      ? { background: colors.bg, borderColor: colors.active, color: colors.active }
                      : { background: "var(--surface-2)", borderColor: "var(--border)", color: "var(--text-2)" }
                    }
                  >
                    <Icon size={16} />
                    {label}
                  </button>
                )
              })}
            </div>

            {/* Cash tender */}
            {paymentMethod === "Cash" && (
              <div className="space-y-2">
                <div className="flex gap-2">
                  <input
                    type="number"
                    min="0"
                    step="0.50"
                    value={paidUsd}
                    onChange={(e) => setPaidUsd(e.target.value)}
                    placeholder="Amount received"
                    className="input flex-1 text-right font-bold"
                    style={{ height: 40, fontSize: 15 }}
                  />
                  <button
                    type="button"
                    onClick={() => setPaidUsd(total.toFixed(2))}
                    className="shrink-0 rounded-lg border px-3 text-[11px] font-bold transition hover:opacity-80"
                    style={{ borderColor: "var(--brand-border)", color: "var(--brand-text)", background: "var(--brand-soft)" }}
                  >
                    Exact
                  </button>
                </div>
                {paidAmount >= total && paidAmount > 0 && (
                  <p className="text-center text-[13px] font-bold" style={{ color: "var(--brand-text)" }}>
                    Change: {formatCurrency(changeUsd)} / {formatLbpCurrency(usdToLbp(changeUsd, exchangeRate))}
                  </p>
                )}
              </div>
            )}

            {/* Complete sale button */}
            <button
              type="button"
              onClick={handleCompleteSale}
              disabled={items.length === 0 || !cashValid}
              className="btn-checkout w-full h-14 text-[16px] font-black"
            >
              {items.length === 0 ? "Add items to checkout" : !cashValid ? "Enter payment amount" : `Complete · ${formatCurrency(total)}`}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

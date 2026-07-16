import { useState, useEffect, useCallback, useMemo, useRef } from "react"
import { useParams, useNavigate } from "react-router"
import { useI18n } from "@lebanonpos/shared"
import { api } from "../app/api"
import type { Product } from "@lebanonpos/types"

const CART_THROTTLE_MS = 1000
const fmt = (n: number) => "$" + n.toFixed(2)

function ProductImagePlaceholder({ name }: { name: string }) {
  const hash = name.split("").reduce((a, c) => a + c.charCodeAt(0), 0)
  const hue1 = hash % 360
  const hue2 = (hash * 137) % 360
  return (
    <div
      className="w-full aspect-[4/3] rounded-t-xl flex items-center justify-center"
      style={{ background: `linear-gradient(135deg, hsl(${hue1},60%,60%) 0%, hsl(${hue2},70%,50%) 100%)` }}
    >
      <span className="text-white/80 font-bold text-lg select-none">{name.charAt(0).toUpperCase()}</span>
    </div>
  )
}

function ProductImage({ src, name }: { src: string; name: string }) {
  const [failed, setFailed] = useState(false)
  if (failed) return <ProductImagePlaceholder name={name} />
  return <img src={src} alt={name} className="w-full aspect-[4/3] object-cover" loading="lazy" onError={() => setFailed(true)} />
}

function LazyProductImage({ src, name }: { src: string; name: string }) {
  const [isVisible, setIsVisible] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const observer = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) { setIsVisible(true); observer.disconnect() } },
      { rootMargin: "300px" },
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  if (!isVisible) return <div ref={ref} className="w-full aspect-[4/3] rounded-t-xl bg-white/5" />
  return <ProductImage src={src} name={name} />
}

// POS-ORDER-CATALOG-1: the menu endpoint includes `parent { name, image }` for
// variants (not in the shared Product type) — widen locally for grouping.
type MenuProduct = Product & { parent?: { name: string; image?: boolean | null } | null }
type GroupEntry = { kind: "group"; parentId: number; name: string; hasParentImage: boolean; variants: MenuProduct[] }
type CatalogEntry = { kind: "single"; product: MenuProduct } | GroupEntry

// A standalone product card (handles both in-stock and out-of-stock).
function CatalogCard({ product, onAdd, t }: { product: MenuProduct; onAdd: (p: MenuProduct) => void; t: (k: string) => string }) {
  const oos = product.stock <= 0
  const imgSrc = `/api/delivery/public/image/${product.id}`
  return (
    <div className={`bg-glass border border-glass rounded-xl overflow-hidden ${oos ? "opacity-50" : "shadow-lg hover:bg-glass-hover transition-all duration-200"}`}>
      {product.image ? (
        oos
          ? <img src={imgSrc} alt={product.name} className="w-full aspect-[4/3] object-cover grayscale" loading="lazy" />
          : <LazyProductImage src={imgSrc} name={product.name} />
      ) : <ProductImagePlaceholder name={product.name} />}
      <div className="p-3">
        <div className="flex items-center justify-between">
          <span className={`rounded-lg px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider ${oos ? "bg-white/[0.06] text-muted" : "bg-emerald-500/10 border border-emerald-500/20 text-emerald-300"}`}>{product.category}</span>
          <span className={`text-sm font-bold ${oos ? "text-muted" : "text-emerald-400"}`}>{fmt(product.price)}</span>
        </div>
        <p className="mt-2 text-sm font-medium text-primary leading-tight">{product.name}</p>
        {product.variantName && <p className={`text-xs mt-0.5 ${oos ? "text-muted" : "text-secondary"}`}>{product.variantName}</p>}
        {oos ? (
          <p className="mt-2 text-center text-xs text-muted">{t("ordering.out_of_stock")}</p>
        ) : (
          <button onClick={() => onAdd(product)}
            aria-label={`Add ${product.name} to cart — ${fmt(product.price)}`}
            className="mt-2 flex h-9 w-full items-center justify-center rounded-lg bg-gradient-to-r from-emerald-600 to-emerald-500 text-sm font-semibold text-white shadow-lg shadow-emerald-600/20 transition-all duration-200 hover:from-emerald-500 hover:to-emerald-400 active:scale-95">
            {t("ordering.add_to_cart")}
          </button>
        )}
      </div>
    </div>
  )
}

// A variant family grouped under one card: pick a size to add that specific
// variant (each variant is still its own product — no identity/stock change).
function VariantGroupCard({ entry, onAdd, t }: { entry: GroupEntry; onAdd: (p: MenuProduct) => void; t: (k: string) => string }) {
  const prices = entry.variants.map((v) => v.price)
  const min = Math.min(...prices), max = Math.max(...prices)
  const priceLabel = min === max ? fmt(min) : `${fmt(min)} – ${fmt(max)}`
  const groupOOS = entry.variants.every((v) => v.stock <= 0)
  const imgVariant = entry.hasParentImage ? null : entry.variants.find((v) => v.image)
  const imgSrc = entry.hasParentImage
    ? `/api/delivery/public/image/${entry.parentId}`
    : imgVariant ? `/api/delivery/public/image/${imgVariant.id}` : null
  return (
    <div className={`bg-glass border border-glass rounded-xl overflow-hidden ${groupOOS ? "opacity-50" : "shadow-lg"}`}>
      {imgSrc ? (
        groupOOS
          ? <img src={imgSrc} alt={entry.name} className="w-full aspect-[4/3] object-cover grayscale" loading="lazy" />
          : <LazyProductImage src={imgSrc} name={entry.name} />
      ) : <ProductImagePlaceholder name={entry.name} />}
      <div className="p-3">
        <div className="flex items-center justify-between">
          <span className={`rounded-lg px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider ${groupOOS ? "bg-white/[0.06] text-muted" : "bg-emerald-500/10 border border-emerald-500/20 text-emerald-300"}`}>{entry.variants[0].category}</span>
          <span className={`text-sm font-bold ${groupOOS ? "text-muted" : "text-emerald-400"}`}>{priceLabel}</span>
        </div>
        <p className="mt-2 text-sm font-medium text-primary leading-tight">{entry.name}</p>
        {groupOOS ? (
          <p className="mt-2 text-center text-xs text-muted">{t("ordering.out_of_stock")}</p>
        ) : (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {entry.variants.map((v) => {
              const vOOS = v.stock <= 0
              return (
                <button key={v.id} disabled={vOOS} onClick={() => onAdd(v)}
                  aria-label={`Add ${entry.name} ${v.variantName ?? ""} — ${fmt(v.price)}`}
                  className={`rounded-lg px-2.5 py-1.5 text-xs font-semibold transition-all ${vOOS ? "bg-white/[0.04] text-muted line-through cursor-not-allowed" : "bg-emerald-600/90 text-white hover:bg-emerald-500 active:scale-95"}`}>
                  {(v.variantName ?? v.name)} · {fmt(v.price)}
                </button>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

type CartItem = { product: Product; quantity: number }
type OrderPayload = { tenantId: string; customerName: string; customerPhone: string; address: string; deliveryNote?: string; deliveryFee: number; customerId?: string; paymentMethod: string; items: Array<{ productId: number; productName: string; barcode: string; quantity: number; unitPrice: number }> }

export function MenuPage() {
  const { tenantSubdomain } = useParams<{ tenantSubdomain: string }>()
  const navigate = useNavigate()
  const { t, locale, setLocale } = useI18n()
  const [tenantId, setTenantId] = useState<string | null>(null)
  const [storeName, setStoreName] = useState("")
  const [products, setProducts] = useState<Product[]>([])
  const [cart, setCart] = useState<CartItem[]>(() => {
    try { return JSON.parse(localStorage.getItem(`cart_${tenantSubdomain}`) ?? "[]") } catch { return [] }
  })
  const [activeCategory, setActiveCategory] = useState<string>("All")
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showCart, setShowCart] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [customerName, setCustomerName] = useState(localStorage.getItem("customer_name") || "")
  const [customerPhone, setCustomerPhone] = useState(localStorage.getItem("customer_mobile") || "")
  const [address, setAddress] = useState("")
  const [deliveryNote, setDeliveryNote] = useState("")
  const [deliveryFee, setDeliveryFee] = useState(2.0)
  const [paymentMethod, setPaymentMethod] = useState("CashOnDelivery")
  const [orderError, setOrderError] = useState<string | null>(null)
  const [searchInput, setSearchInput] = useState("")
  const [search, setSearch] = useState("")
  const cartRef = useRef<HTMLDivElement>(null)
  const customerId = localStorage.getItem("customer_id") || undefined
  const CART_KEY = `cart_${tenantSubdomain}`
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const lastCartSaveRef = useRef(0)

  useEffect(() => {
    if (!tenantSubdomain) return
    setLoading(true)
    api<{ id: string; name: string }>(`/api/delivery/tenant?subdomain=${tenantSubdomain}`)
      .then((tenant) => {
        setTenantId(tenant.id)
        setStoreName(tenant.name)
        api<{ deliveryFee?: number }>(`/api/delivery/settings?tenantId=${tenant.id}`)
          .then(s => setDeliveryFee(s.deliveryFee ?? 2.0))
          .catch(() => {})
        return api<Product[]>("/api/delivery/products?tenantId=" + tenant.id)
      })
      .then((data) => { setProducts(data); setLoading(false) })
      .catch((err) => { setError(err.message); setLoading(false) })
  }, [tenantSubdomain])

  useEffect(() => {
    const now = Date.now()
    if (now - lastCartSaveRef.current >= CART_THROTTLE_MS) {
      localStorage.setItem(CART_KEY, JSON.stringify(cart))
      lastCartSaveRef.current = now
    } else {
      const timer = setTimeout(() => {
        localStorage.setItem(CART_KEY, JSON.stringify(cart))
        lastCartSaveRef.current = Date.now()
      }, CART_THROTTLE_MS)
      return () => clearTimeout(timer)
    }
  }, [cart, CART_KEY])

  const categories = useMemo(() => ["All", ...new Set(products.map((p) => p.category))], [products])

  const filteredProducts = useMemo(() => {
    const q = search.trim().toLowerCase()
    return products.filter((p) => {
      const matchCat = activeCategory === "All" || p.category === activeCategory
      const matchSearch = !q || p.name.toLowerCase().includes(q) || p.category.toLowerCase().includes(q)
      return matchCat && matchSearch
    })
  }, [products, activeCategory, search])

  // POS-ORDER-CATALOG-1: group variant rows under one parent entry (choose a
  // size on the card); standalone products stay as single entries. Split into
  // in-stock / out-of-stock, keeping OOS at the bottom as before.
  const { inStock, outOfStock } = useMemo(() => {
    const groups = new Map<number, MenuProduct[]>()
    const singles: MenuProduct[] = []
    for (const p of filteredProducts as MenuProduct[]) {
      if (p.parentId != null) {
        const arr = groups.get(p.parentId) ?? []
        arr.push(p)
        groups.set(p.parentId, arr)
      } else {
        singles.push(p)
      }
    }
    const all: CatalogEntry[] = singles.map((product) => ({ kind: "single", product }))
    for (const [parentId, variants] of groups) {
      variants.sort((a, b) => a.price - b.price)
      all.push({
        kind: "group",
        parentId,
        name: variants[0].parent?.name ?? variants[0].name,
        hasParentImage: !!variants[0].parent?.image,
        variants,
      })
    }
    const nameOf = (e: CatalogEntry) => (e.kind === "single" ? e.product.name : e.name)
    all.sort((a, b) => nameOf(a).localeCompare(nameOf(b)))
    const available = (e: CatalogEntry) =>
      e.kind === "single" ? e.product.stock > 0 : e.variants.some((v) => v.stock > 0)
    return { inStock: all.filter(available), outOfStock: all.filter((e) => !available(e)) }
  }, [filteredProducts])

  const cartStats = useMemo(() => ({
    count: cart.reduce((sum, item) => sum + item.quantity, 0),
    total: cart.reduce((sum, item) => sum + item.product.price * item.quantity, 0),
  }), [cart])

  const addToCart = useCallback((product: Product) => {
    setCart((prev) => {
      const existing = prev.find((item) => item.product.id === product.id)
      if (existing) return prev.map((item) => item.product.id === product.id ? { ...item, quantity: item.quantity + 1 } : item)
      return [...prev, { product, quantity: 1 }]
    })
  }, [])

  const updateQuantity = useCallback((productId: number, delta: number) => {
    setCart((prev) => prev.map((item) => item.product.id === productId ? { ...item, quantity: item.quantity + delta } : item).filter((item) => item.quantity > 0))
  }, [])

  const handleSearchChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value
    setSearchInput(value)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => setSearch(value), 250)
  }, [])

  const placeOrder = useCallback(async () => {
    if (!tenantId) return
    setOrderError(null)
    setSubmitting(true)
    try {
      const payload: OrderPayload = {
        tenantId, customerName, customerPhone, address,
        deliveryNote: deliveryNote || undefined, deliveryFee: deliveryFee,
        customerId, paymentMethod,
        items: cart.map((item) => ({ productId: item.product.id, productName: item.product.name, barcode: item.product.barcode ?? "", quantity: item.quantity, unitPrice: item.product.price })),
      }
      const result = await api<{ order: { orderNumber: string } }>("/api/delivery/order", { method: "POST", body: JSON.stringify(payload) })
      setCart([])
      localStorage.removeItem(CART_KEY)
      navigate(`/order/${tenantSubdomain}/track/${result.order.orderNumber}`)
    } catch (err: any) { setOrderError(err.message) }
    finally { setSubmitting(false) }
  }, [tenantId, customerName, customerPhone, address, deliveryNote, deliveryFee, cart, tenantSubdomain, navigate, customerId, paymentMethod, CART_KEY])

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (cartRef.current && !cartRef.current.contains(e.target as Node)) setShowCart(false)
    }
    if (showCart) setTimeout(() => document.addEventListener("click", handleClickOutside), 0)
    return () => document.removeEventListener("click", handleClickOutside)
  }, [showCart])

  if (loading) return (
    <div className="min-h-dvh bg-gradient-page flex items-center justify-center">
      <div className="text-center animate-pulse">
        <div className="inline-flex items-center justify-center w-20 h-20 rounded-3xl bg-gradient-to-br from-emerald-400 to-emerald-600 text-4xl shadow-xl shadow-emerald-600/20 mb-5">🛵</div>
        <p className="text-secondary text-sm">{t("ordering.loading_menu")}</p>
      </div>
    </div>
  )

  if (error) return (
    <div className="min-h-dvh bg-gradient-page flex items-center justify-center p-6">
      <div className="bg-glass border border-glass rounded-2xl p-8 text-center shadow-2xl max-w-sm w-full animate-fade-in">
        <div className="text-4xl mb-2">😕</div>
        <p className="text-secondary mb-4">{error}</p>
        <button onClick={() => navigate("/order")}
          className="px-6 py-3 rounded-xl bg-gradient-to-r from-emerald-600 to-emerald-500 text-white font-semibold shadow-lg shadow-emerald-600/20 transition-all duration-200 hover:from-emerald-500 hover:to-emerald-400">
          {t("ordering.try_again")}
        </button>
      </div>
    </div>
  )

  if (showCart) {
    return (
      <div ref={cartRef} className="fixed inset-0 z-50 flex flex-col bg-gradient-page">
        <div className="flex items-center justify-between px-4 py-4 border-b border-glass">
          <button onClick={() => setShowCart(false)} className="text-secondary hover:text-primary transition-colors font-medium">← {t("ordering.back_to_menu")}</button>
          <h2 className="text-lg font-semibold text-primary">{t("ordering.your_cart")} ({cartStats.count})</h2>
          <div className="w-20" />
        </div>
        <div className="flex-1 overflow-y-auto p-4">
          {cart.length === 0 ? (
            <div className="mt-20 text-center">
            <div className="text-5xl mb-3 opacity-30">🛒</div>
            <p className="text-lg font-semibold text-primary">{t("ordering.cart_empty")}</p>
            <button onClick={() => setShowCart(false)}
              className="mt-4 px-6 py-3 rounded-xl bg-gradient-to-r from-emerald-600 to-emerald-500 text-white text-sm font-semibold shadow-lg shadow-emerald-600/20 hover:from-emerald-500 hover:to-emerald-400 transition-all">
              {t("ordering.back_to_menu")}
            </button>
          </div>
          ) : (
            <div className="space-y-3 max-w-md mx-auto">
              {cart.map((item) => (
                <div key={item.product.id} className="flex items-center gap-3 bg-glass border border-glass rounded-xl p-3">
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-primary text-sm truncate">{item.product.name}</p>
                    <p className="text-xs text-secondary">{fmt(item.product.price)} each · {fmt(item.product.price * item.quantity)}</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button onClick={() => updateQuantity(item.product.id, -1)}
                      aria-label={`Decrease ${item.product.name} quantity`}
                      className="flex h-10 w-10 items-center justify-center rounded-xl bg-glass text-primary text-lg font-bold hover:bg-glass-hover active:scale-95 transition-all">–</button>
                    <span className="w-7 text-center font-bold text-primary text-sm">{item.quantity}</span>
                    <button onClick={() => updateQuantity(item.product.id, 1)}
                      aria-label={`Increase ${item.product.name} quantity`}
                      className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-500 to-emerald-600 text-white text-lg font-bold shadow-md shadow-emerald-600/20 hover:from-emerald-400 hover:to-emerald-500 active:scale-95 transition-all">+</button>
                    <button onClick={() => updateQuantity(item.product.id, -item.quantity)}
                      aria-label={`Remove ${item.product.name} from cart`}
                      className="flex h-10 w-10 items-center justify-center rounded-xl border border-glass text-muted hover:text-rose-400 hover:border-rose-500/20 active:scale-95 transition-all">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                    </button>
                  </div>
                </div>
              ))}
              <div className="bg-glass border border-glass rounded-xl p-4">
                <p className="text-xs text-secondary font-semibold mb-2 uppercase tracking-wide">{t("ordering.order_summary") || "Order Summary"}</p>
                <div className="flex justify-between text-sm text-secondary"><span>{cartStats.count} {cartStats.count === 1 ? t("ordering.item") : t("ordering.items")}</span><span>{fmt(cartStats.total)}</span></div>
                <div className="flex justify-between text-sm text-secondary"><span>{t("ordering.delivery_fee")}</span><span>{fmt(deliveryFee)}</span></div>
                <div className="mt-2 pt-2 border-t border-glass flex justify-between text-lg font-bold text-primary"><span>{t("ordering.total")}</span><span>{fmt(cartStats.total + deliveryFee)}</span></div>
              </div>
            </div>
          )}
        </div>
        {cart.length > 0 && (
          <div className="border-t border-glass p-4">
            <h3 className="text-sm font-bold text-primary mb-3">{t("ordering.checkout_details") || "Your Details"}</h3>
            <div className="max-w-md mx-auto space-y-3">
              {orderError && (
                <div className="p-3 bg-rose-500/10 border border-rose-500/20 text-rose-300 text-sm rounded-xl text-center">{orderError}</div>
              )}
              <input value={customerName} onChange={e => setCustomerName(e.target.value)}
                placeholder={t("ordering.your_name")}
                aria-label={t("ordering.your_name")}
                className="w-full px-4 py-3.5 rounded-xl bg-white/5 border border-glass text-primary placeholder:text-muted text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/40 transition-all" />
              <input type="tel" value={customerPhone} onChange={e => setCustomerPhone(e.target.value)}
                placeholder={t("ordering.phone_number")}
                aria-label={t("ordering.phone_number")}
                className="w-full px-4 py-3.5 rounded-xl bg-white/5 border border-glass text-primary placeholder:text-muted text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/40 transition-all" />
              <input value={address} onChange={e => setAddress(e.target.value)}
                placeholder={t("ordering.delivery_address")}
                aria-label={t("ordering.delivery_address")}
                className="w-full px-4 py-3.5 rounded-xl bg-white/5 border border-glass text-primary placeholder:text-muted text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/40 transition-all" />
              <input value={deliveryNote} onChange={e => setDeliveryNote(e.target.value)}
                placeholder={t("ordering.delivery_note")}
                aria-label={t("ordering.delivery_note")}
                className="w-full px-4 py-3.5 rounded-xl bg-white/5 border border-glass text-primary placeholder:text-muted text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/40 transition-all" />
              <div>
                <label className="block text-xs text-secondary mb-2 font-semibold">{t("ordering.payment_method") || "Payment Method"}</label>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { value: "CashOnDelivery", label: t("ordering.cash_on_delivery") || "Cash" },
                    { value: "Card", label: t("ordering.card") || "Card" },
                    { value: "Wallet", label: t("ordering.wallet") || "Wallet" },
                  ].map(pm => (
                    <button key={pm.value} type="button" onClick={() => setPaymentMethod(pm.value)}
                      aria-pressed={paymentMethod === pm.value}
                      className={`py-2.5 rounded-xl text-sm font-medium transition-all ${paymentMethod === pm.value ? "bg-emerald-600 text-white shadow-lg shadow-emerald-600/20" : "bg-white/5 border border-glass text-secondary hover:bg-white/10"}`}>
                      {pm.label}
                    </button>
                  ))}
                </div>
              </div>
              {/* Block explanation */}
              {(!customerName || !customerPhone || !address) && (
                <div className="flex flex-wrap gap-1.5 text-[11px]">
                  {!customerName && <span className="rounded-lg bg-rose-500/10 border border-rose-500/20 px-2 py-1 text-rose-300 font-medium">Name required</span>}
                  {!customerPhone && <span className="rounded-lg bg-rose-500/10 border border-rose-500/20 px-2 py-1 text-rose-300 font-medium">Phone required</span>}
                  {!address && <span className="rounded-lg bg-rose-500/10 border border-rose-500/20 px-2 py-1 text-rose-300 font-medium">Address required</span>}
                </div>
              )}
              <button onClick={placeOrder} disabled={submitting || !customerName || !customerPhone || !address}
                className="w-full py-4 rounded-xl bg-gradient-to-r from-emerald-600 to-emerald-500 text-white font-semibold shadow-lg shadow-emerald-600/20 transition-all duration-200 hover:from-emerald-500 hover:to-emerald-400 active:from-emerald-700 active:to-emerald-600 disabled:opacity-50 disabled:cursor-not-allowed">
                {submitting ? t("ordering.placing_order") : `${t("ordering.place_order")} — ${fmt(cartStats.total + deliveryFee)}`}
              </button>
            </div>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="min-h-dvh bg-gradient-page pb-24">
      <header className="sticky top-0 z-10 backdrop-blur-xl border-b border-glass px-4 py-3" style={{ background: "var(--header-bg)" }}>
        <div className="flex items-center justify-between max-w-md mx-auto">
          <div>
            <h1 className="text-lg font-bold text-primary">{storeName}</h1>
            <p className="text-xs text-secondary">{t("ordering.title")}</p>
          </div>
          <div className="flex items-center gap-2">
            {customerId ? (
              <button onClick={() => navigate(`/order/${tenantSubdomain}/orders`)}
                className="text-[10px] text-secondary hover:text-primary bg-glass px-2 py-1.5 rounded-lg transition-all">
                {t("ordering.my_orders")}
              </button>
            ) : (
              <button onClick={() => navigate(`/order/${tenantSubdomain}/login`)}
                className="text-[10px] text-secondary hover:text-primary bg-glass px-2 py-1.5 rounded-lg transition-all">
                {t("ordering.sign_in")}
              </button>
            )}
            <button onClick={() => setLocale(locale === "en" ? "ar" : "en")}
              className="text-[10px] text-secondary hover:text-primary bg-glass px-2 py-1.5 rounded-lg transition-all">
              {locale === "en" ? "ع" : "EN"}
            </button>
            <button onClick={() => { setOrderError(null); setShowCart(true) }}
              aria-label={`Open cart — ${cartStats.count} items`}
              className="relative flex h-11 w-11 items-center justify-center rounded-2xl bg-glass border border-glass">
              <svg className="w-5 h-5 text-secondary" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 100 4 2 2 0 000-4z" /></svg>
              {cartStats.count > 0 && (
                <span className="absolute -right-1.5 -top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-emerald-500 px-1 text-[11px] font-bold text-white shadow-lg shadow-emerald-600/30">
                  {cartStats.count}
                </span>
              )}
            </button>
          </div>
        </div>
      </header>

      <div className="border-b border-glass px-4 py-2">
        <div className="max-w-md mx-auto">
          <input
            type="search"
            value={searchInput}
            onChange={handleSearchChange}
            placeholder={t("ordering.search_menu")}
            aria-label={t("ordering.search_menu")}
            className="w-full px-4 py-2.5 rounded-xl bg-white/5 border border-glass text-primary placeholder:text-muted text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/40 transition-all"
          />
        </div>
      </div>

      <div className="overflow-x-auto border-b border-glass px-4 py-3">
        <div className="flex gap-2 max-w-md mx-auto">
          {categories.map((cat) => (
            <button key={cat} onClick={() => setActiveCategory(cat)}
              aria-pressed={activeCategory === cat}
              className={`whitespace-nowrap rounded-xl px-4 py-2 text-sm font-medium transition-all duration-200 ${activeCategory === cat ? "bg-gradient-to-r from-emerald-600 to-emerald-500 text-white shadow-lg shadow-emerald-600/20" : "bg-glass text-secondary hover:bg-glass-hover"}`}>
              {cat === "All" ? t("ordering.all") : cat}
            </button>
          ))}
        </div>
      </div>

      <div className="p-4 max-w-md mx-auto">
        {inStock.length === 0 && outOfStock.length === 0 && (
          <div className="mt-20 text-center">
            <div className="text-5xl mb-2">🍽️</div>
            <p className="text-muted">{t("ordering.no_products")}</p>
          </div>
        )}
        <div className="grid grid-cols-2 gap-3">
          {[...inStock, ...outOfStock].map((entry) =>
            entry.kind === "single" ? (
              <CatalogCard key={`p${entry.product.id}`} product={entry.product} onAdd={addToCart} t={t} />
            ) : (
              <VariantGroupCard key={`g${entry.parentId}`} entry={entry} onAdd={addToCart} t={t} />
            )
          )}
        </div>
      </div>

      {cartStats.count > 0 && (
        <div className="fixed bottom-0 left-0 right-0 z-20 bg-glass border-t border-glass px-4 py-3 shadow-2xl" style={{ backdropFilter: 'blur(16px)' }}>
          <button onClick={() => setShowCart(true)}
            aria-label={`View cart — ${cartStats.count} items, total ${fmt(cartStats.total + deliveryFee)}`}
            className="flex w-full items-center justify-between rounded-xl bg-gradient-to-r from-emerald-600 to-emerald-500 px-5 py-3.5 text-white shadow-xl shadow-emerald-600/20 max-w-md mx-auto">
            <span className="font-semibold">🛒 {cartStats.count} {cartStats.count === 1 ? t("ordering.item") : t("ordering.items")}</span>
            <span className="font-semibold">{fmt(cartStats.total + deliveryFee)}</span>
          </button>
        </div>
      )}
    </div>
  )
}

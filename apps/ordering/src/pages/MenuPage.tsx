import { useState, useEffect, useCallback, useRef } from "react"
import { useParams, useNavigate } from "react-router"
import { useI18n } from "@lebanonpos/shared"
import { api } from "../app/api"

type Product = { id: number; name: string; price: number; barcode: string; category: string; stock: number; variantName: string | null }
type CartItem = { product: Product; quantity: number }
type OrderPayload = { tenantId: string; customerName: string; customerPhone: string; address: string; deliveryNote?: string; deliveryFee: number; customerId?: string; items: Array<{ productId: number; productName: string; barcode: string; quantity: number; unitPrice: number }> }

export function MenuPage() {
  const { tenantSubdomain } = useParams<{ tenantSubdomain: string }>()
  const navigate = useNavigate()
  const { t, locale, setLocale } = useI18n()
  const [tenantId, setTenantId] = useState<string | null>(null)
  const [storeName, setStoreName] = useState("")
  const [products, setProducts] = useState<Product[]>([])
  const [cart, setCart] = useState<CartItem[]>([])
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
  const cartRef = useRef<HTMLDivElement>(null)
  const customerId = localStorage.getItem("customer_id") || undefined

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

  const categories = ["All", ...new Set(products.map((p) => p.category))]
  const filteredProducts = activeCategory === "All" ? products : products.filter((p) => p.category === activeCategory)
  const inStock = filteredProducts.filter((p) => p.stock > 0)
  const outOfStock = filteredProducts.filter((p) => p.stock === 0)
  const cartCount = cart.reduce((sum, item) => sum + item.quantity, 0)
  const cartTotal = cart.reduce((sum, item) => sum + item.product.price * item.quantity, 0)

  function addToCart(product: Product) {
    setCart((prev) => {
      const existing = prev.find((item) => item.product.id === product.id)
      if (existing) return prev.map((item) => item.product.id === product.id ? { ...item, quantity: item.quantity + 1 } : item)
      return [...prev, { product, quantity: 1 }]
    })
  }

  function updateQuantity(productId: number, delta: number) {
    setCart((prev) => prev.map((item) => item.product.id === productId ? { ...item, quantity: item.quantity + delta } : item).filter((item) => item.quantity > 0))
  }

  const placeOrder = useCallback(async () => {
    if (!tenantId) return
    setSubmitting(true)
    try {
      const payload: OrderPayload = {
        tenantId, customerName, customerPhone, address,
        deliveryNote: deliveryNote || undefined, deliveryFee: deliveryFee,
        customerId,
        items: cart.map((item) => ({ productId: item.product.id, productName: item.product.name, barcode: item.product.barcode, quantity: item.quantity, unitPrice: item.product.price })),
      }
      const result = await api<{ orderNumber: string }>("/api/delivery/order", { method: "POST", body: JSON.stringify(payload) })
      navigate(`/order/${tenantSubdomain}/track/${result.orderNumber}`)
    } catch (err: any) { setError(err.message); setSubmitting(false) }
  }, [tenantId, customerName, customerPhone, address, deliveryNote, cart, tenantSubdomain, navigate])

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
      <div className="fixed inset-0 z-50 flex flex-col bg-gradient-page">
        <div className="flex items-center justify-between px-4 py-4 border-b border-glass">
          <button onClick={() => setShowCart(false)} className="text-secondary hover:text-primary transition-colors font-medium">← {t("ordering.back_to_menu")}</button>
          <h2 className="text-lg font-semibold text-primary">{t("ordering.your_cart")} ({cartCount})</h2>
          <div className="w-20" />
        </div>
        <div ref={cartRef} className="flex-1 overflow-y-auto p-4">
          {cart.length === 0 ? (
            <div className="mt-20 text-center">
              <div className="text-5xl mb-2">🛒</div>
              <p className="text-muted">{t("ordering.cart_empty")}</p>
            </div>
          ) : (
            <div className="space-y-3 max-w-md mx-auto">
              {cart.map((item) => (
                <div key={item.product.id} className="flex items-center justify-between bg-glass border border-glass rounded-xl p-3">
                  <div className="flex-1">
                    <p className="font-medium text-primary text-sm">{item.product.name}</p>
                    <p className="text-sm text-secondary">${item.product.price.toFixed(2)}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <button onClick={() => updateQuantity(item.product.id, -1)}
                      className="flex h-8 w-8 items-center justify-center rounded-full bg-glass text-primary font-bold hover:bg-glass-hover transition-all">–</button>
                    <span className="w-6 text-center font-semibold text-primary">{item.quantity}</span>
                    <button onClick={() => updateQuantity(item.product.id, 1)}
                      className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-emerald-500 to-emerald-600 text-white font-bold shadow-lg shadow-emerald-600/20 hover:from-emerald-400 hover:to-emerald-500 transition-all">+</button>
                  </div>
                </div>
              ))}
              <div className="bg-glass border border-glass rounded-xl p-4">
                <div className="flex justify-between text-sm text-secondary"><span>{t("ordering.subtotal")}</span><span>${cartTotal.toFixed(2)}</span></div>
                <div className="flex justify-between text-sm text-secondary"><span>{t("ordering.delivery_fee")}</span><span>${deliveryFee.toFixed(2)}</span></div>
                <div className="mt-2 pt-2 border-t border-glass flex justify-between text-lg font-bold text-primary"><span>{t("ordering.total")}</span><span>${(cartTotal + deliveryFee).toFixed(2)}</span></div>
              </div>
            </div>
          )}
        </div>
        {cart.length > 0 && (
          <div className="border-t border-glass p-4">
            <div className="max-w-md mx-auto space-y-3">
              <input value={customerName} onChange={e => setCustomerName(e.target.value)} placeholder={t("ordering.your_name")}
                className="w-full px-4 py-3.5 rounded-xl bg-white/5 border border-glass text-primary placeholder:text-muted text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/40 transition-all" />
              <input type="tel" value={customerPhone} onChange={e => setCustomerPhone(e.target.value)} placeholder={t("ordering.phone_number")}
                className="w-full px-4 py-3.5 rounded-xl bg-white/5 border border-glass text-primary placeholder:text-muted text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/40 transition-all" />
              <input value={address} onChange={e => setAddress(e.target.value)} placeholder={t("ordering.delivery_address")}
                className="w-full px-4 py-3.5 rounded-xl bg-white/5 border border-glass text-primary placeholder:text-muted text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/40 transition-all" />
              <input value={deliveryNote} onChange={e => setDeliveryNote(e.target.value)} placeholder={t("ordering.delivery_note")}
                className="w-full px-4 py-3.5 rounded-xl bg-white/5 border border-glass text-primary placeholder:text-muted text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/40 transition-all" />
              <button onClick={placeOrder} disabled={submitting || !customerName || !customerPhone || !address}
                className="w-full py-4 rounded-xl bg-gradient-to-r from-emerald-600 to-emerald-500 text-white font-semibold shadow-lg shadow-emerald-600/20 transition-all duration-200 hover:from-emerald-500 hover:to-emerald-400 active:from-emerald-700 active:to-emerald-600 disabled:opacity-50 disabled:cursor-not-allowed">
                {submitting ? t("ordering.placing_order") : `${t("ordering.place_order")} — $${(cartTotal + deliveryFee).toFixed(2)}`}
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
                My Orders
              </button>
            ) : (
              <button onClick={() => navigate(`/order/${tenantSubdomain}/login`)}
                className="text-[10px] text-secondary hover:text-primary bg-glass px-2 py-1.5 rounded-lg transition-all">
                Sign In
              </button>
            )}
            <button onClick={() => setLocale(locale === "en" ? "ar" : "en")}
              className="text-[10px] text-secondary hover:text-primary bg-glass px-2 py-1.5 rounded-lg transition-all">
              {locale === "en" ? "ع" : "EN"}
            </button>
            <button onClick={() => setShowCart(true)}
              className="relative flex h-11 w-11 items-center justify-center rounded-2xl bg-glass border border-glass">
              <svg className="w-5 h-5 text-secondary" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 100 4 2 2 0 000-4z" /></svg>
              {cartCount > 0 && (
                <span className="absolute -right-1.5 -top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-emerald-500 px-1 text-[11px] font-bold text-white shadow-lg shadow-emerald-600/30">
                  {cartCount}
                </span>
              )}
            </button>
          </div>
        </div>
      </header>

      <div className="overflow-x-auto border-b border-glass px-4 py-3">
        <div className="flex gap-2 max-w-md mx-auto">
          {categories.map((cat) => (
            <button key={cat} onClick={() => setActiveCategory(cat)}
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
          {inStock.map((product) => (
            <div key={product.id} className="bg-glass border border-glass rounded-xl p-4 shadow-lg hover:bg-glass-hover transition-all duration-200">
              <div className="flex items-center justify-between">
                <span className="rounded-lg bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 text-[10px] text-emerald-300 font-medium uppercase tracking-wider">{product.category}</span>
                <span className="text-sm font-bold text-emerald-400">${product.price.toFixed(2)}</span>
              </div>
              <p className="mt-3 text-sm font-medium text-primary leading-tight">{product.name}</p>
              {product.variantName && <p className="text-xs text-secondary mt-0.5">{product.variantName}</p>}
              <button onClick={() => addToCart(product)}
                className="mt-3 flex h-9 w-full items-center justify-center rounded-lg bg-gradient-to-r from-emerald-600 to-emerald-500 text-sm font-semibold text-white shadow-lg shadow-emerald-600/20 transition-all duration-200 hover:from-emerald-500 hover:to-emerald-400 active:scale-95">
                {t("ordering.add_to_cart")}
              </button>
            </div>
          ))}
          {outOfStock.map((product) => (
            <div key={product.id} className="bg-glass border border-glass rounded-xl p-4 opacity-50">
              <div className="flex items-center justify-between">
                <span className="rounded-lg bg-white/[0.06] px-2 py-0.5 text-[10px] text-muted font-medium uppercase tracking-wider">{product.category}</span>
                <span className="text-sm font-bold text-muted">${product.price.toFixed(2)}</span>
              </div>
              <p className="mt-3 text-sm font-medium text-primary leading-tight">{product.name}</p>
              {product.variantName && <p className="text-xs text-muted mt-0.5">{product.variantName}</p>}
              <p className="mt-3 text-center text-xs text-muted">{t("ordering.out_of_stock")}</p>
            </div>
          ))}
        </div>
      </div>

      {cartCount > 0 && (
        <div className="fixed bottom-0 left-0 right-0 z-20 bg-glass border-t border-glass px-4 py-3 shadow-2xl" style={{ backdropFilter: 'blur(16px)' }}>
          <button onClick={() => setShowCart(true)}
            className="flex w-full items-center justify-between rounded-xl bg-gradient-to-r from-emerald-600 to-emerald-500 px-5 py-3.5 text-white shadow-xl shadow-emerald-600/20 max-w-md mx-auto">
            <span className="font-semibold">🛒 {cartCount} {cartCount === 1 ? t("ordering.item") : t("ordering.items")}</span>
            <span className="font-semibold">${(cartTotal + deliveryFee).toFixed(2)}</span>
          </button>
        </div>
      )}
    </div>
  )
}

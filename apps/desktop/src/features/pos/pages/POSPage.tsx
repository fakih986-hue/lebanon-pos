import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useDebounce } from "../../../hooks/useDebounce"
import { useHotkeys } from "../../../hooks/useHotkey"
import { useI18n } from "@lebanonpos/shared"
import { PackageSearch, ShoppingCart } from "lucide-react"

import ConfirmDialog from "../../../components/ConfirmDialog"
import EmptyState from "../../../components/ui/EmptyState"
import ProductGrid from "../components/ProductGrid"
import ProductSkeletonGrid from "../components/ProductSkeletonGrid"
import ErrorBoundary from "../components/ErrorBoundary"
import SearchToolbar from "../components/SearchToolbar"
import DepartmentTabs from "../components/DepartmentTabs"
import FavoritesBar from "../components/FavoritesBar"
import LastSaleBanner from "../components/LastSaleBanner"
import SyncBanner from "../components/SyncBanner"
import SaleCompleteOverlay from "../components/SaleCompleteOverlay"
import CartDrawer from "../components/CartDrawer"
import CartPanel from "../components/CartPanel"

import VariantPicker from "../components/VariantPicker"
import QuickPOSMode from "../components/QuickPOSMode"
import KeyboardShortcutsModal from "../components/KeyboardShortcutsModal"
import { playErrorBuzz, playScanBlip } from "../lib/sound"
import { openWhatsAppShare, receiptMessage } from "../lib/whatsapp"
import {
  computeCashChange,
  formatCurrency,
  formatLbpCurrency,
  formatNumber,
  lbpToUsd,
  roundMoney,
  ceilLbp,
  usdToLbp,
} from "../lib/currency"
import {
  parseMoney,
} from "../lib/helpers"
import { departmentIcons } from "../lib/pos.constants"
import { printLastSaleReceipt, type LastSaleSummary } from "../lib/printReceipt"
import {
  productHasBarcode,
  productMatchesSearch,
  toggleProductFavorite,
} from "../services/product.service"
import { decreaseProductStock, increaseProductStock } from "../services/product.service"
import { recordSale, voidSale, type SaleTender } from "../services/sales.service"
import {
  holdSale,
  removeHeldSale,
  type HeldSale,
} from "../services/heldSale.service"
import { recordDebtSale } from "../services/customer.service"
import { recordAuditEvent, userCan } from "../services/security.service"
import { consumeInventoryBatches, restoreInventoryBatches } from "../services/inventoryBatch.service"
import { getConnectionMode, pullFromServer, validateStockWithHub } from "../services/sync.service"

import type { Product } from "../types/product"
import { usePosData } from "../hooks/usePosData"
import { useBarcodeScanner } from "../hooks/useBarcodeScanner"

type PaymentMethod = "Cash" | "Card" | "Wallet" | "Debt"
type TenderMode = "USD" | "LBP" | "Mixed"
type DiscountMode = "USD" | "Percent"

type CartItem = Product & {
  quantity: number
}

export default function POSPage() {
  const { t, dir } = useI18n()

  // --- Data ---
  const { products, isLoading, heldSales, customers, settings } = usePosData()

  // --- Scanner / barcode ---
  const {
    scanInputRef,
    scanCode,
    setScanCode,
    scannerStatus,
    setScannerStatus,
    cameraActive,
    cameraEngine,
    startCameraScanner,
    handleScanCapture,
    videoRef,
    scanCaptureInputRef,
  } = useBarcodeScanner((product, source) => addProductToSale(product, source))

  // --- Local state ---
  const [items, setItems] = useState<CartItem[]>([])
  const [selectedCustomerId, setSelectedCustomerId] = useState("")
  const [selectedCategory, setSelectedCategory] = useState("All")
  const [search, setSearch] = useState("")
  const debouncedSearch = useDebounce(search, 200)
  const [paymentMethod, setPaymentMethod] =
    useState<PaymentMethod>("Cash")
  const [paidUsd, setPaidUsd] = useState("")
  const [paidLbp, setPaidLbp] = useState("")
  const [discountMode, setDiscountMode] = useState<DiscountMode>("USD")
  const [discountValue, setDiscountValue] = useState("")
  const [lastSale, setLastSale] = useState<LastSaleSummary | null>(null)
  const [recentSales, setRecentSales] = useState<LastSaleSummary[]>(() => {
    try {
      const stored = localStorage.getItem("lebanonpos.recent-sales.v1")
      return stored ? (JSON.parse(stored) as LastSaleSummary[]).slice(0, 2) : []
    } catch { return [] }
  })
  const [isCartOpen, setIsCartOpen] = useState(false)
  const [confirmAction, setConfirmAction] = useState<{
    title: string
    message: string
    confirmLabel: string
    confirmDestructive?: boolean
    onConfirm: () => void
  } | null>(null)
  const [variantPickerProduct, setVariantPickerProduct] =
    useState<Product | null>(null)
  const [saleNote, setSaleNote] = useState("")
  const [sellAtCost, setSellAtCost] = useState(false)
  const [quickMode, setQuickMode] = useState(false)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const [showReview, setShowReview] = useState(false)

  const productListRef = useRef<HTMLDivElement | null>(null)

  // --- Auto-select first customer for Debt ---
  useEffect(() => {
    if (paymentMethod === "Debt" && !selectedCustomerId && customers[0]) {
      setSelectedCustomerId(customers[0].id)
    }
  }, [customers, paymentMethod, selectedCustomerId])

  // --- Hotkeys ---
  useHotkeys([
    {
      key: "f",
      modifiers: ["ctrl"],
      handler: () => scanInputRef.current?.focus(),
    },
    {
      key: "f8",
      handler: () => { if (items.length > 0) setIsCartOpen(true) },
    },
    {
      key: "Escape",
      handler: () => { if (isCartOpen) setIsCartOpen(false); if (shortcutsOpen) setShortcutsOpen(false) },
    },
    {
      key: "/",
      modifiers: ["shift"],
      handler: () => setShortcutsOpen((v) => !v),
    },
  ])

  useEffect(() => {
    if (!quickMode) return
    window.requestAnimationFrame(() => scanInputRef.current?.focus())
  }, [quickMode, scanInputRef])

  // --- Listen for rejected sync operations (e.g. insufficient stock) ---
  useEffect(() => {
    const onRejected = (e: Event) => {
      const op = (e as CustomEvent).detail
      const msg = op?.error ? `⚠️ ${op.error}` : "⚠️ Sale was not completed by server"
      setScannerStatus(msg)
    }
    window.addEventListener("sync:operation-rejected", onRejected)
    return () => window.removeEventListener("sync:operation-rejected", onRejected)
  }, [])

  // Auto-activate sellAtCost when selecting a cost-customer
  useEffect(() => {
    if (selectedCustomer?.sellAtCost) {
      setSellAtCost(true)
    }
  }, [selectedCustomerId])

  // Persist recent sales across navigation
  useEffect(() => {
    if (recentSales.length > 0) {
      localStorage.setItem("lebanonpos.recent-sales.v1", JSON.stringify(recentSales))
    }
  }, [recentSales])

  // --- Computed values ---
  const departmentSummaries = useMemo(() => {
    const categoryNames = [
      "All",
      "Favorites",
      ...Array.from(new Set(products.map((product) => product.category))),
    ]
    return categoryNames.map((category) => {
      const departmentProducts =
        category === "All"
          ? products
          : category === "Favorites"
            ? products.filter((product) => product.favorite)
          : products.filter((product) => product.category === category)
      const Icon = departmentIcons[category] ?? PackageSearch

      return {
        name: category,
        label: category === "All" ? "All Items" : category,
        Icon,
        productCount: departmentProducts.length,
        stockCount: departmentProducts.reduce((sum, p) => sum + p.stock, 0),
      }
    })
  }, [products])

  const filteredProducts = useMemo(() => {
    const query = (debouncedSearch || scanCode).trim().toLowerCase()
    return products.filter((product) => {
      const matchesCategory =
        selectedCategory === "All" ||
        (selectedCategory === "Favorites" && product.favorite) ||
        product.category === selectedCategory
      const matchesSearch =
        query.length === 0 || productMatchesSearch(product, query)
      return matchesCategory && matchesSearch
    }).sort((a, b) => Number(Boolean(b.favorite)) - Number(Boolean(a.favorite)))
  }, [products, scanCode, search, selectedCategory])

  const canApplyDiscount = userCan("sales.discount")
  const grossSubtotal = roundMoney(items.reduce(
    (sum, item) => sum + item.price * item.quantity, 0
  ))
  const parsedDiscountValue = parseMoney(discountValue)
  const discountTotal = canApplyDiscount
    ? roundMoney(Math.min(
        grossSubtotal,
        discountMode === "Percent"
          ? grossSubtotal * (Math.min(100, parsedDiscountValue) / 100)
          : parsedDiscountValue
      ))
    : 0
  const subtotal = roundMoney(Math.max(0, grossSubtotal - discountTotal))
  const tax = roundMoney(subtotal * settings.vatRate)
  const total = roundMoney(subtotal + tax)
  const exchangeRate = Math.max(1, settings.usdToLbpRate)
  const totalLbp = usdToLbp(total, exchangeRate)
  const payableLbp = ceilLbp(totalLbp, 5000)
  const payableUsd = lbpToUsd(payableLbp, exchangeRate)
  const itemCount = items.reduce((sum, item) => sum + item.quantity, 0)
  const selectedCustomer = customers.find(
    (customer) => customer.id === selectedCustomerId
  )
  const hasDiscount = discountTotal > 0
  const cartQuantities = useMemo(() => {
    const map: Record<number, number> = {}
    for (const item of items) map[item.id] = item.quantity
    return map
  }, [items])
  const paidUsdAmount = parseMoney(paidUsd)
  const paidLbpAmount = parseMoney(paidLbp)
  const tenderMode: TenderMode = paidLbpAmount > 0 ? (paidUsdAmount > 0 ? "Mixed" : "LBP") : "USD"
  const paidTotalUsd = roundMoney(paidUsdAmount + lbpToUsd(paidLbpAmount, exchangeRate))
  const paidTotalLbp = usdToLbp(paidTotalUsd, exchangeRate)
  const cashStillDueUsd = roundMoney(Math.max(0, payableUsd - paidTotalUsd))
  const { changeUsd: cashChangeUsd, changeLbp: cashChangeLbp } = computeCashChange({
    paidUsd: paidUsdAmount, paidLbp: paidLbpAmount,
    totalUsd: payableUsd, totalLbp: payableLbp, exchangeRate,
  })
  const cashTenderValid =
    paymentMethod !== "Cash" || items.length === 0 ||
    (tenderMode === "LBP" ? paidLbpAmount >= payableLbp : paidTotalUsd + 0.005 >= payableUsd)
  const creditLimitExceeded = Boolean(
    paymentMethod === "Debt" &&
      selectedCustomer &&
      selectedCustomer.creditLimit > 0 &&
      selectedCustomer.balance + total > selectedCustomer.creditLimit
  )
  const [isValidatingStock, setIsValidatingStock] = useState(false)
  const checkoutBlocked =
    items.length === 0 ||
    isValidatingStock ||
    (paymentMethod === "Cash" && !cashTenderValid) ||
    (paymentMethod === "Debt" && (!selectedCustomer || creditLimitExceeded))

  // --- Cart operations ---
  function addItem(product: Product) {
    if (product.stock <= 0) return
    const effectivePrice = sellAtCost
      ? product.cost
      : selectedCustomer?.isWholesale && product.wholesalePrice != null
      ? Number(product.wholesalePrice)
      : product.price
    setItems((currentItems) => {
      const existingItem = currentItems.find((item) => item.id === product.id)
      if (existingItem) {
        if (existingItem.quantity >= product.stock) return currentItems
        return currentItems.map((item) =>
          item.id === product.id
            ? { ...item, quantity: item.quantity + 1, price: effectivePrice }
            : item
        )
      }
      return [...currentItems, { ...product, quantity: 1, price: effectivePrice }]
    })
  }

  function toggleSellAtCost() {
    setSellAtCost((prev) => {
      const next = !prev
      setItems((currentItems) =>
        currentItems.map((item) => {
          const product = products.find((p) => p.id === item.id)
          if (!product) return item
          const normalPrice = selectedCustomer?.isWholesale && product.wholesalePrice != null
            ? Number(product.wholesalePrice)
            : product.price
          return { ...item, price: next ? product.cost : normalPrice }
        })
      )
      return next
    })
  }

  const addProductToSale = useCallback(function addProductToSale(product: Product, source: string) {
    if (product.isParent) {
      const variants = products.filter((p) => p.parentId === product.id)
      if (variants.length > 0) {
        setVariantPickerProduct(product)
        return
      }
    }
    const cartItem = items.find((item) => item.id === product.id)
    if (product.stock <= 0) {
      playErrorBuzz()
      setScannerStatus(`${product.name} is out of stock.`)
      return
    }
    if (cartItem && cartItem.quantity >= product.stock) {
      playErrorBuzz()
      setScannerStatus(`${product.name} reached available stock.`)
      return
    }
    addItem(product)
    playScanBlip()
    setScanCode("")
    setSearch("")
    setScannerStatus(`${product.name} added by ${source}.`)
  }, [products, items])

  function quickAddProduct(value: string) {
    const query = value.trim().toLowerCase()
    if (!query) {
      setScannerStatus("Type, scan, or choose an item first.")
      return
    }
    const barcode = value.trim().replace(/\s+/g, "")
    const exactProduct = products.find(
      (product) =>
        productHasBarcode(product, barcode) ||
        product.name.toLowerCase() === query
    )
    const matchingProducts = products.filter((product) => {
      const matchesCategory =
        selectedCategory === "All" || product.category === selectedCategory
      return matchesCategory && productMatchesSearch(product, query || barcode)
    })
    const product = exactProduct ?? matchingProducts[0]
    if (!product) {
      setScannerStatus(`No item found for ${value.trim()}.`)
      return
    }
    addProductToSale(product, exactProduct ? "barcode" : "quick add")
  }

  const toggleFavorite = useCallback(function toggleFavorite(product: Product) {
    toggleProductFavorite(product.id)
    setScannerStatus(
      product.favorite
        ? `${product.name} removed from favorites.`
        : `${product.name} added to favorites.`
    )
  }, [])

  const selectDepartment = useCallback(function selectDepartment(department: string) {
    setSelectedCategory(department)
    setSearch("")
    window.requestAnimationFrame(() => {
      productListRef.current?.scrollIntoView({
        block: "start",
        behavior: "smooth",
      })
    })
  }, [])

  const increaseQuantity = useCallback(function increaseQuantity(id: number) {
    setItems((currentItems) =>
      currentItems.map((item) =>
        item.id === id && item.quantity < item.stock
          ? { ...item, quantity: item.quantity + 1 }
          : item
      )
    )
  }, [])

  const decreaseQuantity = useCallback(function decreaseQuantity(id: number) {
    setItems((currentItems) =>
      currentItems
        .map((item) =>
          item.id === id ? { ...item, quantity: item.quantity - 1 } : item
        )
        .filter((item) => item.quantity > 0)
    )
  }, [])

  const removeItem = useCallback(function removeItem(id: number) {
    setItems((currentItems) => currentItems.filter((item) => item.id !== id))
  }, [])

  const setItemQuantity = useCallback(function setItemQuantity(id: number, qty: number) {
    setItems((currentItems) =>
      currentItems.map((item) =>
        item.id === id ? { ...item, quantity: Math.min(qty, item.stock) } : item
      ).filter((item) => item.quantity > 0)
    )
  }, [])

  const setItemPrice = useCallback(function setItemPrice(id: number, price: number) {
    setItems((currentItems) =>
      currentItems.map((item) => item.id === id ? { ...item, price } : item)
    )
  }, [])

  // --- Tender / discount ---
  function resetTender() {
    setPaidUsd("")
    setPaidLbp("")
  }

  function resetDiscount() {
    setDiscountMode("USD")
    setDiscountValue("")
  }

  function clearCart() {
    setItems([])
  }

  const fillExactTender = useCallback(function fillExactTender(currency: "USD" | "LBP") {
    if (currency === "USD") {
      setPaidUsd(payableUsd.toFixed(2))
      setPaidLbp("")
      return
    }
    setPaidLbp(String(payableLbp))
    setPaidUsd("")
  }, [payableUsd, payableLbp])

  // --- Sale lifecycle ---
  const cleanSale = useCallback(function cleanSale() {
    if (items.length === 0) {
      clearCart()
      resetTender()
      resetDiscount()
      setSearch("")
      setScanCode("")
      setIsCartOpen(false)
      setScannerStatus("Scanner ready for the next sale.")
      return
    }
    setConfirmAction({
      title: t("pos.clear_sale_title"),
      message: `${t("pos.clear_sale_message", { n: formatNumber(itemCount) })}`,
      confirmLabel: t("pos.clear"),
      onConfirm: () => {
        recordAuditEvent({
          action: "sale.void",
          entity: "sale",
          summary: `Current sale cleared before checkout with ${formatNumber(itemCount)} items.`,
          metadata: { itemCount, grossSubtotal, discountTotal },
        })
        clearCart()
        resetTender()
        resetDiscount()
        setSearch("")
        setScanCode("")
        setRecentSales([])
        setIsCartOpen(false)
        setScannerStatus("Scanner ready for the next sale.")
      },
    })
  }, [items, itemCount, grossSubtotal, discountTotal, t])

  const holdCurrentSale = useCallback(function holdCurrentSale() {
    if (items.length === 0) {
      setScannerStatus("Add items before holding a sale.")
      return
    }
    const heldSale = holdSale({
      items, paymentMethod, selectedCustomerId,
      discountMode, discountValue,
      note: selectedCustomer?.name ?? "Walk-in",
    })
    recordAuditEvent({
      action: "sale.hold",
      entity: "sale",
      summary: `${heldSale.holdNumber} held with ${formatNumber(itemCount)} items.`,
      metadata: { heldSaleId: heldSale.id, itemCount, discountTotal, total },
    })
    clearCart()
    resetTender()
    resetDiscount()
    setSelectedCustomerId(customers[0]?.id ?? "")
    setPaymentMethod("Cash")
    setIsCartOpen(false)
    setScannerStatus(`${heldSale.holdNumber} held.`)
  }, [items, itemCount, discountTotal, total, paymentMethod, selectedCustomerId, discountMode, discountValue, selectedCustomer, customers])

  const resumeHeldSale = useCallback(function resumeHeldSale(heldSale: HeldSale) {
    if (items.length > 0) {
      setScannerStatus("Hold or clear the current sale before resuming another.")
      return
    }
    setItems(heldSale.items)
    setPaymentMethod(heldSale.paymentMethod)
    setSelectedCustomerId(heldSale.selectedCustomerId)
    setDiscountMode(heldSale.discountMode)
    setDiscountValue(heldSale.discountValue)
    resetTender()
    removeHeldSale(heldSale.id)
    recordAuditEvent({
      action: "sale.resume",
      entity: "sale",
      summary: `${heldSale.holdNumber} resumed.`,
      metadata: { heldSaleId: heldSale.id },
    })
    setIsCartOpen(true)
    setScannerStatus(`${heldSale.holdNumber} resumed.`)
  }, [items])

  const discardHeldSale = useCallback(function discardHeldSale(heldSale: HeldSale) {
    setConfirmAction({
      title: "Discard held sale",
      message: `Discard ${heldSale.holdNumber}? This cannot be undone.`,
      confirmLabel: "Discard",
      confirmDestructive: true,
      onConfirm: () => {
        removeHeldSale(heldSale.id)
        recordAuditEvent({
          action: "sale.hold.discard",
          entity: "sale",
          summary: `${heldSale.holdNumber} was discarded.`,
          metadata: { heldSaleId: heldSale.id },
        })
        setScannerStatus(`${heldSale.holdNumber} discarded.`)
      },
    })
  }, [])

  function handleReview() {
    if (checkoutBlocked) return
    setShowReview(true)
  }

  const completeSale = useCallback(async function completeSale() {
    if (checkoutBlocked || isValidatingStock) return

    // Preflight: this device's local product/batch cache can be stale even
    // on the hub itself — another connected device's sale (or the hub's own
    // background cloud-bridge pull) can change real stock/batch data before
    // this screen's own cache catches up, since the renderer's view is its
    // own cached copy, not a live query. Originally this only ran for
    // CONNECT_TO_HUB, on the assumption the hub is always self-consistent —
    // live testing (POS-SYNC-TORTURE-1 follow-up) showed that assumption
    // was incomplete: the hub's own checkout hit the identical stale-cart
    // race. Runs for both modes now; for STORE_HUB this is a same-machine
    // round trip to its own local API, not a real network hop.
    if (getConnectionMode() === "CONNECT_TO_HUB" || getConnectionMode() === "STORE_HUB") {
      setIsValidatingStock(true)
      setScannerStatus("Verifying stock with hub…")
      try {
        const validation = await validateStockWithHub(
          items.map((item) => ({ productId: item.id, quantity: item.quantity }))
        )
        if (!validation.ok) {
          if (validation.reason === "unreachable") {
            setScannerStatus("⚠️ Cannot verify stock — hub unreachable. Sale blocked to prevent stock conflicts.")
          } else {
            const names = validation.insufficientItems?.map((i) => i.name).join(", ") ?? "one or more items"
            setScannerStatus(`⚠️ Stock changed on another register. Refresh cart. (${names})`)
          }
          playErrorBuzz()
          pullFromServer().catch(() => {}) // refresh so the cart/grid reflects real numbers
          return
        }
      } finally {
        setIsValidatingStock(false)
      }
    }

    const saleNumber = `S-${Date.now().toString().slice(-6)}${Math.floor(Math.random() * 90 + 10)}`

    let batchesConsumed = false
    let recordedSaleId: string | undefined
    let stockDecreased = false

    try {
      const batchAllocations = consumeInventoryBatches(
        items.map((item) => ({
          productId: item.id, productName: item.name, barcode: item.barcode,
          quantity: item.quantity, fallbackUnitCost: item.cost,
        }))
      )
      batchesConsumed = true

      const saleItems = items.map((item) => {
        const allocations = batchAllocations.get(item.id) ?? []
        const allocatedQuantity = allocations.reduce((sum, a) => sum + a.quantity, 0)
        const allocatedCost = allocations.reduce((sum, a) => sum + a.unitCost * a.quantity, 0)
        const unitCost = allocatedQuantity > 0 ? allocatedCost / allocatedQuantity : item.cost
        return {
          id: item.id, name: item.name, barcode: item.barcode, cost: unitCost,
          quantity: item.quantity, unitPrice: item.price,
          total: item.price * item.quantity, batchAllocations: allocations,
        }
      })
      const tender: SaleTender | undefined =
        paymentMethod === "Cash"
          ? {
              currency: tenderMode, exchangeRate,
              paidUsd: paidUsdAmount, paidLbp: paidLbpAmount,
              paidTotalUsd, paidTotalLbp,
              changeUsd: cashChangeUsd, changeLbp: cashChangeLbp,
              changeCurrency: tenderMode === "LBP" ? "LBP" : "USD",
            }
          : undefined
      const customerBalanceBefore = selectedCustomer?.balance ?? 0
      const customerBalanceAfter =
        paymentMethod === "Debt" ? customerBalanceBefore + total : undefined

      const saleResult = recordSale({
        saleNumber, paymentMethod,
        customerId: selectedCustomer?.id, customerName: selectedCustomer?.name,
        subtotal, discountTotal, tax, total, soldAtCost: sellAtCost, tender,
        payableLbp: paymentMethod === "Cash" ? payableLbp : undefined,
        items: saleItems,
      })
      recordedSaleId = saleResult.id

      if (discountTotal > 0) {
        recordAuditEvent({
          action: "sale.discount", entity: "sale",
          summary: `${saleNumber} received a ${formatCurrency(discountTotal)} discount.`,
          metadata: { saleNumber, grossSubtotal, discountMode, discountValue, discountTotal },
        })
      }

      if (paymentMethod === "Debt" && selectedCustomer) {
        recordDebtSale({
          customerId: selectedCustomer.id, saleNumber,
          subtotal, discountTotal, tax, total, items: saleItems,
        })
      }

      decreaseProductStock(
        items.map((item) => ({ productId: item.id, quantity: item.quantity }))
      )
      stockDecreased = true

      const saleRecord = {
        number: saleNumber, paymentMethod, customerName: selectedCustomer?.name,
        grossSubtotal, subtotal, discountTotal, tax, total, totalLbp, exchangeRate,
        payableLbp, payableUsd,
        tender,
        customerBalanceBefore: paymentMethod === "Debt" ? customerBalanceBefore : undefined,
        customerBalanceAfter, items,
      }
      setLastSale(saleRecord)
      setRecentSales((prev) => [saleRecord, ...prev].slice(0, 2))
      clearCart()
      resetTender()
      resetDiscount()
      setScanCode("")
      setSearch("")
      setSaleNote("")
      setIsCartOpen(false)
      setScannerStatus("Sale completed. Scanner ready for the next sale.")
    } catch (err) {
      // Reverse completed steps — cart is preserved so user can retry
      if (recordedSaleId) {
        voidSale(recordedSaleId, stockDecreased)
      } else {
        // Sale was NOT recorded — manually restore what was consumed
        if (stockDecreased) {
          increaseProductStock(
            items.map((item) => ({ productId: item.id, quantity: item.quantity }))
          )
        }
        if (batchesConsumed) {
          restoreInventoryBatches(
            items.map((item) => ({
              productId: item.id, productName: item.name, barcode: item.barcode,
              quantity: item.quantity, fallbackUnitCost: item.cost,
            }))
          )
        }
      }
      setScannerStatus(`Checkout failed. Cart preserved, try again.`)
    }
  }, [checkoutBlocked, isValidatingStock, items, settings, paymentMethod, tenderMode, paidUsd, paidLbp, discountMode, discountValue, selectedCustomer, customers, selectedCustomerId, exchangeRate, paidUsdAmount, paidLbpAmount, paidTotalUsd, paidTotalLbp, cashChangeUsd, cashChangeLbp, subtotal, discountTotal, tax, total, totalLbp, grossSubtotal])

  return (
    <main className="pos-workspace relative min-h-0 flex-1 overflow-hidden">
      {/* Desktop: flex row with products + cart rail. Mobile: single column */}
      <div className="flex h-full min-h-0">
        {/* ── Left: Product area ── */}
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <section className="flex h-full min-w-0 flex-col gap-3 overflow-hidden p-3 pb-24 sm:p-4 md:pb-4 xl:p-5">
            <SyncBanner />
            <LastSaleBanner
              sales={recentSales}
              onNewSale={cleanSale}
              onPrintReceipt={(s) => printLastSaleReceipt(s, settings)}
              onWhatsApp={(s) => {
                openWhatsAppShare(receiptMessage({
                  storeName: settings.storeName,
                  saleNumber: s.number,
                  total: s.total,
                  totalLbp: s.totalLbp,
                  items: (s.items ?? []).map((i: any) => ({ name: i.name, quantity: i.quantity, total: i.price * i.quantity })),
                  footer: settings.receiptFooter,
                }))
              }}
            />

            {quickMode ? (
              <QuickPOSMode
                scanInputRef={scanInputRef}
                scanCode={scanCode}
                onScanCodeChange={setScanCode}
                onQuickAdd={quickAddProduct}
                scannerStatus={scannerStatus}
                cameraActive={cameraActive}
                cameraEngine={cameraEngine}
                onStartCamera={startCameraScanner}
                videoRef={videoRef}
                scanCaptureInputRef={scanCaptureInputRef}
                onScanCapture={handleScanCapture}
                items={items}
                onIncreaseQty={increaseQuantity}
                onDecreaseQty={decreaseQuantity}
                onRemoveItem={removeItem}
                onCleanSale={cleanSale}
                onExit={() => setQuickMode(false)}
                itemCount={itemCount}
                total={total}
                totalLbp={totalLbp}
                exchangeRate={exchangeRate}
                paymentMethod={paymentMethod}
                onSelectPayment={setPaymentMethod}
                paidUsd={paidUsd}
                paidLbp={paidLbp}
                onPaidUsdChange={setPaidUsd}
                onPaidLbpChange={setPaidLbp}
                onFillExactTender={fillExactTender}
                customers={customers}
                selectedCustomerId={selectedCustomerId}
                onSelectCustomer={setSelectedCustomerId}
                selectedCustomer={selectedCustomer}
                creditLimitExceeded={creditLimitExceeded}
                paidTotalUsd={paidTotalUsd}
                paidTotalLbp={paidTotalLbp}
                cashChangeUsd={cashChangeUsd}
                cashChangeLbp={cashChangeLbp}
                cashStillDueUsd={cashStillDueUsd}
                cashTenderValid={cashTenderValid}
                checkoutBlocked={checkoutBlocked}
          onCompleteSale={completeSale}
                recentSales={recentSales}
                onPrintReceipt={(s) => printLastSaleReceipt(s, settings)}
                onWhatsAppReceipt={(s) => {
                  openWhatsAppShare(receiptMessage({
                    storeName: settings.storeName,
                    saleNumber: s.number,
                    total: s.total,
                    totalLbp: s.totalLbp,
                  items: (s.items ?? []).map((i: any) => ({ name: i.name, quantity: i.quantity, total: i.price * i.quantity })),
                    footer: settings.receiptFooter,
                  }))
                }}
                sellAtCost={sellAtCost}
                onToggleSellAtCost={toggleSellAtCost}
                saleNote={saleNote}
                onSaleNoteChange={setSaleNote}
                discountMode={discountMode}
                discountValue={discountValue}
                onDiscountModeChange={setDiscountMode}
                onDiscountValueChange={setDiscountValue}
                hasDiscount={hasDiscount}
                canApplyDiscount={canApplyDiscount}
                discountTotal={discountTotal}
                grossSubtotal={grossSubtotal}
              />
            ) : (
              <>
                <SearchToolbar
                  scanInputRef={scanInputRef}
                  scanCode={scanCode}
                  onScanCodeChange={setScanCode}
                  onQuickAdd={quickAddProduct}
                  scannerStatus={scannerStatus}
                  cameraActive={cameraActive}
                  cameraEngine={cameraEngine}
                  filteredProductsCount={filteredProducts.length}
                  itemCount={itemCount}
                  exchangeRate={exchangeRate}
                  onStartCamera={startCameraScanner}
                  onCleanSale={cleanSale}
                  onCartOpen={() => setIsCartOpen(true)}
                  videoRef={videoRef}
                  scanCaptureInputRef={scanCaptureInputRef}
                  onScanCapture={handleScanCapture}
                  quickMode={quickMode}
                  onToggleQuickMode={() => setQuickMode(true)}
                  onShowShortcuts={() => setShortcutsOpen(true)}
                />

                <DepartmentTabs
                  departments={departmentSummaries}
                  selected={selectedCategory}
                  onSelect={selectDepartment}
                />

                <FavoritesBar
                  products={products}
                  selectedCategory={selectedCategory}
                  onAddToCart={(p) => addProductToSale(p, "favorites")}
                />

                <div
                  ref={productListRef}
                  className="min-h-0 flex-1 overflow-y-auto"
                >
                  <ErrorBoundary fallbackLabel="Failed to load products">
                  {isLoading ? (
                    <ProductSkeletonGrid count={12} />
                  ) : filteredProducts.length > 0 ? (
                    <ProductGrid
                      products={filteredProducts}
                      exchangeRate={exchangeRate}
                      onAddProduct={addProductToSale}
                      onToggleFavorite={toggleFavorite}
                      wholesale={!!(selectedCustomer?.isWholesale)}
                      cartQuantities={cartQuantities}
                      searchQuery={debouncedSearch}
                    />
                  ) : (
                    <EmptyState
                      icon={PackageSearch}
                      title={t("pos.no_products")}
                      description={t("pos.try_another")}
                      className="min-h-80 bg-white"
                    />
                  )}
                    </ErrorBoundary>
                </div>

                {/* Keyboard shortcuts reference strip — desktop only */}
                <div className="hidden md:flex flex-wrap gap-1.5 p-2 mt-auto" style={{ background: "var(--surface-2)", borderRadius: "var(--radius-lg)", border: "1px solid var(--border)" }}>
                  <span className="flex items-center gap-1 text-[10px] font-bold" style={{ color: "var(--text-3)" }}>
                    <span className="rounded bg-black/5 px-1.5 py-0.5 font-mono">Ctrl+F</span>
                    Search
                  </span>
                  <span className="flex items-center gap-1 text-[10px] font-bold" style={{ color: "var(--text-3)" }}>
                    <span className="rounded bg-black/5 px-1.5 py-0.5 font-mono">F8</span>
                    Cart
                  </span>
                  <span className="flex items-center gap-1 text-[10px] font-bold" style={{ color: "var(--text-3)" }}>
                    <span className="rounded bg-black/5 px-1.5 py-0.5 font-mono">Esc</span>
                    Close
                  </span>
                  <span className="flex items-center gap-1 text-[10px] font-bold" style={{ color: "var(--text-3)" }}>
                    <span className="rounded bg-black/5 px-1.5 py-0.5 font-mono">?</span>
                    Help
                  </span>
                </div>
              </>
            )}
          </section>

          {/* ── Mobile floating cart button ── */}
          <button
            type="button"
            onClick={() => setIsCartOpen(true)}
            className={`lg:hidden fixed bottom-20 left-3 right-3 z-30 flex items-center justify-between gap-3 rounded-xl shadow-2xl transition active:scale-[0.98] md:bottom-6 md:left-auto md:right-5 md:min-w-64 md:max-w-sm`}
            style={{
              background: "var(--sidebar-bg)",
              border: "1px solid var(--sidebar-border)",
              color: "var(--sidebar-text)",
              padding: "12px 16px",
              paddingBottom: "max(12px, calc(env(safe-area-inset-bottom) + 4px))",
            }}
          >
            <span className="flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-500 text-white">
                <ShoppingCart size={22} />
              </span>
              <span>
                <span className="block text-sm font-semibold text-zinc-300">
                  {t("pos.cart_checkout")}
                </span>
                <span className="block text-xl font-bold">
                  {formatCurrency(total)}
                </span>
              </span>
            </span>
            <span className="flex shrink-0 items-center gap-2">
              {heldSales.length > 0 ? (
                <span className="rounded-full bg-sky-100 px-3 py-1 text-xs font-bold text-sky-900">
                  {t("pos.held_count", { n: formatNumber(heldSales.length) })}
                </span>
              ) : null}
              <span className="rounded-full bg-white px-3 py-1 text-sm font-bold text-zinc-950">
                {formatNumber(itemCount)}
              </span>
            </span>
          </button>
        </div>

        {/* ── Right: Persistent cart rail (desktop only) ── */}
        <CartPanel
          quickMode={quickMode}
          items={items}
          onIncreaseQty={increaseQuantity}
          onDecreaseQty={decreaseQuantity}
          onRemoveItem={removeItem}
          onSetQuantity={setItemQuantity}
          onSetPrice={setItemPrice}
          saleNote={saleNote}
          onSaleNoteChange={setSaleNote}
          heldSales={heldSales}
          onResumeHeld={resumeHeldSale}
          onDiscardHeld={discardHeldSale}
          vatRate={settings.vatRate}
          customers={customers}
          selectedCustomerId={selectedCustomerId}
          onSelectCustomer={setSelectedCustomerId}
          selectedCustomer={selectedCustomer}
          paymentMethod={paymentMethod}
          onSelectPayment={setPaymentMethod}
          paidUsd={paidUsd}
          paidLbp={paidLbp}
          onPaidUsdChange={setPaidUsd}
          onPaidLbpChange={setPaidLbp}
          onFillExactTender={fillExactTender}
          discountMode={discountMode}
          discountValue={discountValue}
          onDiscountModeChange={setDiscountMode}
          onDiscountValueChange={setDiscountValue}
          onHold={holdCurrentSale}
          onClean={cleanSale}
          onCompleteSale={handleReview}
          itemCount={itemCount}
          grossSubtotal={grossSubtotal}
          discountTotal={discountTotal}
          subtotal={subtotal}
          tax={tax}
          total={total}
          totalLbp={totalLbp}
          exchangeRate={exchangeRate}
          paidTotalUsd={paidTotalUsd}
          paidTotalLbp={paidTotalLbp}
          cashChangeUsd={cashChangeUsd}
          cashChangeLbp={cashChangeLbp}
          cashStillDueUsd={cashStillDueUsd}
          cashTenderValid={cashTenderValid}
          creditLimitExceeded={creditLimitExceeded}
          checkoutBlocked={checkoutBlocked}
          hasDiscount={hasDiscount}
          canApplyDiscount={canApplyDiscount}
          sellAtCost={sellAtCost}
          onToggleSellAtCost={toggleSellAtCost}
        />
      </div>

      {/* ── CartDrawer (mobile drawer, hidden on desktop) ── */}
      <div className="lg:hidden">
        <CartDrawer
          isOpen={isCartOpen}
          onClose={() => setIsCartOpen(false)}
          items={items}
          onIncreaseQty={increaseQuantity}
          onDecreaseQty={decreaseQuantity}
          onRemoveItem={removeItem}
          onSetQuantity={setItemQuantity}
          onSetPrice={setItemPrice}
          saleNote={saleNote}
          onSaleNoteChange={setSaleNote}
          heldSales={heldSales}
          onResumeHeld={resumeHeldSale}
          onDiscardHeld={discardHeldSale}
          vatRate={settings.vatRate}
          customers={customers}
          selectedCustomerId={selectedCustomerId}
          onSelectCustomer={setSelectedCustomerId}
          selectedCustomer={selectedCustomer}
          paymentMethod={paymentMethod}
          onSelectPayment={setPaymentMethod}
          paidUsd={paidUsd}
          paidLbp={paidLbp}
          onPaidUsdChange={setPaidUsd}
          onPaidLbpChange={setPaidLbp}
          onFillExactTender={fillExactTender}
          discountMode={discountMode}
          discountValue={discountValue}
          onDiscountModeChange={setDiscountMode}
          onDiscountValueChange={setDiscountValue}
          onHold={holdCurrentSale}
          onClean={cleanSale}
          onCompleteSale={handleReview}
          itemCount={itemCount}
          grossSubtotal={grossSubtotal}
          discountTotal={discountTotal}
          subtotal={subtotal}
          tax={tax}
          total={total}
          totalLbp={totalLbp}
          exchangeRate={exchangeRate}
          paidTotalUsd={paidTotalUsd}
          paidTotalLbp={paidTotalLbp}
          cashChangeUsd={cashChangeUsd}
          cashChangeLbp={cashChangeLbp}
          cashStillDueUsd={cashStillDueUsd}
          cashTenderValid={cashTenderValid}
          creditLimitExceeded={creditLimitExceeded}
          checkoutBlocked={checkoutBlocked}
          hasDiscount={hasDiscount}
          canApplyDiscount={canApplyDiscount}
          sellAtCost={sellAtCost}
          onToggleSellAtCost={toggleSellAtCost}
        />
      </div>

      {confirmAction && (
        <ConfirmDialog
          open={!!confirmAction}
          title={confirmAction.title}
          confirmLabel={confirmAction.confirmLabel}
          confirmDestructive={confirmAction.confirmDestructive}
          onConfirm={() => {
            confirmAction.onConfirm()
            setConfirmAction(null)
          }}
          onCancel={() => setConfirmAction(null)}
        >
          <p>{confirmAction.message}</p>
        </ConfirmDialog>
      )}

      {variantPickerProduct ? (
        <VariantPicker
          product={variantPickerProduct}
          products={products}
          onSelectVariant={addProductToSale}
          onClose={() => setVariantPickerProduct(null)}
        />
      ) : null}

      <KeyboardShortcutsModal open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />

      {showReview && (
        <section className="fixed inset-0 z-[200] flex items-center justify-center p-4"
          style={{ background: "rgba(5,7,13,0.92)", backdropFilter: "blur(16px)" }}
          onKeyDown={(e) => { if (e.key === "Escape") { e.preventDefault(); setShowReview(false) }; if (e.key === "Enter" && !checkoutBlocked) { e.preventDefault(); setShowReview(false); completeSale() }}}
          tabIndex={0}>
          <div className="w-full max-w-md rounded-3xl overflow-hidden"
            style={{ background: "var(--surface)", border: "1px solid var(--border)", boxShadow: "0 20px 60px rgba(0,0,0,0.3)" }}>
            <div className="px-5 py-4 border-b" style={{ borderColor: "var(--border)" }}>
              <h2 className="text-base font-bold" style={{ color: "var(--text)" }}>Confirm Sale</h2>
            </div>
            <div className="px-5 py-4 space-y-3">
              {checkoutBlocked && (
                <div className="rounded-xl p-3 text-[12px] font-bold" style={{ background: "var(--rose-soft)", color: "var(--rose-text)" }}>
                  {items.length === 0 ? "Add items to the cart first." :
                   paymentMethod === "Cash" && !cashTenderValid ? `Insufficient payment — still due ${formatCurrency(cashStillDueUsd)}` :
                   paymentMethod === "Debt" && !selectedCustomer ? "Select a customer for debt sale." :
                   creditLimitExceeded ? `Credit limit exceeded` : "Cannot complete sale."}
                </div>
              )}
              {items.length > 0 && (
                <div className="max-h-[35vh] overflow-y-auto divide-y -mx-5 -mt-3 mb-3" style={{ borderColor: "var(--border)", background: "var(--surface-2)" }}>
                  {items.map((item, i) => (
                    <div key={item.id} className="flex items-center gap-3 px-5 py-2.5"
                      style={{ background: i % 2 === 0 ? "var(--surface)" : "var(--surface-2)" }}>
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[11px] font-black"
                        style={{ background: "var(--surface-3)", color: "var(--text-3)" }}>
                        {item.quantity}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-[13px] font-bold" style={{ color: "var(--text)" }}>
                        {item.name}
                      </span>
                      <span className="shrink-0 text-[12px] font-semibold tabular-nums" style={{ color: "var(--text-2)" }}>
                        @{formatCurrency(item.price)}
                      </span>
                      <span className="shrink-0 w-16 text-right text-[14px] font-black tabular-nums" style={{ color: "var(--text)" }}>
                        {formatCurrency(item.price * item.quantity)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
              <div className="flex items-end justify-between">
                <span className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: "var(--text-3)" }}>Total</span>
                <div className="text-end">
                  <div className="text-[32px] font-bold tabular-nums" style={{ color: "var(--text)" }}>{formatCurrency(total)}</div>
                  <div className="text-[12px] font-semibold tabular-nums mt-0.5" style={{ color: "var(--text-3)" }}>{formatLbpCurrency(totalLbp)}</div>
                </div>
              </div>
              {paymentMethod === "Cash" && payableLbp !== totalLbp && (
                <div className="rounded-xl p-3 space-y-1" style={{ background: "var(--surface-2)", border: "1px solid var(--border)" }}>
                  <div className="flex justify-between text-[11px] font-semibold">
                    <span style={{ color: "var(--text-3)" }}>Cash rounding</span>
                    <span className="tabular-nums" style={{ color: "var(--brand-text)" }}>+{formatLbpCurrency(payableLbp - totalLbp)}</span>
                  </div>
                  <div className="flex justify-between text-[12px] font-bold">
                    <span style={{ color: "var(--text-2)" }}>Cash payable</span>
                    <span className="tabular-nums" style={{ color: "var(--text)" }}>{formatLbpCurrency(payableLbp)}</span>
                  </div>
                </div>
              )}
              {cashTenderValid && cashChangeUsd > 0 && (
                <div className="rounded-xl p-3 text-center" style={{ background: "rgba(34,197,94,0.10)", border: "1px solid rgba(34,197,94,0.25)" }}>
                  <span className="text-[11px] font-bold uppercase" style={{ color: "var(--success)" }}>Change</span>
                  <div className="text-[28px] font-bold tabular-nums mt-1" style={{ color: "var(--success)" }}>{formatCurrency(cashChangeUsd)}</div>
                </div>
              )}
            </div>
            <div className="px-5 py-4 flex gap-3 border-t" style={{ borderColor: "var(--border)", background: "var(--surface-2)" }}>
              <button type="button" onClick={() => setShowReview(false)} className="flex-1 h-12 rounded-xl text-[13px] font-bold"
                style={{ border: "1px solid var(--border)", color: "var(--text-2)", background: "var(--surface)" }}>Back</button>
              <button type="button" onClick={() => { setShowReview(false); completeSale() }} disabled={checkoutBlocked}
                className="flex-[2.5] h-12 rounded-xl text-[15px] font-bold disabled:opacity-40"
                style={{ background: "var(--brand)", color: "var(--brand-contrast)" }}>Confirm — Pay {formatCurrency(total)}</button>
            </div>
          </div>
        </section>
      )}

      <SaleCompleteOverlay sale={lastSale}
        onViewReceipt={() => lastSale && printLastSaleReceipt(lastSale, settings)}
      />

    </main>
  )
}

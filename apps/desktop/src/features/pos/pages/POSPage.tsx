import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useDebounce } from "../../../hooks/useDebounce"
import { useHotkeys } from "../../../hooks/useHotkey"
import { useI18n } from "@lebanonpos/shared"
import { PackageSearch, ShoppingCart } from "lucide-react"

import ConfirmDialog from "../../../components/ConfirmDialog"
import Spinner from "../../../components/ui/Spinner"
import EmptyState from "../../../components/ui/EmptyState"
import ProductGrid from "../components/ProductGrid"
import SearchToolbar from "../components/SearchToolbar"
import DepartmentTabs from "../components/DepartmentTabs"
import LastSaleBanner from "../components/LastSaleBanner"
import CartDrawer from "../components/CartDrawer"
import VariantPicker from "../components/VariantPicker"
import SimplePOSMode from "../components/SimplePOSMode"
import { StaleRateBanner } from "../components/RateManager"
import { openWhatsAppShare, receiptMessage } from "../lib/whatsapp"
import {
  formatCurrency,
  formatNumber,
  lbpToUsd,
  usdToLbp,
} from "../lib/currency"
import {
  getHeldSaleItemCount,
  parseMoney,
} from "../lib/helpers"
import { departmentIcons } from "../lib/pos.constants"
import { printLastSaleReceipt, type LastSaleSummary } from "../lib/printReceipt"
import {
  productHasBarcode,
  productMatchesSearch,
  toggleProductFavorite,
} from "../services/product.service"
import { decreaseProductStock } from "../services/product.service"
import { recordSale, type SaleTender } from "../services/sales.service"
import {
  holdSale,
  removeHeldSale,
  type HeldSale,
} from "../services/heldSale.service"
import { recordDebtSale } from "../services/customer.service"
import { recordAuditEvent, userCan } from "../services/security.service"
import { consumeInventoryBatches } from "../services/inventoryBatch.service"
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
  const [tenderMode, setTenderMode] = useState<TenderMode>("USD")
  const [paidUsd, setPaidUsd] = useState("")
  const [paidLbp, setPaidLbp] = useState("")
  const [discountMode, setDiscountMode] = useState<DiscountMode>("USD")
  const [discountValue, setDiscountValue] = useState("")
  const [lastSale, setLastSale] = useState<LastSaleSummary | null>(null)
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
  const [simpleMode, setSimpleMode] = useState(false)

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
      handler: () => { if (isCartOpen) setIsCartOpen(false) },
    },
  ])

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

  const selectedDepartment =
    departmentSummaries.find(
      (department) => department.name === selectedCategory
    ) ?? departmentSummaries[0]

  const canApplyDiscount = userCan("sales.discount")
  const grossSubtotal = items.reduce(
    (sum, item) => sum + item.price * item.quantity, 0
  )
  const parsedDiscountValue = parseMoney(discountValue)
  const discountTotal = canApplyDiscount
    ? Math.min(
        grossSubtotal,
        discountMode === "Percent"
          ? grossSubtotal * (Math.min(100, parsedDiscountValue) / 100)
          : parsedDiscountValue
      )
    : 0
  const subtotal = Math.max(0, grossSubtotal - discountTotal)
  const tax = subtotal * settings.vatRate
  const total = subtotal + tax
  const exchangeRate = Math.max(1, settings.usdToLbpRate)
  const totalLbp = usdToLbp(total, exchangeRate)
  const itemCount = items.reduce((sum, item) => sum + item.quantity, 0)
  const selectedCustomer = customers.find(
    (customer) => customer.id === selectedCustomerId
  )
  const hasDiscount = discountTotal > 0
  const heldSalesItemCount = heldSales.reduce(
    (sum, heldSale) => sum + getHeldSaleItemCount(heldSale), 0
  )
  const paidUsdAmount = tenderMode === "LBP" ? 0 : parseMoney(paidUsd)
  const paidLbpAmount = tenderMode === "USD" ? 0 : parseMoney(paidLbp)
  const paidTotalUsd = paidUsdAmount + lbpToUsd(paidLbpAmount, exchangeRate)
  const paidTotalLbp = usdToLbp(paidTotalUsd, exchangeRate)
  const cashStillDueUsd = Math.max(0, total - paidTotalUsd)
  const cashChangeUsd = Math.max(0, paidTotalUsd - total)
  const cashChangeLbp = usdToLbp(cashChangeUsd, exchangeRate)
  const cashTenderValid =
    paymentMethod !== "Cash" || items.length === 0 || paidTotalUsd + 0.005 >= total
  const creditLimitExceeded = Boolean(
    paymentMethod === "Debt" &&
      selectedCustomer &&
      selectedCustomer.creditLimit > 0 &&
      selectedCustomer.balance + total > selectedCustomer.creditLimit
  )
  const checkoutBlocked =
    items.length === 0 ||
    (paymentMethod === "Cash" && !cashTenderValid) ||
    (paymentMethod === "Debt" && (!selectedCustomer || creditLimitExceeded))

  // --- Cart operations ---
  function addItem(product: Product) {
    if (product.stock <= 0) return
    setItems((currentItems) => {
      const existingItem = currentItems.find((item) => item.id === product.id)
      if (existingItem) {
        if (existingItem.quantity >= product.stock) return currentItems
        return currentItems.map((item) =>
          item.id === product.id
            ? { ...item, quantity: item.quantity + 1 }
            : item
        )
      }
      return [...currentItems, { ...product, quantity: 1 }]
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
      setScannerStatus(`${product.name} is out of stock.`)
      return
    }
    if (cartItem && cartItem.quantity >= product.stock) {
      setScannerStatus(`${product.name} reached available stock.`)
      return
    }
    addItem(product)
    setScanCode("")
    setSearch("")
    setLastSale(null)
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
    setTenderMode("USD")
  }

  function resetDiscount() {
    setDiscountMode("USD")
    setDiscountValue("")
  }

  function clearCart() {
    setItems([])
  }

  const selectTenderMode = useCallback(function selectTenderMode(mode: TenderMode) {
    setTenderMode(mode)
    if (mode === "USD") setPaidLbp("")
    if (mode === "LBP") setPaidUsd("")
  }, [])

  const fillExactTender = useCallback(function fillExactTender(currency: "USD" | "LBP") {
    if (currency === "USD") {
      setTenderMode("USD")
      setPaidUsd(total.toFixed(2))
      setPaidLbp("")
      return
    }
    setTenderMode("LBP")
    setPaidUsd("")
    setPaidLbp(String(Math.round(totalLbp)))
  }, [total, totalLbp])

  // --- Sale lifecycle ---
  const cleanSale = useCallback(function cleanSale() {
    if (items.length === 0) {
      clearCart()
      resetTender()
      resetDiscount()
      setSearch("")
      setScanCode("")
      setLastSale(null)
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
        setLastSale(null)
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

  const completeSale = useCallback(function completeSale() {
    if (checkoutBlocked) return

    const saleNumber = `S-${Date.now().toString().slice(-6)}`
    const batchAllocations = consumeInventoryBatches(
      items.map((item) => ({
        productId: item.id, productName: item.name, barcode: item.barcode,
        quantity: item.quantity, fallbackUnitCost: item.cost,
      }))
    )
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

    recordSale({
      saleNumber, paymentMethod,
      customerId: selectedCustomer?.id, customerName: selectedCustomer?.name,
      subtotal, discountTotal, tax, total, tender, items: saleItems,
    })

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

    setLastSale({
      number: saleNumber, paymentMethod, customerName: selectedCustomer?.name,
      grossSubtotal, subtotal, discountTotal, tax, total, totalLbp, exchangeRate,
      tender,
      customerBalanceBefore: paymentMethod === "Debt" ? customerBalanceBefore : undefined,
      customerBalanceAfter, items,
    })
    clearCart()
    resetTender()
    resetDiscount()
    setScanCode("")
    setSearch("")
    setSaleNote("")
    setIsCartOpen(false)
    setScannerStatus("Sale completed. Scanner ready for the next sale.")
  }, [checkoutBlocked, items, settings, paymentMethod, tenderMode, paidUsd, paidLbp, discountMode, discountValue, selectedCustomer, customers, selectedCustomerId])

  const completeSimpleSale = useCallback(function completeSimpleSale(
    method: "Cash" | "Card" | "Wallet",
    paidUsdInput: number
  ): string | null {
    if (items.length === 0) return null
    const simpleSubtotal = items.reduce((sum, item) => sum + item.price * item.quantity, 0)
    const simpleTax = simpleSubtotal * settings.vatRate
    const simpleTotal = simpleSubtotal + simpleTax
    const rate = Math.max(1, settings.usdToLbpRate)
    const simpleTotalLbp = usdToLbp(simpleTotal, rate)
    if (method === "Cash" && paidUsdInput + 0.005 < simpleTotal) return null

    const saleNumber = `S-${Date.now().toString().slice(-6)}`
    const batchAllocations = consumeInventoryBatches(
      items.map((item) => ({ productId: item.id, productName: item.name, barcode: item.barcode, quantity: item.quantity, fallbackUnitCost: item.cost }))
    )
    const saleItems = items.map((item) => {
      const allocations = batchAllocations.get(item.id) ?? []
      const allocatedQuantity = allocations.reduce((s, a) => s + a.quantity, 0)
      const allocatedCost = allocations.reduce((s, a) => s + a.unitCost * a.quantity, 0)
      const unitCost = allocatedQuantity > 0 ? allocatedCost / allocatedQuantity : item.cost
      return { id: item.id, name: item.name, barcode: item.barcode, cost: unitCost, quantity: item.quantity, unitPrice: item.price, total: item.price * item.quantity, batchAllocations: allocations }
    })

    const changeUsd = method === "Cash" ? Math.max(0, paidUsdInput - simpleTotal) : 0
    const tender: SaleTender | undefined = method === "Cash" ? {
      currency: "USD", exchangeRate: rate,
      paidUsd: paidUsdInput, paidLbp: 0, paidTotalUsd: paidUsdInput,
      paidTotalLbp: usdToLbp(paidUsdInput, rate),
      changeUsd, changeLbp: usdToLbp(changeUsd, rate),
      changeCurrency: "USD",
    } : undefined

    recordSale({
      saleNumber, paymentMethod: method,
      subtotal: simpleSubtotal, discountTotal: 0, tax: simpleTax,
      total: simpleTotal, tender, items: saleItems,
    })

    decreaseProductStock(items.map((item) => ({ productId: item.id, quantity: item.quantity })))
    setLastSale({
      number: saleNumber, paymentMethod: method, customerName: undefined,
      grossSubtotal: simpleSubtotal, subtotal: simpleSubtotal, discountTotal: 0,
      tax: simpleTax, total: simpleTotal, totalLbp: simpleTotalLbp, exchangeRate: rate,
      tender, customerBalanceBefore: undefined, customerBalanceAfter: undefined, items,
    })
    clearCart()
    return saleNumber
  }, [items, settings])

  return (
    <main className="relative min-h-0 flex-1 overflow-hidden bg-page">
      <section className="flex h-full min-w-0 flex-col gap-3 overflow-y-auto p-3 pb-28 sm:p-4 xl:p-5">
        <StaleRateBanner />
        <LastSaleBanner
          sale={lastSale}
          onNewSale={cleanSale}
          onPrintReceipt={() => lastSale && printLastSaleReceipt(lastSale, settings)}
          onWhatsApp={() => {
            if (!lastSale) return
            openWhatsAppShare(receiptMessage({
              storeName: settings.storeName,
              saleNumber: lastSale.number,
              total: lastSale.total,
              totalLbp: lastSale.totalLbp,
              items: lastSale.items.map((i) => ({ name: i.name, quantity: i.quantity, total: i.price * i.quantity })),
              footer: settings.receiptFooter,
            }))
          }}
        />

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
        />

        <DepartmentTabs
          departments={departmentSummaries}
          selected={selectedCategory}
          onSelect={selectDepartment}
        />

        <div
          ref={productListRef}
          className="flex scroll-mt-5 items-center justify-between"
        >
          <div>
            <h3 className="text-xl font-bold" style={{ color: "var(--text)" }}>
              {selectedDepartment?.label ?? t("pos.quick_sale")}
            </h3>
            <p className="text-sm" style={{ color: "var(--text-3)" }}>
              {t("pos.tap_hint")}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setSimpleMode(true)}
            className="flex items-center gap-2 rounded-xl border px-4 h-9 text-[13px] font-bold transition hover:opacity-80"
            style={{
              background: "var(--accent-soft)",
              borderColor: "var(--accent)",
              color: "var(--accent-text)",
            }}
          >
            <span>⚡</span>
            Quick Checkout
          </button>
        </div>

        <div className="min-h-0 lg:flex-1 lg:overflow-y-auto lg:pr-1">
          {isLoading ? (
            <div className="flex h-full min-h-80 items-center justify-center">
              <Spinner label={t("pos.loading_products")} />
            </div>
          ) : filteredProducts.length > 0 ? (
            <ProductGrid
              products={filteredProducts}
              onAddProduct={addProductToSale}
              onToggleFavorite={toggleFavorite}
            />
          ) : (
            <EmptyState
              icon={PackageSearch}
              title={t("pos.no_products")}
              description={t("pos.try_another")}
              className="min-h-80 bg-white"
            />
          )}
        </div>
      </section>

      <button
        type="button"
        onClick={() => setIsCartOpen(true)}
        className={`absolute bottom-20 left-3 right-3 z-30 flex items-center justify-between gap-3 rounded-lg bg-zinc-950 px-4 py-3 text-left text-white shadow-2xl transition hover:bg-zinc-800 md:bottom-5 md:min-w-64 md:px-5 md:py-4 ${dir === "rtl" ? "md:left-5 md:right-auto" : "md:left-auto md:right-5"}`}
      >
        <span className="flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-lg bg-emerald-400 text-zinc-950">
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
        tenderMode={tenderMode}
        onSelectTenderMode={selectTenderMode}
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
        onCompleteSale={completeSale}
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
        heldSalesItemCount={heldSalesItemCount}
        canApplyDiscount={canApplyDiscount}
      />

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

      {simpleMode && (
        <SimplePOSMode
          products={products}
          categories={Array.from(new Set(products.filter((p) => !p.isParent).map((p) => p.category)))}
          items={items}
          onAddProduct={addProductToSale}
          onIncreaseQty={increaseQuantity}
          onDecreaseQty={decreaseQuantity}
          onRemoveItem={removeItem}
          vatRate={settings.vatRate}
          grossSubtotal={grossSubtotal}
          subtotal={subtotal}
          tax={tax}
          total={total}
          totalLbp={totalLbp}
          exchangeRate={exchangeRate}
          onCompleteSale={completeSimpleSale}
          onExit={() => setSimpleMode(false)}
        />
      )}
    </main>
  )
}

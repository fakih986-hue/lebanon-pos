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
import ModifierSheet from "../components/ModifierSheet"
import WasteDialog from "../components/WasteDialog"
import { cartShortage, configuredLine, consumptionPayload, defaultSelection, groupsForProduct, ingredientCheckoutLines, needsOptions, servingsFor, subscribeMenu, type CafeLine } from "../services/menu.service"
import { lineConfigKey, priceWithModifiers, type LineModifier, type Selection } from "../lib/cafeMenu"
import { cartKeyOf, lineOptionsText, type CartKey } from "../lib/lineOptions"
import { serverReason } from "../lib/serverReason"
import { getProductsSync } from "../services/product.service"
import QuickPOSMode from "../components/QuickPOSMode"
import KeyboardShortcutsModal from "../components/KeyboardShortcutsModal"
import PaymentReviewDialog from "../components/PaymentReviewDialog"
import { openShiftSheet } from "../components/shiftSheetEvents"
import { playErrorBuzz, playScanBlip } from "../lib/sound"
import { openWhatsAppShare, receiptMessage } from "../lib/whatsapp"
import {
  computeCashChange,
  formatCurrency,
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
import { buildSale, checkoutLocalSale, getSales, type Sale, type SaleTender } from "../services/sales.service"
import { cartFingerprint, checkoutViaHub, getPendingHubSale } from "../services/hubCheckout.service"
import ManagerApprovalDialog from "../../../components/ManagerApprovalDialog"
import { withdrawManagerApproval, type ApprovalRequest } from "../services/approval.service"
import { approvalGrantStatus, takeApprovalGrant, type ApprovalGrant } from "../lib/approvalGrants"
import { checkoutApprovalNeeded, checkoutFingerprint as fingerprintOf, saleForCheckout } from "../lib/checkoutApproval"
import { checkoutIdentityGate } from "../services/deviceSession.service"
import PendingHubSaleBanner from "../components/PendingHubSaleBanner"
import {
  holdSale,
  removeHeldSale,
  type HeldSale,
} from "../services/heldSale.service"
import { recordAuditEvent, userCan, getActiveShift, getOtherRegistersShift, getCurrentUser, subscribeSecurity, type Permission } from "../services/security.service"
import { showToast } from "../services/toast.service"
import { consumeInventoryBatches } from "../services/inventoryBatch.service"
import { getApiUrl, getConnectionMode, pullFromServer, nextDocumentReference, getSyncStatus, serverSupportsMadeToOrder, serverSupportsCafeMenu, getTopologyGuidance } from "../services/sync.service"
import { createId } from "../lib/storage"

import type { Product } from "../types/product"
import { usePosData } from "../hooks/usePosData"
import { useBarcodeScanner } from "../hooks/useBarcodeScanner"

type PaymentMethod = "Cash" | "Card" | "Wallet" | "Debt"
type TenderMode = "USD" | "LBP" | "Mixed"
type DiscountMode = "USD" | "Percent"

type CartItem = Product & {
  quantity: number
  /** Café batch: a configured drink's line (its options, note and price decide it; same configuration = same line) */
  lineKey?: string
  modifiers?: LineModifier[]
  note?: string
  basePrice?: number
}
/** Café batch: cart lines as the menu service reads them (recipe drinks and their options) */
const cafeLines = (items: CartItem[]): CafeLine[] => items.map((i) => ({ productId: i.id, quantity: i.quantity, stockPolicy: i.stockPolicy, recipeRev: i.recipeRev ?? null, modifiers: i.modifiers }))

export default function POSPage() {
  const { t, dir, locale } = useI18n()

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
  // café batch: the cart as of this render, for handlers that check ingredients before changing it
  const itemsRef = useRef<CartItem[]>(items)
  itemsRef.current = items
  // the drink whose options are being chosen (a new line, or an existing line being changed)
  const [optionsFor, setOptionsFor] = useState<null | { product: Product; mode: "add" | "edit"; lineKey?: CartKey; initial: { selection: Selection[]; note: string; quantity: number } }>(null)
  const lastConfigured = useRef<null | { productId: number; selection: Selection[]; note: string }>(null)
  const [menuVersion, setMenuVersion] = useState(0)
  const [wasteOpen, setWasteOpen] = useState(false)
  useEffect(() => subscribeMenu(() => setMenuVersion((v) => v + 1)), [])
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
  // Checkout lock: set before the (possibly async, server write-through) sale
  // starts, cleared when it ends. While set, review cannot reopen and a second
  // completeSale is ignored, so the same cart cannot be paid twice.
  const checkoutLock = useRef(false)
  const [checkingOut, setCheckingOut] = useState(false)
  // SPRINT-2 E: a sale with a discount or a price below list by someone without that permission is
  // approved online by a manager, at checkout, for exactly this sale (lib/approvalGrants). The sale is
  // built once and kept with what it was built from: the same sale is approved and sent; any change to
  // the cart, the discount, a price, the tender, the customer or the payment drops the approval.
  const [checkoutApproval, setCheckoutApproval] = useState<{ request: Omit<ApprovalRequest, "pin" | "approverId">; summary: string } | null>(null)
  const approvedSale = useRef<{ fingerprint: string; sale: Sale } | null>(null)
  const canAskApproval = Boolean(getApiUrl())
  const [hasShift, setHasShift] = useState(() => Boolean(getActiveShift()))
  useEffect(() => subscribeSecurity(() => setHasShift(Boolean(getActiveShift()))), [])

  const productListRef = useRef<HTMLDivElement | null>(null)

  // v2: the review dialog takes focus itself. Back returns focus to where the
  // cashier was (scan field or a tender field, in either mode); after a confirm
  // the scan field gets it so the next barcode lands there.
  const reviewReturnFocus = useRef<HTMLElement | null>(null)
  // The status line said "still due"; once the tender covers it, say so instead of leaving a stale amount.
  const stillDueShown = useRef(false)
  function closeReview(after: "back" | "confirm") {
    setShowReview(false)
    const back = reviewReturnFocus.current
    reviewReturnFocus.current = null
    window.requestAnimationFrame(() => {
      if (after === "back" && back && back.isConnected && back.offsetParent !== null) back.focus()
      else scanInputRef.current?.focus()
    })
  }

  // --- Auto-select first customer for Debt ---
  useEffect(() => {
    if (paymentMethod === "Debt" && !selectedCustomerId && customers[0]) {
      setSelectedCustomerId(customers[0].id)
    }
  }, [customers, paymentMethod, selectedCustomerId])

  // How an item was added, in the cashier's language (scanner status line).
  const sourceLabel = (source: string) => {
    const key = `pos.status.src_${source.replace(/\s+/g, "_")}`
    const label = t(key)
    return label === key ? source : label
  }

  // --- Hotkeys ---
  useHotkeys([
    {
      key: "f",
      modifiers: ["ctrl"],
      handler: () => scanInputRef.current?.focus(),
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
      const msg = op?.error ? t("pos.status.server_rejected", { error: op.error }) : t("pos.status.server_rejected_generic")
      setScannerStatus(msg)
    }
    window.addEventListener("sync:operation-rejected", onRejected)
    return () => window.removeEventListener("sync:operation-rejected", onRejected)
  }, [])

  // Auto-activate sellAtCost when selecting a cost-customer (only for staff allowed to override prices)
  useEffect(() => {
    if (selectedCustomer?.sellAtCost && userCan("sales.price_override")) {
      setSellAtCost(true)
    }
  }, [selectedCustomerId])

  // Persist recent sales across navigation
  useEffect(() => {
    if (recentSales.length > 0) {
      localStorage.setItem("lebanonpos.recent-sales.v1", JSON.stringify(recentSales))
    }
  }, [recentSales])

  // SPRINT-1: a pull can replace a product's local numeric id with the server's (same syncId).
  // Cart lines follow it, so the line keeps its stock, lots and identity.
  useEffect(() => {
    setItems((current) => {
      let changed = false
      const next = current.map((item) => {
        if (products.some((p) => p.id === item.id) || !item.syncId) return item
        const same = products.find((p) => p.syncId === item.syncId)
        if (!same) return item
        changed = true
        return { ...item, id: same.id }
      })
      return changed ? next : current
    })
  }, [products])

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
        label: category === "All" ? t("pos.category.all") : category === "Favorites" ? t("pos.category.favorites") : category,
        Icon,
        productCount: departmentProducts.length,
        stockCount: departmentProducts.reduce((sum, p) => sum + (p.stockPolicy === "untracked" ? 0 : p.stock), 0),
      }
    })
  }, [products, t])

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
  const canOverridePrice = userCan("sales.price_override")
  const grossSubtotal = roundMoney(items.reduce(
    (sum, item) => sum + item.price * item.quantity, 0
  ))
  const parsedDiscountValue = parseMoney(discountValue)
  const discountTotal = canApplyDiscount || canAskApproval
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
    for (const item of items) map[item.id] = (map[item.id] ?? 0) + item.quantity
    return map
  }, [items])
  // café batch: what each recipe drink's ingredients in stock can still make (ingredients are not in `products`)
  const allProducts = useMemo(() => getProductsSync(), [products, menuVersion])
  const servingsById = useMemo(() => new Map(products.filter((p) => p.stockPolicy === "recipe").map((p) => [p.id, servingsFor(p, [], allProducts)])), [products, allProducts, menuVersion])
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

  // SPRINT-2 E: the permissions this sale needs that the person signed in does not hold (the server's
  // rules: any discount; a line below its catalogue price, the wholesale price for a named customer,
  // or a sale at cost). Selling at cost shows cost: offered with approval to cost-visible staff only.
  const canSellAtCost = canOverridePrice || (canAskApproval && userCan("reports.cost"))
  const canSetLinePrice = canOverridePrice || canAskApproval
  const approvalNeeded: Permission[] = checkoutApprovalNeeded({ discountTotal, canDiscount: canApplyDiscount, canOverridePrice, sellAtCost, items, products, hasCustomer: Boolean(selectedCustomer) })
  const approvalHint = approvalNeeded.length ? t("approval.needed") : null
  const checkoutFingerprint = fingerprintOf({ items, discountTotal, subtotal, tax, total, sellAtCost, paymentMethod, customerId: selectedCustomer?.id ?? null, paidUsd: paidUsdAmount, paidLbp: paidLbpAmount })
  useEffect(() => {
    const kept = approvedSale.current
    if (!kept || kept.fingerprint === checkoutFingerprint) return
    // the sale changed: an approval for the earlier one cannot be used for this one
    approvedSale.current = null
    const userId = getCurrentUser()?.id ?? null
    let dropped: ApprovalGrant | null = null
    for (const p of ["sales.discount", "sales.price_override"]) {
      const s = approvalGrantStatus("sale", "create", kept.sale.id, p, userId)
      if (s.status === "ok") { dropped = s.grant; break }
    }
    if (dropped) { withdrawManagerApproval(dropped); setScannerStatus(t("approval.cleared")) }
  }, [checkoutFingerprint])

  // --- Cart operations ---
  // SPRINT-1: the stock limit applies to tracked items only (made-to-order items have none).
  // café batch: a recipe drink has no stock of its own either (its ingredients are checked: cartShortage)
  const stockLimit = (p: { stock: number; stockPolicy?: string }) => (p.stockPolicy ?? "tracked") !== "tracked" ? Number.POSITIVE_INFINITY : p.stock
  /**
   * Café batch: put a configured drink in the cart (or change an existing line: `replaceKey`). The same
   * configuration merges into its line; the whole cart's ingredients must be in stock here.
   */
  function addConfigured(product: Product, selection: Selection[], note: string, quantity: number, source = "options", replaceKey?: CartKey): boolean {
    const line = configuredLine(product, selection, note, quantity)
    const base = sellAtCost ? product.cost : selectedCustomer?.isWholesale && product.wholesalePrice != null ? Number(product.wholesalePrice) : product.price
    const price = sellAtCost ? product.cost : priceWithModifiers(base, line.modifiers)
    const key = lineConfigKey(product.id, line.modifiers, line.note, price)
    const current = itemsRef.current
    const at = replaceKey !== undefined ? current.findIndex((i) => cartKeyOf(i) === replaceKey) : -1
    const rest = replaceKey !== undefined ? current.filter((i) => cartKeyOf(i) !== replaceKey) : current
    const same = rest.find((i) => i.lineKey === key)
    const entry: CartItem = { ...product, quantity, price, lineKey: key, modifiers: line.modifiers, note: line.note || undefined, basePrice: line.basePrice, recipeRev: line.recipeRev }
    const next = same
      ? rest.map((i) => (i === same ? { ...i, quantity: i.quantity + quantity } : i))
      : at >= 0 ? [...rest.slice(0, at), entry, ...rest.slice(at)] : [...rest, entry]
    const short = cartShortage(cafeLines(next), allProducts)
    if (short) {
      playErrorBuzz()
      const message = t("pos.status.ingredient_short", { ingredient: short.ingredient, n: formatNumber(short.inStock), unit: t(`unit.${short.unit}`) })
      setScannerStatus(message)
      showToast(message, "error")
      return false
    }
    setItems(next)
    lastConfigured.current = { productId: product.id, selection, note: line.note }
    playScanBlip()
    setScannerStatus(t(replaceKey !== undefined ? "pos.mod.updated" : "pos.status.added_by", { name: product.name, source: sourceLabel(source) }))
    return true
  }
  /** Café batch: the last configured drink again, as it was chosen. */
  function repeatLastDrink() {
    const last = lastConfigured.current
    const product = last ? products.find((p) => p.id === last.productId) : undefined
    if (!last || !product) return
    addConfigured(product, last.selection, last.note, 1, "repeat")
  }
  function editLine(key: CartKey) {
    const item = itemsRef.current.find((i) => cartKeyOf(i) === key)
    const product = item ? products.find((p) => p.id === item.id) : undefined
    if (!item || !product) return
    setOptionsFor({ product, mode: "edit", lineKey: key, initial: { selection: (item.modifiers ?? []).map((m) => ({ groupId: m.groupId, optionId: m.optionId })), note: item.note ?? "", quantity: item.quantity } })
  }

  function addItem(product: Product) {
    if (stockLimit(product) <= 0) return
    const effectivePrice = sellAtCost
      ? product.cost
      : selectedCustomer?.isWholesale && product.wholesalePrice != null
      ? Number(product.wholesalePrice)
      : product.price
    setItems((currentItems) => {
      const existingItem = currentItems.find((item) => item.id === product.id && !item.lineKey)
      if (existingItem) {
        if (existingItem.quantity >= stockLimit(product)) return currentItems
        return currentItems.map((item) =>
          item === existingItem
            ? { ...item, quantity: item.quantity + 1, price: effectivePrice }
            : item
        )
      }
      return [...currentItems, { ...product, quantity: 1, price: effectivePrice }]
    })
  }

  function toggleSellAtCost() {
    if (!canSellAtCost) { playErrorBuzz(); setScannerStatus(t("pos.err.price_override_needed")); return }
    setSellAtCost((prev) => {
      const next = !prev
      setItems((currentItems) =>
        currentItems.map((item) => {
          const product = products.find((p) => p.id === item.id)
          if (!product) return item
          const normalBase = selectedCustomer?.isWholesale && product.wholesalePrice != null
            ? Number(product.wholesalePrice)
            : product.price
          // café batch: a configured line's normal price includes its options
          const normalPrice = item.modifiers?.length ? priceWithModifiers(normalBase, item.modifiers) : normalBase
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
    // café batch: a drink with options opens its sheet (required choices are never skipped); a recipe drink
    // without options goes in directly when its ingredients can make it
    if (needsOptions(product)) {
      setOptionsFor({ product, mode: "add", initial: { selection: defaultSelection(groupsForProduct(product)), note: "", quantity: 1 } })
      // the drink was found: the scan field is ready for the next item whether its options are added or cancelled
      setScanCode("")
      setSearch("")
      return
    }
    if (product.stockPolicy === "recipe") { addConfigured(product, [], "", 1, source); return }
    const cartItem = items.find((item) => item.id === product.id && !item.lineKey)
    // SPRINT-1: made-to-order (untracked) items have no stock limit.
    const tracked = product.stockPolicy !== "untracked"
    if (tracked && product.stock <= 0) {
      playErrorBuzz()
      const message = t("pos.status.out_of_stock", { name: product.name })
      setScannerStatus(message)
      showToast(message, "error")
      return
    }
    if (tracked && cartItem && cartItem.quantity >= product.stock) {
      playErrorBuzz()
      const message = t("pos.status.reached_stock", { name: product.name })
      setScannerStatus(message)
      showToast(message, "error")
      return
    }
    addItem(product)
    playScanBlip()
    setScanCode("")
    setSearch("")
    setScannerStatus(t("pos.status.added_by", { name: product.name, source: sourceLabel(source) }))
  }, [products, items])

  function quickAddProduct(value: string) {
    const query = value.trim().toLowerCase()
    if (!query) {
      // Enter on an empty scan box = "I'm done adding — take payment". The scan
      // input is auto-focused and keeps focus through the sale, so this is how a
      // cashier naturally reaches for checkout from the keyboard.
      requestReview()
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
      setScannerStatus(t("pos.status.not_found", { query: value.trim() }))
      return
    }
    addProductToSale(product, productHasBarcode(product, barcode) ? "barcode" : "quick add")
  }

  const toggleFavorite = useCallback(function toggleFavorite(product: Product) {
    toggleProductFavorite(product.id)
    setScannerStatus(
      product.favorite
        ? t("pos.status.fav_removed", { name: product.name })
        : t("pos.status.fav_added", { name: product.name })
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

  // Café batch: lines are keyed by their configuration (a drink with options) or their product. A drink's
  // quantity goes up only while the cart's ingredients are in stock here.
  const changeQuantity = useCallback(function changeQuantity(key: CartKey, quantityOf: (item: CartItem) => number) {
    const current = itemsRef.current
    const target = current.find((item) => cartKeyOf(item) === key)
    if (!target) return
    const quantity = Math.min(quantityOf(target), stockLimit(target))
    const next = current.map((item) => (item === target ? { ...item, quantity } : item)).filter((item) => item.quantity > 0)
    if (target.stockPolicy === "recipe" && quantity > target.quantity) {
      const short = cartShortage(cafeLines(next))
      if (short) {
        playErrorBuzz()
        setScannerStatus(t("pos.status.ingredient_short", { ingredient: short.ingredient, n: formatNumber(short.inStock), unit: t(`unit.${short.unit}`) }))
        return
      }
    }
    setItems(next)
  }, [t])
  const increaseQuantity = useCallback(function increaseQuantity(key: CartKey) {
    changeQuantity(key, (item) => item.quantity + 1)
  }, [changeQuantity])

  const decreaseQuantity = useCallback(function decreaseQuantity(key: CartKey) {
    changeQuantity(key, (item) => item.quantity - 1)
  }, [changeQuantity])

  const removeItem = useCallback(function removeItem(key: CartKey) {
    setItems((currentItems) => currentItems.filter((item) => cartKeyOf(item) !== key))
  }, [])

  const setItemQuantity = useCallback(function setItemQuantity(key: CartKey, qty: number) {
    changeQuantity(key, () => qty)
  }, [changeQuantity])

  const setItemPrice = useCallback(function setItemPrice(key: CartKey, price: number) {
    setItems((currentItems) =>
      currentItems.map((item) => cartKeyOf(item) === key ? { ...item, price } : item)
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
      setScannerStatus(t("pos.status.ready_next"))
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
        setScannerStatus(t("pos.status.ready_next"))
      },
    })
  }, [items, itemCount, grossSubtotal, discountTotal, t])

  const holdCurrentSale = useCallback(function holdCurrentSale() {
    if (items.length === 0) {
      setScannerStatus(t("pos.status.hold_empty"))
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
    setScannerStatus(t("pos.status.held", { hold: heldSale.holdNumber }))
  }, [items, itemCount, discountTotal, total, paymentMethod, selectedCustomerId, discountMode, discountValue, selectedCustomer, customers])

  const resumeHeldSale = useCallback(function resumeHeldSale(heldSale: HeldSale) {
    if (items.length > 0) {
      setScannerStatus(t("pos.status.resume_blocked"))
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
    setScannerStatus(t("pos.status.resumed", { hold: heldSale.holdNumber }))
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
        setScannerStatus(t("pos.status.discarded", { hold: heldSale.holdNumber }))
      },
    })
  }, [])

  useEffect(() => {
    if (stillDueShown.current && items.length > 0 && !checkoutBlocked) {
      stillDueShown.current = false
      setScannerStatus(t("pos.status.payment_covered"))
    }
  }, [checkoutBlocked, items.length, setScannerStatus, t])

  /** Focus a tender field (Paid USD / Paid LBP). On a phone the tender lives in the cart sheet: open it first. */
  function focusTender(field: "usd" | "lbp") {
    const go = () => {
      const el = [...document.querySelectorAll<HTMLInputElement>(`input[data-tender="${field}"]`)].find((x) => x.offsetParent !== null)
      el?.focus(); el?.select()
    }
    const phoneRegister = !quickMode && window.matchMedia("(max-width: 1023px)").matches
    if (phoneRegister && !isCartOpen) { setIsCartOpen(true); window.setTimeout(go, 400) }
    else window.requestAnimationFrame(go)
  }

  /**
   * The one gate to payment review, for both modes and every entry point (Enter in an
   * empty scan field, Enter in a tender field, the Pay buttons). Never opens while a sale
   * is being completed, and never skips the checkout validation.
   */
  function requestReview() {
    if (checkoutLock.current) { setScannerStatus(t("pos.status.completing")); return }
    if (items.length === 0) { setScannerStatus(t("pos.status.choose_item")); return }
    if (!getActiveShift()) { setScannerStatus(t("pos.status.no_shift")); playErrorBuzz(); return }
    if (checkoutBlocked) {
      if (paymentMethod === "Cash" && !cashTenderValid) {
        // Not enough paid: put the cashier in the field to complete — LBP if they were paying in LBP, else USD.
        setScannerStatus(t("pos.status.still_due", { amount: formatCurrency(cashStillDueUsd) }))
        stillDueShown.current = true
        focusTender(paidLbpAmount > 0 && paidUsdAmount === 0 ? "lbp" : "usd")
        return
      }
      setScannerStatus(paymentMethod === "Debt" && !selectedCustomer ? t("pos.status.select_customer")
        : creditLimitExceeded ? t("pos.status.credit_exceeded") : t("pos.status.cannot_checkout"))
      playErrorBuzz()
      return
    }
    reviewReturnFocus.current = document.activeElement as HTMLElement | null
    setShowReview(true)
  }
  const handleReview = requestReview

  /** Enter in a tender field: review when payable; from Paid USD with too little, move on to Paid LBP. */
  function handleTenderEnter(field: "usd" | "lbp") {
    if (field === "usd" && !checkoutLock.current && paymentMethod === "Cash" && !cashTenderValid && items.length > 0) {
      setScannerStatus(t("pos.status.still_due", { amount: formatCurrency(cashStillDueUsd) }))
      stillDueShown.current = true
      focusTender("lbp")
      return
    }
    if (field === "lbp" && !checkoutLock.current && paymentMethod === "Cash" && !cashTenderValid && items.length > 0) {
      setScannerStatus(t("pos.status.still_due", { amount: formatCurrency(cashStillDueUsd) }))
      stillDueShown.current = true
      return // stay in Paid LBP
    }
    requestReview()
  }

  useEffect(() => {
    const TENDER_KEYS: Record<string, PaymentMethod> = { F2: "Cash", F3: "Card", F4: "Wallet", F5: "Debt" }
    function onRegisterKey(e: KeyboardEvent) {
      if (showReview || e.ctrlKey || e.metaKey || e.altKey) return
      const method = TENDER_KEYS[e.key]
      if (method) { e.preventDefault(); setPaymentMethod(method); return }
      if (e.key === "F8" && items.length > 0) { e.preventDefault(); holdCurrentSale() }
    }
    window.addEventListener("keydown", onRegisterKey)
    return () => window.removeEventListener("keydown", onRegisterKey)
  }, [showReview, items.length, holdCurrentSale])

  async function completeSale() {
    if (checkoutLock.current) return
    checkoutLock.current = true
    setCheckingOut(true)
    try {
      await completeSaleOnce()
    } finally {
      checkoutLock.current = false
      setCheckingOut(false)
    }
  }

  async function completeSaleOnce() {
    if (checkoutBlocked || isValidatingStock) return

    // A sale must belong to an open register shift (cash-control). On a fresh
    // register no shift exists yet, so catch it here with a clear, actionable
    // message instead of the generic "Checkout failed" the throw would produce.
    if (!getActiveShift()) {
      setShowReview(false)
      setScannerStatus(t("pos.status.no_shift"))
      playErrorBuzz()
      return
    }

    // SPRINT-2: a store enforcing staff sessions refuses a sale without one — stop here, before payment.
    const identity = await checkoutIdentityGate()
    if (identity) {
      setShowReview(false)
      playErrorBuzz()
      const message = t(identity === "not-enrolled" ? "pos.err.identity_not_enrolled" : "pos.err.identity_sign_in")
      setScannerStatus(message)
      showToast(message, "error")
      return
    }

    const mode = getConnectionMode()
    // Every product in this system is stock-tracked, so a sale with items is
    // stock-decrementing. Pure debt payments / non-stock ops don't reach here.
    const stockDecrementing = items.length > 0
    // Server-authoritative (write-through) for BOTH hub and connected clients:
    // the sale + stock/batch decrement is committed by the server BEFORE the
    // sale is finalized locally, so the till can never show "success / 0 left"
    // and then silently revert when the commit fails (e.g. the batch behind a
    // drifted aggregate is empty). For STORE_HUB the server is its own
    // localhost API — same-machine, instant, always reachable — so this is the
    // atomic-local-commit the hub authority is meant to have, with no false
    // success. For CONNECT_TO_HUB it's the LAN hub.
    const writeThrough = (mode === "CONNECT_TO_HUB" || mode === "STORE_HUB") && stockDecrementing

    // The store's topology: connected where this store's stock is not kept, a sale would only be held.
    // Refuse here, before any money is taken (the register's queued work is kept and sent once reconnected).
    const topology = getTopologyGuidance()
    if (topology) {
      playErrorBuzz()
      setScannerStatus(t(`pos.topology.${topology.verdict}`))
      showToast(t(`pos.topology.${topology.verdict}`), "error")
      return
    }

    // SPRINT-1: an older hub or cloud cannot record made-to-order lines (it would reject the sale
    // after payment). Refuse here, before any money is taken.
    // café batch: drinks made from recipes or sold with options need a hub or cloud that records them (schema 6)
    if (items.some((item) => item.stockPolicy === "recipe" || (item.modifiers?.length ?? 0) > 0) && !(await serverSupportsCafeMenu())) {
      playErrorBuzz()
      setScannerStatus(t("pos.err.server_too_old"))
      showToast(t("pos.err.server_too_old"), "error")
      return
    }
    if (items.some((item) => item.stockPolicy === "untracked") && !(await serverSupportsMadeToOrder())) {
      playErrorBuzz()
      setScannerStatus(t("pos.err.server_too_old"))
      showToast(t("pos.err.server_too_old"), "error")
      return
    }
    const saleNumber = nextDocumentReference("S", 6, () => getSales().map((s) => s.saleNumber))
    const saleId = createId() // client-generated UUID → hub commit is idempotent

    // SPRINT-1: only tracked items consume lots and stock; made-to-order lines record money and cost only.
    const trackedItems = items.filter((item) => (item.stockPolicy ?? "tracked") === "tracked")
    // café batch: a recipe drink takes its ingredients' lots and stock here (FEFO, like packaged items), so an
    // interrupted checkout gives them back exactly once (businessJournal); the server records its own consumption
    const ingredientLines = ingredientCheckoutLines(cafeLines(items), allProducts)
    const cartInputs = [...trackedItems.map((item) => ({
      productId: item.id, productName: item.name, barcode: item.barcode ?? "",
      quantity: item.quantity, fallbackUnitCost: item.cost,
    })), ...ingredientLines.lots]
    const stockLines = [...trackedItems.map((item) => ({ productId: item.id, quantity: item.quantity })), ...ingredientLines.stock]


    try {
      // Build the canonical sale payload FIRST, via a dry-run batch allocation
      // that writes/enqueues nothing — so no local state changes before we
      // know the sale is actually allowed.
      const dryAlloc = consumeInventoryBatches(cartInputs, { dryRun: true })
      // café batch: an ingredient's estimated cost per stock unit here (its lots by FEFO); the server values it
      const ingredientUnitCost = (syncId: string) => {
        const p = allProducts.find((x) => x.syncId === syncId)
        const a = p ? dryAlloc.get(p.id) ?? [] : []
        const q = a.reduce((sum, x) => sum + x.quantity, 0)
        return q > 0 ? a.reduce((sum, x) => sum + x.unitCost * x.quantity, 0) / q : Number(p?.cost) || 0
      }
      const saleItems = items.map((item) => {
        const recipeLine = item.stockPolicy === "recipe"
        const untrackedLine = item.stockPolicy === "untracked" || recipeLine
        const allocations = untrackedLine ? [] : dryAlloc.get(item.id) ?? []
        const allocatedQuantity = allocations.reduce((sum, a) => sum + a.quantity, 0)
        const allocatedCost = allocations.reduce((sum, a) => sum + a.unitCost * a.quantity, 0)
        const product = recipeLine || item.lineKey ? allProducts.find((p) => p.id === item.id) : undefined
        const made = product ? configuredLine(product, (item.modifiers ?? []).map((m) => ({ groupId: m.groupId, optionId: m.optionId })), item.note ?? "", item.quantity) : null
        const recipeCost = recipeLine && made ? made.consumption.reduce((sum, c) => sum + (c.milli / 1000) * ingredientUnitCost(c.ingredientSyncId), 0) / Math.max(1, item.quantity) : null
        const unitCost = recipeCost ?? (allocatedQuantity > 0 ? allocatedCost / allocatedQuantity : item.cost)
        return {
          // No cost visibility on this till (SPRINT-0): no cost is sent; the server uses the product's.
          id: item.id, productSyncId: item.syncId, name: item.name, barcode: item.barcode ?? "", cost: Number.isFinite(unitCost) ? unitCost : (undefined as unknown as number),
          stockPolicy: recipeLine ? "recipe" as const : untrackedLine ? "untracked" as const : "tracked" as const,
          stockPolicyVersion: item.stockPolicyVersion ?? 1,
          stockPolicyRev: item.stockPolicyRev ?? "initial",
          quantity: item.quantity, unitPrice: item.price,
          total: item.price * item.quantity, batchAllocations: allocations,
          // café batch: the line as sold (options snapshot, note, the product's own price) and, for a recipe
          // drink, the revision it was made with and what this register recorded it consumed
          ...(item.modifiers?.length ? { modifiers: item.modifiers } : {}),
          ...(item.note ? { note: item.note } : {}),
          ...(item.lineKey || recipeLine ? { basePrice: item.basePrice ?? product?.price } : {}),
          ...(recipeLine ? { recipeRev: made?.recipeRev ?? item.recipeRev ?? null, consumption: consumptionPayload(made?.consumption ?? []) } : {}),
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
      const saleInput = {
        saleNumber, paymentMethod,
        customerId: selectedCustomer?.id, customerName: selectedCustomer?.name,
        subtotal, discountTotal, tax, total, soldAtCost: sellAtCost, tender,
        payableLbp: paymentMethod === "Cash" ? payableLbp : undefined,
        items: saleItems,
      }
      let sale: Sale = buildSale(saleInput, saleId) // throws if no open shift
      const hubFingerprint = cartFingerprint({ items: items.map((item) => ({ id: item.id, quantity: item.quantity, unitPrice: item.price, options: [...(item.modifiers ?? []).map((m) => m.optionId), item.note ?? ""].join(",") })), paymentMethod, customerId: selectedCustomer?.id, total })

      // -- SPRINT-2 E: a manager's online approval for exactly this sale --
      let approvalId: string | undefined
      let approvedBy: string | undefined
      if (approvalNeeded.length) {
        const chosen = saleForCheckout({ built: sale, pending: writeThrough ? getPendingHubSale() : null, hubFingerprint, kept: approvedSale.current, fingerprint: checkoutFingerprint })
        sale = chosen.sale
        if (chosen.approvalId) {
          // sent before with its approval (the confirmation was lost): resent exactly, with the same one
          approvalId = chosen.approvalId
        } else {
          const userId = getCurrentUser()?.id ?? null
          const status = approvalGrantStatus("sale", "create", sale.id, approvalNeeded[0], userId, sale)
          const grant = status.status === "ok" && approvalNeeded.every((p) => (status.grant.permissions ?? [status.grant.permission]).includes(p)) ? status.grant : null
          if (!grant) {
            // ask a manager for THIS sale; the cart, the tender and the person signed in stay as they are
            approvedSale.current = { fingerprint: checkoutFingerprint, sale }
            setShowReview(false)
            const reasons = approvalNeeded.map((p) => p === "sales.discount" ? t("approval.reason_discount", { amount: formatCurrency(discountTotal) }) : t("approval.reason_price"))
            setCheckoutApproval({
              request: { entity: "sale", action: "create", payload: sale as unknown as Record<string, unknown> & { id: string }, permission: approvalNeeded[0], permissions: approvalNeeded },
              summary: t("approval.checkout_summary", { sale: sale.saleNumber, total: formatCurrency(total), reasons: reasons.join(" · ") }),
            })
            return
          }
          approvalId = grant.approvalId
          approvedBy = grant.approverName
        }
      }

      // ── Gate: server-authoritative commit (both STORE_HUB and CONNECT_TO_HUB) ──
      // The server commits the sale + stock/batch decrement atomically and we
      // only finalize locally on confirm. This is what prevents the "shows
      // success / 0 left, then stock reappears" bug: if the commit fails (e.g.
      // the batch behind a drifted aggregate is empty), the sale is NOT
      // recorded and the cashier sees a clear failure instead of a false
      // success that later reverts. For STORE_HUB the target is localhost
      // (instant, same-machine); for CONNECT_TO_HUB it's the LAN hub.
      let committedSale = sale
      if (writeThrough) {
        // The sale is saved as this till's pending hub sale BEFORE it is sent: a lost confirmation
        // can never lead to a second sale — the same cart re-sends the same sale, and a different
        // cart is held until the earlier one is confirmed (hubCheckout.service).
        setIsValidatingStock(true)
        setScannerStatus(mode === "STORE_HUB" ? t("pos.status.completing") : t("pos.status.completing_hub"))
        let outcome
        try {
          outcome = await checkoutViaHub({
            fingerprint: hubFingerprint,
            build: () => sale,
            approvalId,
            lots: cartInputs,
            stock: stockLines,
            debt: paymentMethod === "Debt" && selectedCustomer
              ? { customerId: selectedCustomer.id, saleNumber: sale.saleNumber, subtotal, discountTotal, tax, total, items: saleItems }
              : undefined,
          })
        } finally { setIsValidatingStock(false) }
        if (outcome.status === "rejected") {
          setScannerStatus(/Insufficient stock|INGREDIENT_SHORT/i.test(outcome.error)
            ? t("pos.status.hub_out_of_stock")
            : t("pos.status.hub_rejected", { error: serverReason(t, outcome.error) }))
          playErrorBuzz(); pullFromServer().catch(() => {}); return
        }
        if (outcome.status === "unconfirmed") {
          // The hub may already have it: the cart stays, and payment must not be taken again.
          setScannerStatus(t("pos.status.hub_unconfirmed", { number: outcome.sale.saleNumber }))
          playErrorBuzz(); return
        }
        if (outcome.status === "previous_committed") {
          // An earlier sale with a lost confirmation went through; this cart was not charged.
          setScannerStatus(t("pos.status.hub_previous_committed", { number: outcome.sale.saleNumber }))
          playErrorBuzz(); pullFromServer().catch(() => {}); return
        }
        committedSale = outcome.sale
      }

      // ── Local finalize ────────────────────────────────────────────────
      // When the hub already committed (write-through), suppress enqueues —
      // the hub owns the authoritative stock/batch decrement; local writes
      // here are for immediate receipt/display and are reconciled by pull.
      let needsAttention: string | undefined
      if (writeThrough) {
        // Finalized locally by checkoutViaHub (once, even across retries).
      } else {
        // One durable boundary for lots, the sale, its debt and stock (businessJournal): a failure
        // before the sale is written is compensated and thrown (cart kept); after it the rest is
        // completed. A state that matches neither is blocked and shown in Sync status.
        const result = checkoutLocalSale({
          sale,
          lots: cartInputs,
          stock: stockLines,
          debt: paymentMethod === "Debt" && selectedCustomer
            ? { customerId: selectedCustomer.id, saleNumber: sale.saleNumber, subtotal, discountTotal, tax, total, items: saleItems }
            : undefined,
        })
        if (result.status === "blocked") needsAttention = result.detail
      }

      // the approval went with this sale (write-through) or was attached to its queued operation
      takeApprovalGrant("sale", "create", committedSale.id)
      approvedSale.current = null
      if (discountTotal > 0) {
        recordAuditEvent({
          action: "sale.discount", entity: "sale",
          summary: `${committedSale.saleNumber} received a ${formatCurrency(discountTotal)} discount${approvedBy ? ` (approved by ${approvedBy})` : ""}.`,
          metadata: { saleNumber: committedSale.saleNumber, grossSubtotal, discountMode, discountValue, discountTotal, ...(approvalId ? { approvalId } : {}) },
        })
      }

      const saleRecord = {
        number: committedSale.saleNumber, paymentMethod, customerName: selectedCustomer?.name,
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
      setScannerStatus(needsAttention ? t("pos.status.sale_needs_attention") : `${approvedBy ? `${t("approval.granted", { name: approvedBy })} ` : ""}${t("pos.status.sale_completed")}`)
      window.requestAnimationFrame(() => scanInputRef.current?.focus())
      // Reconcile local stock/batches with the hub's authoritative numbers.
      if (writeThrough) pullFromServer().catch(() => {})
    } catch (err) {
      // Nothing to undo here: checkoutLocalSale compensates (or completes) its own effects through
      // the business journal, and checkoutViaHub records nothing until the hub commits. The cart
      // is kept so the cashier can retry.
      const reason = (err as Error)?.message?.trim()
      console.error("[checkout] sale failed:", err)
      setScannerStatus(reason ? t("pos.status.checkout_failed", { reason }) : t("pos.status.checkout_failed_generic"))
    }
  }

  return (
    <main className="mg2 pos-workspace relative min-h-0 flex-1 overflow-hidden">
      {/* Desktop: flex row with products + cart rail. Mobile: single column */}
      <div className="flex h-full min-h-0">
        {/* ── Left: Product area ── */}
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <section className="flex h-full min-w-0 flex-col gap-3 overflow-hidden p-3 pb-24 sm:p-4 md:pb-4 xl:p-5">
            <SyncBanner />
            <PendingHubSaleBanner refreshKey={scannerStatus} />
            {!hasShift && (() => {
              // batch 83: another register's drawer is open and this store does not share one drawer
              const other = getOtherRegistersShift()
              return other ? (
                <div className="mg2-banner mg2-t-warn" role="status" data-testid="other-register-shift">
                  <div style={{ flex: 1, minWidth: 180 }}>
                    <div className="mg2-sub" style={{ color: "var(--text)" }}>{t("pos.drawer.other_register_title")}</div>
                    <div className="mg2-cap" style={{ color: "var(--text-2)" }}>{t("pos.drawer.other_register_text", { shift: other.shiftNumber, register: other.deviceName || t("pos.drawer.another_register"), name: other.openedByName })}</div>
                  </div>
                </div>
              ) : (
                <div className="mg2-banner mg2-t-warn" role="status">
                  <div style={{ flex: 1, minWidth: 180 }}>
                    <div className="mg2-sub" style={{ color: "var(--text)" }}>{t("pos.v2.no_shift_title")}</div>
                    <div className="mg2-cap" style={{ color: "var(--text-2)" }}>{t("pos.v2.no_shift_text")}</div>
                  </div>
                  <button type="button" className="mg2-btn mg2-btn-primary" onClick={openShiftSheet}>{t("pos.v2.open_shift")}</button>
                </div>
              )
            })()}
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
                  items: (s.items ?? []).map((i: any) => ({ name: i.name, quantity: i.quantity, total: i.price * i.quantity, options: lineOptionsText(i, locale) || undefined })),
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
                onTenderEnter={handleTenderEnter}
                onRequestReview={requestReview}
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
                onEditItem={editLine}
                onCleanSale={cleanSale}
                onExit={() => setQuickMode(false)}
                itemCount={itemCount}
                total={total}
                totalLbp={totalLbp}
                payableLbp={payableLbp}
                payableUsd={payableUsd}
                canOverridePrice={canSellAtCost}
          canSetLinePrice={canSetLinePrice}
          approvalHint={approvalHint}
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
                recentSales={recentSales}
                onPrintReceipt={(s) => printLastSaleReceipt(s, settings)}
                onWhatsAppReceipt={(s) => {
                  openWhatsAppShare(receiptMessage({
                    storeName: settings.storeName,
                    saleNumber: s.number,
                    total: s.total,
                    totalLbp: s.totalLbp,
                  items: (s.items ?? []).map((i: any) => ({ name: i.name, quantity: i.quantity, total: i.price * i.quantity, options: lineOptionsText(i, locale) || undefined })),
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
                canApplyDiscount={canApplyDiscount || canAskApproval}
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
                {/* café batch: the last configured drink again, and remakes/waste (a stock event, not a sale) */}
                {(lastConfigured.current || products.some((p) => p.stockPolicy === "recipe")) && (
                  <div className="flex flex-wrap gap-2 px-1 pb-2">
                    {lastConfigured.current && (() => {
                      const last = products.find((p) => p.id === lastConfigured.current?.productId)
                      return last ? <button type="button" className="mg2-btn" style={{ minHeight: 44 }} onClick={repeatLastDrink}>{t("pos.mod.repeat_last", { name: last.name })}</button> : null
                    })()}
                    <button type="button" className="mg2-btn mg2-btn-ghost" style={{ minHeight: 44 }} onClick={() => setWasteOpen(true)}>{t("waste.open")}</button>
                  </div>
                )}

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
                      servings={servingsById}
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
                <div className="mg2-cap hidden md:flex flex-wrap gap-4 mt-auto" aria-label={t("pos.v2.shortcuts")}>
                  <span><span className="mg2-kbd">Enter</span> {t("pos.v2.key_pay")}</span>
                  <span><span className="mg2-kbd">F2</span>–<span className="mg2-kbd">F5</span> {t("pos.v2.key_tender")}</span>
                  <span><span className="mg2-kbd">F8</span> {t("pos.hold")}</span>
                  <span><span className="mg2-kbd">Ctrl</span> <span className="mg2-kbd">F</span> {t("pos.v2.key_search")}</span>
                  <span><span className="mg2-kbd">Esc</span> {t("pos.v2.back")}</span>
                </div>
              </>
            )}
          </section>

          {/* ── Mobile floating cart button ── */}
          {/* Hidden (not only inert) while review is open: see body[data-payment-review] in register-v2.css. */}
          {!quickMode && <div className="mg2-paybar lg:hidden">
            <button type="button" className="mg2-btn" style={{ minHeight: 64, flexDirection: "column", gap: 0, padding: "0 14px" }}
              onClick={() => setIsCartOpen(true)} aria-label={t("pos.v2.open_cart", { lines: formatNumber(items.length) })}>
              <ShoppingCart size={18} />
              <span className="num" style={{ fontSize: 13 }}>{t("pos.v2.lines", { lines: formatNumber(items.length) })}</span>
            </button>
            <button type="button" className="mg2-pay" disabled={items.length === 0 || checkingOut} aria-busy={checkingOut || undefined} onClick={() => setIsCartOpen(true)}>
              <span>{t("pos.pay")}</span>
              <span className="num">{formatCurrency(paymentMethod === "Cash" ? payableUsd : total)}</span>
              <span className="num" style={{ fontSize: 14 }}>{formatNumber(Math.round(paymentMethod === "Cash" ? payableLbp : totalLbp))} {t("pos.v2.lbp")}</span>
            </button>
          </div>}
        </div>

        {/* ── Right: Persistent cart rail (desktop only) ── */}
        <CartPanel
          quickMode={quickMode}
          canOverridePrice={canSellAtCost}
          canSetLinePrice={canSetLinePrice}
          approvalHint={approvalHint}
          items={items}
          onIncreaseQty={increaseQuantity}
          onDecreaseQty={decreaseQuantity}
          onRemoveItem={removeItem}
          onEditItem={editLine}
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
          onTenderEnter={handleTenderEnter}
          itemCount={itemCount}
          grossSubtotal={grossSubtotal}
          discountTotal={discountTotal}
          subtotal={subtotal}
          tax={tax}
          total={total}
          totalLbp={totalLbp}
          payableLbp={payableLbp}
          payableUsd={payableUsd}
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
          canApplyDiscount={canApplyDiscount || canAskApproval}
          sellAtCost={sellAtCost}
          onToggleSellAtCost={toggleSellAtCost}
        />
      </div>

      {/* ── CartDrawer (mobile drawer, hidden on desktop) ── */}
      <div className="lg:hidden">
        <CartDrawer
          isOpen={isCartOpen}
          onClose={() => setIsCartOpen(false)}
          canOverridePrice={canSellAtCost}
          canSetLinePrice={canSetLinePrice}
          approvalHint={approvalHint}
          items={items}
          onIncreaseQty={increaseQuantity}
          onDecreaseQty={decreaseQuantity}
          onRemoveItem={removeItem}
          onEditItem={editLine}
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
          onTenderEnter={handleTenderEnter}
          itemCount={itemCount}
          grossSubtotal={grossSubtotal}
          discountTotal={discountTotal}
          subtotal={subtotal}
          tax={tax}
          total={total}
          totalLbp={totalLbp}
          payableLbp={payableLbp}
          payableUsd={payableUsd}
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
          canApplyDiscount={canApplyDiscount || canAskApproval}
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

      {optionsFor ? (
        <ModifierSheet
          key={`${optionsFor.product.id}:${String(optionsFor.lineKey ?? "new")}`}
          product={optionsFor.product}
          groups={groupsForProduct(optionsFor.product)}
          initial={optionsFor.initial}
          mode={optionsFor.mode}
          servingsWith={(ids) => servingsFor(optionsFor.product, ids, allProducts)}
          onConfirm={(r) => {
            if (!addConfigured(optionsFor.product, r.selection, r.note, r.quantity, "options", optionsFor.mode === "edit" ? optionsFor.lineKey : undefined)) return
            setOptionsFor(null)
            window.requestAnimationFrame(() => scanInputRef.current?.focus())
          }}
          // nothing changes in the cart; focus goes back where the cashier was scanning
          onCancel={() => { setOptionsFor(null); window.requestAnimationFrame(() => scanInputRef.current?.focus()) }}
        />
      ) : null}

      {wasteOpen ? (
        <WasteDialog products={allProducts}
          onDone={(message) => { setWasteOpen(false); setScannerStatus(message); showToast(message); window.requestAnimationFrame(() => scanInputRef.current?.focus()) }}
          onCancel={() => { setWasteOpen(false); window.requestAnimationFrame(() => scanInputRef.current?.focus()) }} />
      ) : null}

      {variantPickerProduct ? (
        <VariantPicker
          product={variantPickerProduct}
          products={products}
          onSelectVariant={addProductToSale}
          onClose={() => setVariantPickerProduct(null)}
        />
      ) : null}

      <KeyboardShortcutsModal open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />

      <ManagerApprovalDialog open={!!checkoutApproval} request={checkoutApproval?.request ?? null}
        summary={<p style={{ fontWeight: 600, color: "var(--text)" }}>{checkoutApproval?.summary}</p>}
        onApproved={() => { setCheckoutApproval(null); void completeSale() }}
        onCancel={() => { setCheckoutApproval(null); setScannerStatus(t("approval.checkout_cancelled")); window.requestAnimationFrame(() => scanInputRef.current?.focus()) }} />

      {showReview && (
        <PaymentReviewDialog
          lines={items.length}
          units={itemCount}
          total={total}
          totalLbp={totalLbp}
          payableLbp={payableLbp}
          payableUsd={payableUsd}
          paymentMethod={paymentMethod}
          paidUsd={paidUsdAmount}
          paidLbp={paidLbpAmount}
          changeUsd={cashChangeUsd}
          changeLbp={cashChangeLbp}
          stillDueUsd={paymentMethod === "Cash" ? cashStillDueUsd : 0}
          blockedReason={!checkoutBlocked ? null
            : items.length === 0 ? t("pos.v2.blocked_empty")
            : paymentMethod === "Cash" && !cashTenderValid ? t("pos.v2.blocked_cash", { amount: formatCurrency(cashStillDueUsd) })
            : paymentMethod === "Debt" && !selectedCustomer ? t("pos.select_customer_hint")
            : creditLimitExceeded ? t("pos.credit_exceeded") : t("pos.v2.blocked_other")}
          offline={!getSyncStatus().online}
          customerName={selectedCustomer?.name}
          shiftLabel={getActiveShift()?.shiftNumber}
          onBack={() => closeReview("back")}
          onConfirm={() => { closeReview("confirm"); completeSale() }}
        />
      )}

      <SaleCompleteOverlay sale={lastSale}
        nextSaleStarted={items.length > 0}
        onViewReceipt={() => lastSale && printLastSaleReceipt(lastSale, settings)}
        onWhatsApp={() => {
          if (!lastSale) return
          openWhatsAppShare(receiptMessage({
            storeName: settings.storeName,
            saleNumber: lastSale.number,
            total: lastSale.total,
            totalLbp: lastSale.totalLbp,
            items: (lastSale.items ?? []).map((i: any) => ({ name: i.name, quantity: i.quantity, total: i.price * i.quantity, options: lineOptionsText(i, locale) || undefined })),
            footer: settings.receiptFooter,
          }))
        }}
      />

    </main>
  )
}

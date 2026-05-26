import { useEffect, useMemo, useRef, useState } from "react"
import type { ChangeEvent } from "react"
import {
  Candy,
  Croissant,
  CupSoda,
  Eraser,
  LayoutGrid,
  PackageOpen,
  PackageSearch,
  ScanBarcode,
  Search,
  ShoppingBasket,
  ShoppingCart,
  Star,
  Utensils,
} from "lucide-react"
import type { LucideIcon } from "lucide-react"

import ConfirmDialog from "../../../components/ConfirmDialog"
import ProductCard from "../components/ProductCard"
import DepartmentTabs from "../components/DepartmentTabs"
import LastSaleBanner from "../components/LastSaleBanner"
import CartDrawer from "../components/CartDrawer"
import {
  formatCurrency,
  formatLbpCurrency,
  formatNumber,
  formatUsdCurrency,
  lbpToUsd,
  usdToLbp,
} from "../lib/currency"
import {
  createBarcodeDetector,
  createHtml5Qrcode,
  detectBarcodeFromImageFile,
  getCameraErrorMessage,
  getHtml5QrcodeFormatCodes,
  getLiveCameraIssue,
  getPreferredCameraConstraints,
  type Html5QrcodeInstance,
} from "../lib/cameraScanner"
import {
  getCustomerLedger,
  recordDebtSale,
  subscribeLedger,
  type CustomerLedger,
} from "../services/customer.service"
import { consumeInventoryBatches } from "../services/inventoryBatch.service"
import {
  decreaseProductStock,
  findProductByBarcode,
  getProducts,
  productHasBarcode,
  productMatchesSearch,
  subscribeProducts,
  toggleProductFavorite,
} from "../services/product.service"
import {
  getSettings,
  subscribeSettings,
  type AppSettings,
} from "../services/settings.service"
import { recordSale, type SaleTender } from "../services/sales.service"
import {
  getHeldSales,
  holdSale,
  removeHeldSale,
  subscribeHeldSales,
  type HeldSale,
} from "../services/heldSale.service"
import { recordAuditEvent, userCan } from "../services/security.service"
import type { Product } from "../types/product"

type PaymentMethod = "Cash" | "Card" | "Wallet" | "Debt"
type TenderMode = "USD" | "LBP" | "Mixed"
type ChangeCurrency = "USD" | "LBP"
type DiscountMode = "USD" | "Percent"

type CartItem = Product & {
  quantity: number
}

type DepartmentTheme = {
  active: string
  inactive: string
  iconActive: string
  iconInactive: string
  countActive: string
  countInactive: string
}

type LastSaleSummary = {
  number: string
  paymentMethod: PaymentMethod
  customerName?: string
  grossSubtotal: number
  subtotal: number
  discountTotal: number
  tax: number
  total: number
  totalLbp: number
  exchangeRate: number
  tender?: SaleTender
  customerBalanceBefore?: number
  customerBalanceAfter?: number
  items: CartItem[]
}

const POS_CAMERA_READER_ID = "lebanonpos-pos-camera-reader"

const departmentIcons: Record<string, LucideIcon> = {
  All: LayoutGrid,
  Favorites: Star,
  Drinks: CupSoda,
  Bakery: Croissant,
  Food: Utensils,
  Snacks: Candy,
  Pantry: ShoppingBasket,
}

const departmentThemes: DepartmentTheme[] = [
  {
    active: "border-zinc-950 bg-zinc-950 text-white shadow-sm",
    inactive:
      "border-zinc-200 bg-white text-zinc-900 hover:border-zinc-300 hover:bg-zinc-50",
    iconActive: "bg-white/15 text-white",
    iconInactive: "bg-zinc-100 text-zinc-800",
    countActive: "bg-white/15 text-white",
    countInactive: "bg-zinc-100 text-zinc-700",
  },
  {
    active: "border-cyan-700 bg-cyan-700 text-white shadow-sm",
    inactive:
      "border-cyan-200 bg-cyan-50 text-cyan-950 hover:border-cyan-300 hover:bg-cyan-100",
    iconActive: "bg-white/15 text-white",
    iconInactive: "bg-white text-cyan-700",
    countActive: "bg-white/15 text-white",
    countInactive: "bg-white text-cyan-800",
  },
  {
    active: "border-amber-700 bg-amber-600 text-white shadow-sm",
    inactive:
      "border-amber-200 bg-amber-50 text-amber-950 hover:border-amber-300 hover:bg-amber-100",
    iconActive: "bg-white/15 text-white",
    iconInactive: "bg-white text-amber-700",
    countActive: "bg-white/15 text-white",
    countInactive: "bg-white text-amber-800",
  },
  {
    active: "border-rose-700 bg-rose-700 text-white shadow-sm",
    inactive:
      "border-rose-200 bg-rose-50 text-rose-950 hover:border-rose-300 hover:bg-rose-100",
    iconActive: "bg-white/15 text-white",
    iconInactive: "bg-white text-rose-700",
    countActive: "bg-white/15 text-white",
    countInactive: "bg-white text-rose-800",
  },
  {
    active: "border-violet-700 bg-violet-700 text-white shadow-sm",
    inactive:
      "border-violet-200 bg-violet-50 text-violet-950 hover:border-violet-300 hover:bg-violet-100",
    iconActive: "bg-white/15 text-white",
    iconInactive: "bg-white text-violet-700",
    countActive: "bg-white/15 text-white",
    countInactive: "bg-white text-violet-800",
  },
  {
    active: "border-indigo-700 bg-indigo-700 text-white shadow-sm",
    inactive:
      "border-indigo-200 bg-indigo-50 text-indigo-950 hover:border-indigo-300 hover:bg-indigo-100",
    iconActive: "bg-white/15 text-white",
    iconInactive: "bg-white text-indigo-700",
    countActive: "bg-white/15 text-white",
    countInactive: "bg-white text-indigo-800",
  },
  {
    active: "border-emerald-700 bg-emerald-700 text-white shadow-sm",
    inactive:
      "border-emerald-200 bg-emerald-50 text-emerald-950 hover:border-emerald-300 hover:bg-emerald-100",
    iconActive: "bg-white/15 text-white",
    iconInactive: "bg-white text-emerald-700",
    countActive: "bg-white/15 text-white",
    countInactive: "bg-white text-emerald-800",
  },
]

function parseMoney(value: string) {
  const parsedValue = Number(value.replace(/,/g, "").trim())

  return Number.isFinite(parsedValue) ? Math.max(0, parsedValue) : 0
}

function getHeldSaleItemCount(heldSale: HeldSale) {
  return heldSale.items.reduce((sum, item) => sum + item.quantity, 0)
}

function getHeldSaleGrossSubtotal(heldSale: HeldSale) {
  return heldSale.items.reduce(
    (sum, item) => sum + item.price * item.quantity,
    0
  )
}

function getHeldSaleDiscountTotal(heldSale: HeldSale) {
  const grossSubtotal = getHeldSaleGrossSubtotal(heldSale)
  const discountValue = parseMoney(heldSale.discountValue)

  return Math.min(
    grossSubtotal,
    heldSale.discountMode === "Percent"
      ? grossSubtotal * (Math.min(100, discountValue) / 100)
      : discountValue
  )
}

function getHeldSaleTotal(heldSale: HeldSale, vatRate: number) {
  const subtotal = Math.max(
    0,
    getHeldSaleGrossSubtotal(heldSale) - getHeldSaleDiscountTotal(heldSale)
  )

  return subtotal + subtotal * vatRate
}

function normalizeBarcode(value: string) {
  return value.trim().replace(/\s+/g, "")
}

function formatVatRate(value: number) {
  const rate = value * 100

  return Number.isInteger(rate) ? `${rate}%` : `${rate.toFixed(2)}%`
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;")
}

export default function POSPage() {
  const [products, setProducts] = useState<Product[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [items, setItems] = useState<CartItem[]>([])
  const [heldSales, setHeldSales] = useState<HeldSale[]>(getHeldSales())
  const [customers, setCustomers] = useState<CustomerLedger[]>([])
  const [settings, setSettings] = useState<AppSettings>(getSettings())
  const [selectedCustomerId, setSelectedCustomerId] = useState("")
  const [selectedCategory, setSelectedCategory] = useState("All")
  const [search, setSearch] = useState("")
  const [scanCode, setScanCode] = useState("")
  const [scannerStatus, setScannerStatus] = useState("Scanner ready.")
  const [cameraActive, setCameraActive] = useState(false)
  const [paymentMethod, setPaymentMethod] =
    useState<PaymentMethod>("Cash")
  const [tenderMode, setTenderMode] = useState<TenderMode>("USD")
  const [paidUsd, setPaidUsd] = useState("")
  const [paidLbp, setPaidLbp] = useState("")
  const [discountMode, setDiscountMode] = useState<DiscountMode>("USD")
  const [discountValue, setDiscountValue] = useState("")
  const [changeCurrency, setChangeCurrency] =
    useState<ChangeCurrency>("USD")
  const [lastSale, setLastSale] = useState<LastSaleSummary | null>(null)
  const [isCartOpen, setIsCartOpen] = useState(false)
  const [cameraEngine, setCameraEngine] = useState<"native" | "html5" | null>(
    null
  )
  const [confirmAction, setConfirmAction] = useState<{
    title: string
    message: string
    confirmLabel: string
    confirmDestructive?: boolean
    onConfirm: () => void
  } | null>(null)

  const videoRef = useRef<HTMLVideoElement | null>(null)
  const productListRef = useRef<HTMLDivElement | null>(null)
  const scanCaptureInputRef = useRef<HTMLInputElement | null>(null)
  const scannerStreamRef = useRef<MediaStream | null>(null)
  const html5ScannerRef = useRef<Html5QrcodeInstance | null>(null)
  const cameraFrameRef = useRef<number | null>(null)
  const lastDetectedRef = useRef({
    code: "",
    at: 0,
  })

  useEffect(() => {
    let active = true

    getProducts().then((data) => {
      if (active) {
        setProducts(data)
        setIsLoading(false)
      }
    })

    const unsubscribe = subscribeProducts((data) => {
      if (active) {
        setProducts(data)
      }
    })
    const unsubscribeHeldSales = subscribeHeldSales((data) => {
      if (active) {
        setHeldSales(data)
      }
    })
    const refreshLedger = () => {
      if (active) {
        setCustomers(getCustomerLedger())
      }
    }
    const unsubscribeLedger = subscribeLedger(refreshLedger)
    const unsubscribeSettings = subscribeSettings(setSettings)

    refreshLedger()

    return () => {
      active = false
      unsubscribe()
      unsubscribeHeldSales()
      unsubscribeLedger()
      unsubscribeSettings()
    }
  }, [])

  useEffect(() => {
    if (paymentMethod === "Debt" && !selectedCustomerId && customers[0]) {
      setSelectedCustomerId(customers[0].id)
    }
  }, [customers, paymentMethod, selectedCustomerId])

  useEffect(() => {
    return () => {
      if (cameraFrameRef.current) {
        window.cancelAnimationFrame(cameraFrameRef.current)
      }

      scannerStreamRef.current?.getTracks().forEach((track) => track.stop())
      const scanner = html5ScannerRef.current

      html5ScannerRef.current = null
      if (scanner) {
        void scanner.stop().catch(() => undefined).finally(() => scanner.clear())
      }
    }
  }, [])

  const departmentSummaries = useMemo(() => {
    const categoryNames = [
      "All",
      "Favorites",
      ...Array.from(new Set(products.map((product) => product.category))),
    ]

    return categoryNames.map((category, index) => {
      const departmentProducts =
        category === "All"
          ? products
          : category === "Favorites"
            ? products.filter((product) => product.favorite)
          : products.filter((product) => product.category === category)
      const theme =
        category === "All"
          ? departmentThemes[0]
          : departmentThemes[((index - 1) % (departmentThemes.length - 1)) + 1]
      const Icon = departmentIcons[category] ?? PackageOpen

      return {
        name: category,
        label: category === "All" ? "All Items" : category,
        Icon,
        theme,
        productCount: departmentProducts.length,
        stockCount: departmentProducts.reduce(
          (sum, product) => sum + product.stock,
          0
        ),
      }
    })
  }, [products])

  const filteredProducts = useMemo(() => {
    const query = (search || scanCode).trim().toLowerCase()

    return products.filter((product) => {
      const matchesCategory =
        selectedCategory === "All" ||
        (selectedCategory === "Favorites" && product.favorite) ||
        product.category === selectedCategory

      const matchesSearch =
        query.length === 0 ||
        productMatchesSearch(product, query)

      return matchesCategory && matchesSearch
    })
      .sort((a, b) => Number(Boolean(b.favorite)) - Number(Boolean(a.favorite)))
  }, [products, scanCode, search, selectedCategory])
  const selectedDepartment =
    departmentSummaries.find(
      (department) => department.name === selectedCategory
    ) ?? departmentSummaries[0]

  const canApplyDiscount = userCan("sales.discount")
  const grossSubtotal = items.reduce(
    (sum, item) => sum + item.price * item.quantity,
    0
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
    (sum, heldSale) => sum + getHeldSaleItemCount(heldSale),
    0
  )
  const paidUsdAmount = tenderMode === "LBP" ? 0 : parseMoney(paidUsd)
  const paidLbpAmount = tenderMode === "USD" ? 0 : parseMoney(paidLbp)
  const paidTotalUsd =
    paidUsdAmount + lbpToUsd(paidLbpAmount, exchangeRate)
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

  function addItem(product: Product) {
    if (product.stock <= 0) {
      return
    }

    setItems((currentItems) => {
      const existingItem = currentItems.find((item) => item.id === product.id)

      if (existingItem) {
        if (existingItem.quantity >= product.stock) {
          return currentItems
        }

        return currentItems.map((item) =>
          item.id === product.id
            ? {
                ...item,
                quantity: item.quantity + 1,
              }
            : item
        )
      }

      return [
        ...currentItems,
        {
          ...product,
          quantity: 1,
        },
      ]
    })
  }

  function addProductToSale(product: Product, source: string) {
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
  }

  function handleScannedBarcode(value: string) {
    const barcode = normalizeBarcode(value)

    if (!barcode) {
      setScannerStatus("Scan a barcode first.")
      return
    }

    const product = findProductByBarcode(barcode)

    if (!product) {
      setScannerStatus(`Barcode ${barcode} was not found.`)
      return
    }

    addProductToSale(product, "barcode")
  }

  function quickAddProduct(value: string) {
    const query = value.trim().toLowerCase()
    const barcode = normalizeBarcode(value)

    if (!query) {
      setScannerStatus("Type, scan, or choose an item first.")
      return
    }

    const exactProduct = products.find(
      (product) =>
        productHasBarcode(product, barcode) ||
        product.name.toLowerCase() === query
    )
    const matchingProducts = products.filter((product) => {
      const matchesCategory =
        selectedCategory === "All" || product.category === selectedCategory

      return (
        matchesCategory &&
        productMatchesSearch(product, query || barcode)
      )
    })
    const product = exactProduct ?? matchingProducts[0]

    if (!product) {
      setScannerStatus(`No item found for ${value.trim()}.`)
      return
    }

    addProductToSale(product, exactProduct ? "barcode" : "quick add")
  }

  function toggleFavorite(product: Product) {
    toggleProductFavorite(product.id)
    setScannerStatus(
      product.favorite
        ? `${product.name} removed from favorites.`
        : `${product.name} added to favorites.`
    )
  }

  function selectDepartment(department: string) {
    setSelectedCategory(department)
    setSearch("")

    window.requestAnimationFrame(() => {
      productListRef.current?.scrollIntoView({
        block: "start",
        behavior: "smooth",
      })
    })
  }

  function increaseQuantity(id: number) {
    setItems((currentItems) =>
      currentItems.map((item) =>
        item.id === id && item.quantity < item.stock
          ? {
              ...item,
              quantity: item.quantity + 1,
            }
          : item
      )
    )
  }

  function decreaseQuantity(id: number) {
    setItems((currentItems) =>
      currentItems
        .map((item) =>
          item.id === id
            ? {
                ...item,
                quantity: item.quantity - 1,
              }
            : item
        )
        .filter((item) => item.quantity > 0)
    )
  }

  function removeItem(id: number) {
    setItems((currentItems) => currentItems.filter((item) => item.id !== id))
  }

  function resetTender() {
    setPaidUsd("")
    setPaidLbp("")
    setTenderMode("USD")
    setChangeCurrency("USD")
  }

  function resetDiscount() {
    setDiscountMode("USD")
    setDiscountValue("")
  }

  function clearCart() {
    setItems([])
  }

  function cleanSale() {
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
      title: "Clear current sale",
      message: `Clear ${formatNumber(itemCount)} items from the cart?`,
      confirmLabel: "Clear",
      onConfirm: () => {
        recordAuditEvent({
          action: "sale.void",
          entity: "sale",
          summary: `Current sale cleared before checkout with ${formatNumber(
            itemCount
          )} items.`,
          metadata: {
            itemCount,
            grossSubtotal,
            discountTotal,
          },
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
  }

  function holdCurrentSale() {
    if (items.length === 0) {
      setScannerStatus("Add items before holding a sale.")
      return
    }

    const heldSale = holdSale({
      items,
      paymentMethod,
      selectedCustomerId,
      discountMode,
      discountValue,
      note: selectedCustomer?.name ?? "Walk-in",
    })

    recordAuditEvent({
      action: "sale.hold",
      entity: "sale",
      summary: `${heldSale.holdNumber} held with ${formatNumber(
        itemCount
      )} items.`,
      metadata: {
        heldSaleId: heldSale.id,
        itemCount,
        discountTotal,
        total,
      },
    })
    clearCart()
    resetTender()
    resetDiscount()
    setSelectedCustomerId(customers[0]?.id ?? "")
    setPaymentMethod("Cash")
    setIsCartOpen(false)
    setScannerStatus(`${heldSale.holdNumber} held.`)
  }

  function resumeHeldSale(heldSale: HeldSale) {
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
      metadata: {
        heldSaleId: heldSale.id,
      },
    })
    setIsCartOpen(true)
    setScannerStatus(`${heldSale.holdNumber} resumed.`)
  }

  function discardHeldSale(heldSale: HeldSale) {
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
          metadata: {
            heldSaleId: heldSale.id,
          },
        })
        setScannerStatus(`${heldSale.holdNumber} discarded.`)
      },
    })
  }

  function selectTenderMode(mode: TenderMode) {
    setTenderMode(mode)

    if (mode === "USD") {
      setPaidLbp("")
    }

    if (mode === "LBP") {
      setPaidUsd("")
    }
  }

  function fillExactTender(currency: "USD" | "LBP") {
    if (currency === "USD") {
      setTenderMode("USD")
      setPaidUsd(total.toFixed(2))
      setPaidLbp("")
      setChangeCurrency("USD")
      return
    }

    setTenderMode("LBP")
    setPaidUsd("")
    setPaidLbp(String(Math.round(totalLbp)))
    setChangeCurrency("LBP")
  }

  async function startCameraScanner() {
    if (cameraActive) {
      stopCameraScanner()
      return
    }

    const liveCameraIssue = getLiveCameraIssue()

    if (liveCameraIssue) {
      setScannerStatus(`${liveCameraIssue} Opening scanner capture instead.`)
      scanCaptureInputRef.current?.click()
      return
    }

    try {
      const detector = await createBarcodeDetector()

      if (!detector) {
        setCameraActive(true)
        setCameraEngine("html5")
        setScannerStatus("Starting bundled camera scanner...")
        await new Promise<void>((resolve) =>
          window.requestAnimationFrame(() => resolve())
        )

        const scanner = await createHtml5Qrcode(POS_CAMERA_READER_ID)

        if (!scanner) {
          stopCameraScanner()
          setScannerStatus(
            "Camera scanner engine could not load. Use USB scan or manual entry."
          )
          return
        }

        html5ScannerRef.current = scanner
        await scanner.start(
          {
            facingMode: "environment",
          },
          {
            fps: 12,
            qrbox: {
              width: 260,
              height: 160,
            },
            formatsToSupport: getHtml5QrcodeFormatCodes(),
          },
          (decodedText) => {
            const now = Date.now()

            if (
              decodedText &&
              (lastDetectedRef.current.code !== decodedText ||
                now - lastDetectedRef.current.at > 1500)
            ) {
              lastDetectedRef.current = {
                code: decodedText,
                at: now,
              }
              handleScannedBarcode(decodedText)
            }
          }
        )
        setScannerStatus("Camera scanner active. Point at a barcode.")
        return
      }

      const stream = await navigator.mediaDevices.getUserMedia(
        getPreferredCameraConstraints()
      )
      const video = videoRef.current

      if (!video) {
        stream.getTracks().forEach((track) => track.stop())
        setScannerStatus("Camera preview is not ready.")
        return
      }

      scannerStreamRef.current = stream
      video.srcObject = stream
      video.setAttribute("playsinline", "true")
      video.muted = true
      await video.play()
      setCameraEngine("native")
      setCameraActive(true)
      setScannerStatus("Camera scanner active. Point at a barcode.")

      const scanFrame = async () => {
        const currentVideo = videoRef.current

        if (!currentVideo || !scannerStreamRef.current) {
          return
        }

        try {
          const codes = await detector.detect(currentVideo)
          const code = codes[0]?.rawValue
          const now = Date.now()

          if (
            code &&
            (lastDetectedRef.current.code !== code ||
              now - lastDetectedRef.current.at > 1500)
          ) {
            lastDetectedRef.current = {
              code,
              at: now,
            }
            handleScannedBarcode(code)
          }
        } catch {
          // Some browsers throw while the video frame is still warming up.
        }

        cameraFrameRef.current = window.requestAnimationFrame(scanFrame)
      }

      cameraFrameRef.current = window.requestAnimationFrame(scanFrame)
    } catch (error) {
      stopCameraScanner()
      setScannerStatus(
        `${getCameraErrorMessage(error)} Try USB scan or manual entry.`
      )
    }
  }

  async function handleScanCapture(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0]

    event.currentTarget.value = ""

    if (!file) {
      return
    }

    try {
      setScannerStatus("Reading barcode...")
      const barcode = await detectBarcodeFromImageFile(file)

      if (!barcode) {
        setScannerStatus("No barcode found. Try closer and brighter.")
        return
      }

      handleScannedBarcode(barcode)
    } catch {
      setScannerStatus("Scanner capture could not read this image.")
    }
  }

  function stopCameraScanner() {
    if (cameraFrameRef.current) {
      window.cancelAnimationFrame(cameraFrameRef.current)
      cameraFrameRef.current = null
    }

    scannerStreamRef.current?.getTracks().forEach((track) => track.stop())
    scannerStreamRef.current = null
    const scanner = html5ScannerRef.current

    html5ScannerRef.current = null
    if (scanner) {
      void scanner.stop().catch(() => undefined).finally(() => scanner.clear())
    }

    if (videoRef.current) {
      videoRef.current.srcObject = null
    }

    setCameraEngine(null)
    setCameraActive(false)
    setScannerStatus("Camera scanner stopped.")
  }

  function completeSale() {
    if (checkoutBlocked) {
      return
    }

    const saleNumber = `S-${Date.now().toString().slice(-6)}`
    const batchAllocations = consumeInventoryBatches(
      items.map((item) => ({
        productId: item.id,
        productName: item.name,
        barcode: item.barcode,
        quantity: item.quantity,
        fallbackUnitCost: item.cost,
      }))
    )
    const saleItems = items.map((item) => {
      const allocations = batchAllocations.get(item.id) ?? []
      const allocatedQuantity = allocations.reduce(
        (sum, allocation) => sum + allocation.quantity,
        0
      )
      const allocatedCost = allocations.reduce(
        (sum, allocation) =>
          sum + allocation.unitCost * allocation.quantity,
        0
      )
      const unitCost =
        allocatedQuantity > 0 ? allocatedCost / allocatedQuantity : item.cost

      return {
      id: item.id,
      name: item.name,
      barcode: item.barcode,
      cost: unitCost,
      quantity: item.quantity,
      unitPrice: item.price,
      total: item.price * item.quantity,
      batchAllocations: allocations,
    }
    })
    const tender: SaleTender | undefined =
      paymentMethod === "Cash"
        ? {
            currency: tenderMode,
            exchangeRate,
            paidUsd: paidUsdAmount,
            paidLbp: paidLbpAmount,
            paidTotalUsd,
            paidTotalLbp,
            changeUsd: cashChangeUsd,
            changeLbp: cashChangeLbp,
            changeCurrency,
          }
        : undefined
    const customerBalanceBefore = selectedCustomer?.balance ?? 0
    const customerBalanceAfter =
      paymentMethod === "Debt" ? customerBalanceBefore + total : undefined

    recordSale({
      saleNumber,
      paymentMethod,
      customerId: selectedCustomer?.id,
      customerName: selectedCustomer?.name,
      subtotal,
      discountTotal,
      tax,
      total,
      tender,
      items: saleItems,
    })

    if (discountTotal > 0) {
      recordAuditEvent({
        action: "sale.discount",
        entity: "sale",
        summary: `${saleNumber} received a ${formatCurrency(
          discountTotal
        )} discount.`,
        metadata: {
          saleNumber,
          grossSubtotal,
          discountMode,
          discountValue,
          discountTotal,
        },
      })
    }

    if (paymentMethod === "Debt" && selectedCustomer) {
      recordDebtSale({
        customerId: selectedCustomer.id,
        saleNumber,
        subtotal,
        discountTotal,
        tax,
        total,
        items: saleItems,
      })
      setCustomers(getCustomerLedger())
    }

    setProducts(
      decreaseProductStock(
        items.map((item) => ({
          productId: item.id,
          quantity: item.quantity,
        }))
      )
    )

    setLastSale({
      number: saleNumber,
      paymentMethod,
      customerName: selectedCustomer?.name,
      grossSubtotal,
      subtotal,
      discountTotal,
      tax,
      total,
      totalLbp,
      exchangeRate,
      tender,
      customerBalanceBefore:
        paymentMethod === "Debt" ? customerBalanceBefore : undefined,
      customerBalanceAfter,
      items,
    })
    clearCart()
    resetTender()
    resetDiscount()
    setScanCode("")
    setSearch("")
    setIsCartOpen(false)
    setScannerStatus("Sale completed. Scanner ready for the next sale.")
  }

  function printReceipt() {
    if (!lastSale) {
      return
    }

    const receiptWindow = window.open("", "lebanonpos-receipt")

    if (!receiptWindow) {
      return
    }

    const lineItems = lastSale.items
      .map(
        (item) => `
          <tr>
            <td>
              <strong>${escapeHtml(item.name)}</strong><br />
              <span>${escapeHtml(item.barcode)}</span>
            </td>
            <td>${item.quantity}</td>
            <td>${formatCurrency(item.price)}</td>
            <td>${formatCurrency(item.price * item.quantity)}</td>
          </tr>
        `
      )
      .join("")
    const tenderRows = lastSale.tender
      ? `
        <tr><td>Paid USD</td><td>${formatUsdCurrency(
          lastSale.tender.paidUsd
        )}</td></tr>
        <tr><td>Paid LBP</td><td>${formatLbpCurrency(
          lastSale.tender.paidLbp
        )}</td></tr>
        <tr><td>Total paid</td><td>${formatUsdCurrency(
          lastSale.tender.paidTotalUsd
        )} / ${formatLbpCurrency(lastSale.tender.paidTotalLbp)}</td></tr>
        <tr><td>Change USD</td><td>${formatUsdCurrency(
          lastSale.tender.changeUsd
        )}</td></tr>
        <tr><td>Change LBP</td><td>${formatLbpCurrency(
          lastSale.tender.changeLbp
        )}</td></tr>
        <tr><td>Return change as</td><td>${lastSale.tender.changeCurrency}</td></tr>
      `
      : ""
    const customerRows =
      lastSale.customerBalanceAfter !== undefined
        ? `
          <tr><td>Customer</td><td>${escapeHtml(
            lastSale.customerName ?? ""
          )}</td></tr>
          <tr><td>Previous balance</td><td>${formatCurrency(
            lastSale.customerBalanceBefore ?? 0
          )}</td></tr>
          <tr><td>New balance</td><td>${formatCurrency(
            lastSale.customerBalanceAfter
          )}</td></tr>
        `
        : ""
    const discountRows =
      lastSale.discountTotal > 0
        ? `
          <tr><td>Items subtotal</td><td>${formatCurrency(
            lastSale.grossSubtotal
          )}</td></tr>
          <tr><td>Discount</td><td>-${formatCurrency(
            lastSale.discountTotal
          )}</td></tr>
        `
        : ""

    receiptWindow.document.write(`
      <!doctype html>
      <html>
        <head>
          <title>${lastSale.number}</title>
          <style>
            @page { size: 80mm auto; margin: 4mm; }
            body { font-family: Arial, sans-serif; color: #000; margin: 0; }
            h1 { font-size: 18px; margin: 0 0 4px; text-align: center; }
            p { margin: 2px 0; font-size: 12px; text-align: center; }
            table { width: 100%; border-collapse: collapse; margin-top: 10px; font-size: 12px; }
            td, th { border-bottom: 1px dashed #999; padding: 5px 0; vertical-align: top; }
            th { text-align: left; }
            td:nth-child(2), td:nth-child(3), td:nth-child(4),
            th:nth-child(2), th:nth-child(3), th:nth-child(4) { text-align: right; }
            .summary td:first-child { text-align: left; }
            .summary td:last-child { text-align: right; font-weight: 700; }
            .total { font-size: 16px; font-weight: 700; margin-top: 10px; text-align: right; }
            .muted { color: #444; font-size: 11px; }
          </style>
        </head>
        <body>
          <h1>${escapeHtml(settings.storeName)}</h1>
          <p>${escapeHtml(settings.branchName)}</p>
          <p>${escapeHtml(settings.phone)}</p>
          <p>${escapeHtml(settings.address)}</p>
          <p>Receipt ${lastSale.number}</p>
          <p>${new Date().toLocaleString("en-LB")}</p>
          <table>
            <thead>
              <tr><th>Item</th><th>Qty</th><th>Each</th><th>Total</th></tr>
            </thead>
            <tbody>${lineItems}</tbody>
          </table>
          <table class="summary">
            ${discountRows}
            <tr><td>Subtotal</td><td>${formatCurrency(lastSale.subtotal)}</td></tr>
            <tr><td>VAT ${formatVatRate(settings.vatRate)}</td><td>${formatCurrency(
              lastSale.tax
            )}</td></tr>
            <tr><td>Total USD</td><td>${formatCurrency(lastSale.total)}</td></tr>
            <tr><td>Total LBP</td><td>${formatLbpCurrency(
              lastSale.totalLbp
            )}</td></tr>
            <tr><td>Payment</td><td>${lastSale.paymentMethod}</td></tr>
            <tr><td>Rate</td><td>1 USD = ${formatLbpCurrency(
              lastSale.exchangeRate
            )}</td></tr>
            ${tenderRows}
            ${customerRows}
          </table>
          <p class="muted">${escapeHtml(settings.receiptFooter)}</p>
        </body>
      </html>
    `)
    receiptWindow.document.close()
    receiptWindow.focus()
    window.setTimeout(() => receiptWindow.print(), 250)
  }

  return (
    <main className="relative min-h-0 flex-1 overflow-hidden bg-[#eef3f2]">
      <section className="flex h-full min-w-0 flex-col gap-3 overflow-y-auto p-3 pb-28 sm:p-4 xl:p-5">
        <LastSaleBanner
          sale={lastSale}
          onNewSale={cleanSale}
          onPrintReceipt={printReceipt}
        />

        <div className="rounded-lg border border-zinc-200 bg-white p-3 shadow-sm">
          <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-end">
            <label className="relative min-w-0">
              <span className="mb-2 block text-sm font-bold text-zinc-700">
                Quick add to cart
              </span>
              <Search
                size={22}
                className="pointer-events-none absolute bottom-4 left-4 text-zinc-400"
              />
              <input
                autoFocus
                value={scanCode}
                onChange={(event) => setScanCode(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault()
                    quickAddProduct(scanCode)
                  }
                }}
                placeholder="Scan barcode or type item name"
                className="h-14 w-full rounded-lg border border-zinc-200 bg-zinc-50 pl-12 pr-4 text-lg font-semibold text-zinc-950 outline-none transition placeholder:text-zinc-400 focus:border-emerald-400 focus:bg-white focus:ring-4 focus:ring-emerald-100"
              />
            </label>

            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:flex">
              <button
                type="button"
                onClick={() => quickAddProduct(scanCode)}
                className="flex h-12 touch-manipulation items-center justify-center gap-2 rounded-lg bg-zinc-950 px-4 text-base font-bold text-white transition hover:bg-zinc-800 sm:h-14 sm:px-5"
              >
                <ScanBarcode size={19} />
                Add
              </button>
              <button
                type="button"
                onClick={() => setIsCartOpen(true)}
                className="flex h-12 touch-manipulation items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 text-base font-bold text-white shadow-sm transition hover:bg-emerald-500 sm:h-14 sm:px-5"
              >
                <ShoppingCart size={19} />
                Cart {formatNumber(itemCount)}
              </button>
              <button
                type="button"
                onClick={startCameraScanner}
                className={`flex h-12 touch-manipulation items-center justify-center gap-2 rounded-lg border px-4 text-base font-bold transition sm:h-14 ${
                  cameraActive
                    ? "border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100"
                    : "border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50"
                }`}
              >
                <ScanBarcode size={19} />
                {cameraActive ? "Stop" : "Scan"}
              </button>
              <button
                type="button"
                onClick={cleanSale}
                className="flex h-12 touch-manipulation items-center justify-center gap-2 rounded-lg border border-zinc-200 bg-white px-4 text-base font-bold text-zinc-700 transition hover:bg-zinc-50 sm:h-14"
              >
                <Eraser size={19} />
                Clean
              </button>
            </div>
          </div>

          <div className="mt-3 grid gap-2 text-sm font-bold md:grid-cols-[minmax(0,1fr)_repeat(3,auto)]">
            <p className="rounded-lg bg-zinc-50 px-3 py-2 text-zinc-600">
              {scannerStatus}
            </p>
            <span className="rounded-lg bg-white px-3 py-2 text-zinc-600 ring-1 ring-zinc-200">
              {formatNumber(filteredProducts.length)} shown
            </span>
            <span className="rounded-lg bg-white px-3 py-2 text-zinc-600 ring-1 ring-zinc-200">
              Cart {formatNumber(itemCount)}
            </span>
            <span className="rounded-lg bg-emerald-50 px-3 py-2 text-emerald-800">
              1 USD = {formatLbpCurrency(exchangeRate)}
            </span>
          </div>

          <video
            ref={videoRef}
            muted
            playsInline
            className={`mt-3 aspect-video w-full rounded-lg border border-zinc-200 bg-zinc-950 object-cover ${
              cameraActive && cameraEngine === "native" ? "block" : "hidden"
            }`}
          />
          <div
            id={POS_CAMERA_READER_ID}
            className={`mt-3 overflow-hidden rounded-lg border border-zinc-200 bg-zinc-950 ${
              cameraActive && cameraEngine === "html5" ? "block" : "hidden"
            }`}
          />
          <input
            ref={scanCaptureInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            onChange={handleScanCapture}
            className="hidden"
          />
        </div>

        <DepartmentTabs
          departments={departmentSummaries.map((d) => ({
            name: d.name,
            label: d.label,
            Icon: d.Icon,
            theme: d.theme,
            productCount: d.productCount,
          }))}
          selected={selectedCategory}
          onSelect={selectDepartment}
        />

        <div
          ref={productListRef}
          className="flex scroll-mt-5 items-center justify-between"
        >
          <div>
            <h3 className="text-xl font-bold text-zinc-950">
              {selectedDepartment?.label ?? "Quick Sale"}
            </h3>
            <p className="text-sm text-zinc-500">
              Tap an item, scan, or type above to sell fast.
            </p>
          </div>
        </div>

        <div className="min-h-0 lg:flex-1 lg:overflow-y-auto lg:pr-1">
          {isLoading ? (
            <div className="flex h-full min-h-80 items-center justify-center">
              <div className="text-center">
                <div className="mx-auto h-10 w-10 animate-spin rounded-full border-4 border-zinc-200 border-t-zinc-950" />
                <p className="mt-4 text-sm font-medium text-zinc-500">Loading products...</p>
              </div>
            </div>
          ) : filteredProducts.length > 0 ? (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-3 pb-4 sm:grid-cols-[repeat(auto-fill,minmax(180px,1fr))] xl:grid-cols-[repeat(auto-fill,minmax(220px,1fr))] xl:gap-4">
              {filteredProducts.map((product) => (
                <ProductCard
                  key={product.id}
                  product={product}
                  onClick={() => addProductToSale(product, "tap")}
                  onFavoriteToggle={() => toggleFavorite(product)}
                />
              ))}
            </div>
          ) : (
            <div className="flex h-full min-h-80 items-center justify-center rounded-lg border border-dashed border-zinc-300 bg-white">
              <div className="text-center">
                <PackageSearch
                  size={42}
                  className="mx-auto text-zinc-300"
                />
                <p className="mt-3 font-bold text-zinc-900">
                  No products found
                </p>
                <p className="mt-1 text-sm text-zinc-500">
                  Try another search or category.
                </p>
              </div>
            </div>
          )}
        </div>
      </section>

      <button
        type="button"
        onClick={() => setIsCartOpen(true)}
        className="absolute bottom-20 left-3 right-3 z-30 flex items-center justify-between gap-3 rounded-lg bg-zinc-950 px-4 py-3 text-left text-white shadow-2xl transition hover:bg-zinc-800 md:bottom-5 md:left-auto md:right-5 md:min-w-64 md:px-5 md:py-4"
      >
        <span className="flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-lg bg-emerald-400 text-zinc-950">
            <ShoppingCart size={22} />
          </span>
          <span>
            <span className="block text-sm font-semibold text-zinc-300">
              Cart / Checkout
            </span>
            <span className="block text-xl font-bold">
              {formatCurrency(total)}
            </span>
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-2">
          {heldSales.length > 0 ? (
            <span className="rounded-full bg-sky-100 px-3 py-1 text-xs font-bold text-sky-900">
              Held {formatNumber(heldSales.length)}
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
        changeCurrency={changeCurrency}
        onChangeCurrencyChange={setChangeCurrency}
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
    </main>
  )
}

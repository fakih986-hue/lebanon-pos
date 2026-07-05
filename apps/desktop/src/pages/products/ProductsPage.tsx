import { useEffect, useMemo, useState } from "react"
import { useDebounce } from "../../hooks/useDebounce"
import type { Product } from "../../features/pos/types/product"
import { ImagePlus, Plus, Download, SlidersHorizontal, X } from "lucide-react"
import KpiCards from "../../features/pos/components/KpiCards"
import AlertsPanel from "../../features/pos/components/AlertsPanel"
import StockControlPanel from "../../features/pos/components/StockControlPanel"
import ProductSetupForm from "../../features/pos/components/ProductSetupForm"
import ProductTable from "../../features/pos/components/ProductTable"
import Spinner from "../../components/ui/Spinner"
import WorkspaceTabs from "../../components/ui/WorkspaceTabs"
import { getApiUrl, getAuthToken } from "../../features/pos/services/sync.service"

import { formatCurrency, formatNumber } from "../../features/pos/lib/currency"
import {
  getInventoryBatches,
  subscribeInventoryBatches,
} from "../../features/pos/services/inventoryBatch.service"
import {
  getStockAdjustments,
  recordStockAdjustment,
  subscribeStockAdjustments,
type StockAdjustmentReason,
} from "../../features/pos/services/inventoryAdjustment.service"
import {
  createProduct,
  deleteProduct,
  getProducts,
  productMatchesSearch,
  renameCategory,
  subscribeProducts,
  updateProduct,
} from "../../features/pos/services/product.service"
import ConfirmDialog from "../../components/ConfirmDialog"
import { subscribeSales } from "../../features/pos/services/sales.service"
import {
  getSupplierLedger,
  subscribeSuppliers,
  type SupplierLedger,
} from "../../features/pos/services/supplier.service"
import {
  getDeadStockItems,
  getExpiryAlerts,
  getPromoSuggestions,
  getReorderSuggestions,
  groupReorderSuggestionsBySupplier,
} from "../../features/pos/services/stock.service"
import {
  completeStockCount,
  getStockCounts,
  startStockCount,
  subscribeStockCounts,
  updateStockCountLine,
  type StockCountSession,
} from "../../features/pos/services/stockCount.service"
import { showToast } from "../../features/pos/services/toast.service"
import { useI18n } from "@lebanonpos/shared"
type ProductWorkspaceView = "Catalog" | "Categories" | "Alerts" | "Control" | "Lots" | "Setup"

function normalizeNumber(value: string) {
  const parsedValue = Number(value)

  return Number.isFinite(parsedValue) ? Math.max(0, parsedValue) : 0
}

function normalizeBarcode(value: string) {
  return value.trim().replace(/\s+/g, "")
}

function parseBarcodeAliases(value: string, primaryBarcode?: string) {
  return Array.from(
    new Set(
      value
        .split(/[\n,]+/)
        .map(normalizeBarcode)
        .filter((barcode) => barcode && barcode !== primaryBarcode)
    )
  )
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-LB", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value))
}

export default function ProductsPage({ initialTab }: { initialTab?: ProductWorkspaceView } = {}) {
  const [products, setProducts] = useState<Product[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [suppliers, setSuppliers] =
    useState<SupplierLedger[]>(getSupplierLedger())
  const [search, setSearch] = useState("")
  const debouncedSearch = useDebounce(search, 200)
  const [selectedCategory, setSelectedCategory] = useState("All")
  const [selectedProductId, setSelectedProductId] = useState<number | null>(null)
  const [productCategory, setProductCategory] = useState("")
  const [productImage, setProductImage] = useState("")
  const [productSupplierId, setProductSupplierId] = useState("")
  const [reorderPoint, setReorderPoint] = useState("")
  const [reorderQuantity, setReorderQuantity] = useState("")
  const [expiryDate, setExpiryDate] = useState("")
  const [barcodeAliases, setBarcodeAliases] = useState("")
  const [categoryFrom, setCategoryFrom] = useState("")
  const [categoryTo, setCategoryTo] = useState("")
  const [generatingImages, setGeneratingImages] = useState(false)
  const [genImageStatus, setGenImageStatus] = useState<string | null>(null)
  const [adjustmentProductId, setAdjustmentProductId] = useState<number | null>(
    null
  )
  const [adjustmentMode, setAdjustmentMode] = useState<"Add" | "Remove">(
    "Remove"
  )
  const [adjustmentQuantity, setAdjustmentQuantity] = useState("")
  const [adjustmentReason, setAdjustmentReason] =
    useState<StockAdjustmentReason>("Damage")
  const [adjustmentBatchId, setAdjustmentBatchId] = useState("")
  const [adjustmentNote, setAdjustmentNote] = useState("")
  const [stockCounts, setStockCounts] =
    useState<StockCountSession[]>(getStockCounts())
  const [countSearch, setCountSearch] = useState("")
  const debouncedCountSearch = useDebounce(countSearch, 200)
  const [countProductId, setCountProductId] = useState<number | null>(null)
  const [countedQuantity, setCountedQuantity] = useState("")
  const [activeProductView, setActiveProductView] =
    useState<ProductWorkspaceView>(initialTab ?? "Catalog")
  const [batchVersion, setBatchVersion] = useState(0)
  const [controlVersion, setControlVersion] = useState(0)
  const [deleteProductId, setDeleteProductId] = useState<number | null>(null)
  const [editProduct, setEditProduct] = useState<Product | null>(null)
  const [editName, setEditName] = useState("")
  const [editCategory, setEditCategory] = useState("")
  const [editPrice, setEditPrice] = useState("")
  const [editCost, setEditCost] = useState("")
  const [editBarcode, setEditBarcode] = useState("")
  const [editStock, setEditStock] = useState("")
  const [editReorderPoint, setEditReorderPoint] = useState("")
  const [editReorderQty, setEditReorderQty] = useState("")
  const [editBarcodeAliases, setEditBarcodeAliases] = useState("")
  const [bulkEditOpen, setBulkEditOpen] = useState(false)
  const [bulkEditCategory, setBulkEditCategory] = useState("All")
  const [bulkEditField, setBulkEditField] = useState<"price" | "cost">("price")
  const [bulkEditMode, setBulkEditMode] = useState<"percent" | "fixed">("percent")
  const [bulkEditValue, setBulkEditValue] = useState("")
  const [isParent, setIsParent] = useState(false)
  const [variantName, setVariantName] = useState("")
  const [newVariantName, setNewVariantName] = useState("")
  const [newVariantPrice, setNewVariantPrice] = useState("")
  const [newVariantStock, setNewVariantStock] = useState("")
  const [newVariantBarcode, setNewVariantBarcode] = useState("")
  const [deleteVariantId, setDeleteVariantId] = useState<number | null>(null)
  const { t } = useI18n()

  useEffect(() => {
    let active = true

    getProducts()
      .then((data) => {
        if (active) {
          setProducts(data)
          setIsLoading(false)
        }
      })
      .catch(() => {
        if (active) setIsLoading(false)
      })

    const unsubscribe = subscribeProducts((data) => {
      if (active) {
        setProducts(data)
      }
    })
    const unsubscribeSuppliers = subscribeSuppliers(() => {
      if (active) {
        setSuppliers(getSupplierLedger())
      }
    })
    const unsubscribeSales = subscribeSales(() => {
      if (active) {
        setProducts((currentProducts) => [...currentProducts])
      }
    })
    const unsubscribeBatches = subscribeInventoryBatches(() =>
      setBatchVersion((version) => version + 1)
    )
    const unsubscribeAdjustments = subscribeStockAdjustments(() =>
      setControlVersion((version) => version + 1)
    )
    const unsubscribeCounts = subscribeStockCounts(() => {
      setStockCounts(getStockCounts())
      setControlVersion((version) => version + 1)
    })

    return () => {
      active = false
      unsubscribe()
      unsubscribeSuppliers()
      unsubscribeSales()
      unsubscribeBatches()
      unsubscribeAdjustments()
      unsubscribeCounts()
    }
  }, [])

  const categories = useMemo(
    () => ["All", ...Array.from(new Set(products.map((p) => p.category)))],
    [products, batchVersion]
  )

  const filteredProducts = useMemo(() => {
    const query = search.trim().toLowerCase()

    return products.filter((product) => {
      const matchesCategory =
        selectedCategory === "All" || product.category === selectedCategory
      const matchesSearch =
        query.length === 0 || productMatchesSearch(product, query)

      return matchesCategory && matchesSearch
    })
  }, [products, debouncedSearch, selectedCategory])
  const selectedProduct =
    products.find((product) => product.id === selectedProductId) ?? products[0]
  const adjustmentProduct =
    products.find((product) => product.id === adjustmentProductId) ??
    selectedProduct
  const reorderSuggestions = useMemo(
    () => getReorderSuggestions(products),
    [products, batchVersion]
  )
  const activeStockCount = useMemo(
    () => stockCounts.find((session) => session.status === "Draft"),
    [stockCounts, controlVersion]
  )
  const recentAdjustments = useMemo(
    () => getStockAdjustments().slice(0, 6),
    [controlVersion, products]
  )
  const countLines = useMemo(() => {
    const query = countSearch.trim().toLowerCase()
    const lines = activeStockCount?.lines ?? []

    return lines
      .filter(
        (line) =>
          !query ||
          line.productName.toLowerCase().includes(query) ||
          line.barcode.includes(normalizeBarcode(query)) ||
          line.category.toLowerCase().includes(query)
      )
      .slice(0, 7)
      }, [activeStockCount, debouncedCountSearch])
  const reorderGroups = useMemo(
    () => groupReorderSuggestionsBySupplier(reorderSuggestions),
    [reorderSuggestions]
  )
  const parentVariants = useMemo(
    () => products.filter((p) => p.parentId === selectedProduct?.id),
    [products, selectedProduct?.id]
  )
  const expiryAlerts = useMemo(() => getExpiryAlerts(products, 30), [products])
  const deadStockItems = useMemo(() => getDeadStockItems(products, 60), [products])
  const promoSuggestions = useMemo(() => getPromoSuggestions(products), [products])
  const openBatches = useMemo(
    () =>
      getInventoryBatches()
        .filter((batch) => batch.quantityRemaining > 0)
        .sort((a, b) => {
          const aExpiry = a.expiryDate || "9999-12-31"
          const bExpiry = b.expiryDate || "9999-12-31"

          return aExpiry.localeCompare(bExpiry)
        }),
    [products]
  )
  const selectedProductBatches = useMemo(
    () =>
      openBatches.filter(
        (batch) => batch.productId === adjustmentProduct?.id
      ),
    [adjustmentProduct?.id, openBatches]
  )
  const urgentReorders = reorderSuggestions.filter(
    (suggestion) => suggestion.suggestedQuantity > 0
  )

  const totalStock = products.reduce((sum, product) => sum + product.stock, 0)
  const totalValue = products.reduce(
    (sum, product) => sum + product.stock * product.cost,
    0
  )
  const lowStockCount = products.filter(
    (product) => product.stock <= (product.reorderPoint ?? 10)
  ).length
  const productViews: Array<{
    label: ProductWorkspaceView
    count?: number
  }> = [
    {
      label: "Catalog",
      count: filteredProducts.length,
    },
    {
      label: "Categories",
      count: categories.length - 1,
    },
    {
      label: "Alerts",
      count: reorderSuggestions.length + expiryAlerts.length,
    },
    {
      label: "Control",
      count: activeStockCount ? 1 : recentAdjustments.length,
    },
    {
      label: "Lots",
      count: openBatches.length,
    },
    {
      label: "Setup",
    },
  ]

  useEffect(() => {
    if (!selectedProduct) {
      return
    }

    setSelectedProductId(selectedProduct.id)
    setProductCategory(selectedProduct.category)
    setProductImage(selectedProduct.image ?? "")
    setProductSupplierId(selectedProduct.supplierId ?? "")
    setReorderPoint(String(selectedProduct.reorderPoint ?? 10))
    setReorderQuantity(String(selectedProduct.reorderQuantity ?? 20))
    setExpiryDate(selectedProduct.expiryDate ?? "")
    setBarcodeAliases((selectedProduct.barcodeAliases ?? []).join("\n"))
    setIsParent(selectedProduct.isParent ?? false)
    setVariantName(selectedProduct.variantName ?? "")
    setAdjustmentProductId((currentId) => currentId ?? selectedProduct.id)
    setCountProductId((currentId) => currentId ?? selectedProduct.id)
  }, [selectedProduct])

  function buildSupplierOrderMessage(
    group: ReturnType<typeof groupReorderSuggestionsBySupplier>[number]
  ) {
    const lines = group.items
      .filter((item) => item.suggestedQuantity > 0)
      .map(
        (item) =>
          `- ${item.product.name}: ${formatNumber(
            item.suggestedQuantity
          )} units (${item.product.barcode})`
      )

    return [
      `Purchase order request - ${group.supplierName}`,
      `Estimated cost: ${formatCurrency(group.totalCost)}`,
      "",
      ...lines,
    ].join("\n")
  }

  async function copySupplierOrder(
    group: ReturnType<typeof groupReorderSuggestionsBySupplier>[number]
  ) {
    const message = buildSupplierOrderMessage(group)

    try {
      await navigator.clipboard.writeText(message)
      showToast(`${group.supplierName} order copied.`)
    } catch {
      showToast("Clipboard blocked. Use WhatsApp to share the order.", "error")
    }
  }

  function saveProductSetup() {
    if (!selectedProduct) {
      return
    }

    const supplier = suppliers.find(
      (currentSupplier) => currentSupplier.id === productSupplierId
    )
    const aliases = parseBarcodeAliases(barcodeAliases, selectedProduct.barcode)
    const duplicateAlias = aliases.find((alias) =>
      products.some(
        (product) =>
          product.id !== selectedProduct.id &&
          (product.barcode === alias ||
            (product.barcodeAliases ?? []).includes(alias))
      )
    )

    if (duplicateAlias) {
      showToast(`Barcode ${duplicateAlias} already belongs to another product.`, "error")
      return
    }

    updateProduct(selectedProduct.id, {
      category: productCategory,
      supplierId: supplier?.id ?? "",
      supplierName: supplier?.name ?? "",
      reorderPoint: normalizeNumber(reorderPoint),
      reorderQuantity: normalizeNumber(reorderQuantity),
      expiryDate,
      barcodeAliases: aliases,
      isParent: !!isParent,
      variantName: variantName?.trim() || undefined,
      image: productImage || undefined,
    })
    showToast(`${selectedProduct.name} setup saved.`)
  }

  function openProductEdit(product: Product) {
    setEditProduct(product)
    setEditName(product.name)
    setEditCategory(product.category)
    setEditPrice(String(product.price))
    setEditCost(String(product.cost))
    setEditBarcode(product.barcode ?? "")
    setEditBarcodeAliases((product.barcodeAliases ?? []).join(", "))
    setEditStock(String(product.stock))
    setEditReorderPoint(String(product.reorderPoint ?? 10))
    setEditReorderQty(String(product.reorderQuantity ?? 20))
  }

  function saveProductEdit() {
    if (!editProduct) return
    updateProduct(editProduct.id, {
      name: editName,
      category: editCategory,
      price: normalizeNumber(editPrice),
      cost: normalizeNumber(editCost),
      barcode: editBarcode || undefined,
      barcodeAliases: editBarcodeAliases.split(",").map((a: string) => a.trim()).filter((a: string) => a.length > 0),
      stock: normalizeNumber(editStock),
      reorderPoint: normalizeNumber(editReorderPoint),
      reorderQuantity: normalizeNumber(editReorderQty),
    })
    showToast(`${editName} updated.`)
    setEditProduct(null)
  }

  function applyBulkPriceEdit() {
    const val = parseFloat(bulkEditValue)
    if (isNaN(val) || val <= 0) { showToast("Enter a valid value.", "error"); return }
    const targets = products.filter((p) => !p.isParent && (bulkEditCategory === "All" || p.category === bulkEditCategory))
    for (const p of targets) {
      const current = bulkEditField === "price" ? p.price : p.cost
      let next: number
      if (bulkEditMode === "percent") {
        next = current * (1 + val / 100)
      } else {
        next = current + val
      }
      if (next < 0) next = 0
      updateProduct(p.id, { [bulkEditField]: Math.round(next * 100) / 100 })
    }
    showToast(`Updated ${bulkEditField} for ${targets.length} products.`)
    setBulkEditOpen(false)
    setBulkEditValue("")
  }

  function toggleFavorite(product: Product) {
    updateProduct(product.id, {
      favorite: !product.favorite,
    })
    showToast(
      product.favorite
        ? `${product.name} removed from POS favorites.`
        : `${product.name} added to POS favorites.`
    )
  }

  async function generateProductImages() {
    const apiUrl = getApiUrl()
    const token = getAuthToken()
    if (!apiUrl || !token) {
      showToast("Connect to server first in Settings.", "error")
      return
    }

    setGeneratingImages(true)
    setGenImageStatus(null)
    try {
      const res = await fetch(`${apiUrl}/api/images/generate-all`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ force: true }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }))
        throw new Error(err.error || `Request failed: ${res.status}`)
      }
      const data = await res.json()
      const { products: results } = data

      if (Array.isArray(results)) {
        for (const item of results) {
          if (item.image) {
            updateProduct(item.id, { image: item.image })
          }
        }
      }

      showToast(`Generated ${data.generated} AI images, ${data.placeholders} placeholders (${data.total} products)`)
      setGenImageStatus(`Generated ${data.generated} AI images${data.tokenMissing ? " — set HUGGINGFACE_TOKEN for real AI images" : ""}`)
    } catch (err) {
      showToast(`Image generation failed: ${(err as Error).message}`, "error")
      setGenImageStatus("Failed to generate images")
    } finally {
      setGeneratingImages(false)
    }
  }

  function addVariant() {
    if (!selectedProduct) return
    const name = newVariantName.trim()
    const price = normalizeNumber(newVariantPrice)
    const stock = normalizeNumber(newVariantStock)
    const barcode = normalizeBarcode(newVariantBarcode)

    if (!name) {
      showToast("Variant name is required.", "error")
      return
    }
    if (!barcode) {
      showToast("Barcode is required.", "error")
      return
    }
    if (products.some((p) => p.barcode === barcode || (p.barcodeAliases ?? []).includes(barcode))) {
      showToast(`Barcode ${barcode} already exists.`, "error")
      return
    }

    createProduct({
      name: `${selectedProduct.name} - ${name}`,
      price,
      cost: selectedProduct.cost,
      stock,
      barcode,
      category: selectedProduct.category,
      accent: selectedProduct.accent,
      parentId: selectedProduct.id,
      variantName: name,
    })
    setNewVariantName("")
    setNewVariantPrice("")
    setNewVariantStock("")
    setNewVariantBarcode("")
    showToast(`Variant ${name} added.`)
  }

  function saveCategoryRename() {
    if (!categoryFrom || !categoryTo.trim()) {
      showToast("Choose a category and enter the new name.", "error")
      return
    }

    renameCategory(categoryFrom, categoryTo)
    setSelectedCategory(categoryTo.trim())
    setCategoryFrom("")
    setCategoryTo("")
    showToast("Category renamed.")
  }

  function saveStockAdjustment() {
    if (!adjustmentProduct) {
      showToast("Choose a product before adjusting stock.", "error")
      return
    }

    const quantity = normalizeNumber(adjustmentQuantity)

    if (quantity <= 0) {
      showToast("Enter the adjustment quantity.", "error")
      return
    }

    const signedQuantity = adjustmentMode === "Add" ? quantity : -quantity
    const adjustment = recordStockAdjustment({
      productId: adjustmentProduct.id,
      quantityChange: signedQuantity,
      reason: adjustmentReason,
      batchId: adjustmentBatchId || undefined,
      note: adjustmentNote,
    })

    if (!adjustment) {
      showToast("Adjustment could not be posted.", "error")
      return
    }

    setAdjustmentQuantity("")
    setAdjustmentBatchId("")
    setAdjustmentNote("")
    setControlVersion((version) => version + 1)
    showToast(
      `${adjustment.adjustmentNumber} posted for ${adjustment.productName}.`
    )
  }

  function beginStockCount() {
    const session = startStockCount()

    setStockCounts(getStockCounts())
    showToast(`${session.countNumber} is ready for counting.`)
  }

  function saveCountLine() {
    if (!activeStockCount || !countProductId) {
      showToast("Start a count and choose a product.", "error")
      return
    }

    const counted = normalizeNumber(countedQuantity)
    const session = updateStockCountLine(
      activeStockCount.id,
      countProductId,
      counted
    )

    setStockCounts(getStockCounts())
    setCountedQuantity("")
    showToast(
      session
        ? `${session.countNumber} count line saved.`
        : "Count line could not be saved."
    )
  }

  function postStockCount() {
    if (!activeStockCount) {
      showToast("Start a physical count first.", "error")
      return
    }

    const countedLines = activeStockCount.lines.filter(
      (line) => typeof line.countedQuantity === "number"
    )

    if (countedLines.length === 0) {
      showToast("Enter at least one counted quantity before posting.", "error")
      return
    }

    const completed = completeStockCount(activeStockCount.id)

    setStockCounts(getStockCounts())
    setControlVersion((version) => version + 1)
    showToast(
      completed
        ? `${completed.countNumber} completed and variances posted.`
        : "Physical count could not be completed."
    )
  }

  return (
    <main className="min-h-0 flex-1 overflow-y-auto app-page">
      {isLoading ? (
        <div className="flex min-h-[400px] items-center justify-center p-6">
          <Spinner label="Loading inventory..." />
        </div>
      ) : (
      <>
      {/* Page Header */}
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-[22px] font-bold tracking-tight" style={{ color: "var(--text)" }}>Products</h1>
          <p className="text-[13px] mt-1" style={{ color: "var(--text-3)" }}>Manage your product catalog, stock levels, and inventory</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={generateProductImages} disabled={generatingImages}
            className="btn btn-default btn-sm disabled:opacity-50">
            {generatingImages ? "Generating…" : <><ImagePlus size={14} /> Generate Images</>}
          </button>
          <button type="button" onClick={() => setBulkEditOpen(true)}
            className="btn btn-default btn-sm">± Bulk Edit</button>
          <button type="button" onClick={() => {
            const csv = ["Name,Category,Price,Cost,Stock,Barcode,Reorder Pt,Reorder Qty"].concat(
              products.map((p) => `"${p.name}","${p.category}",${p.price},${p.cost},${p.stock},"${p.barcode || ""}",${p.reorderPoint ?? ""},${p.reorderQuantity ?? ""}`)
            ).join("\n")
            const b = new Blob([csv], { type: "text/csv" })
            const u = URL.createObjectURL(b)
            const a = document.createElement("a"); a.href = u; a.download = `products-${new Date().toISOString().slice(0,10)}.csv`; a.click()
            URL.revokeObjectURL(u)
          }}
            className="btn btn-default btn-sm"><Download size={14} /> Export CSV</button>
        </div>
      </div>

      <KpiCards
        totalProducts={products.length}
        totalStock={totalStock}
        totalValue={totalValue}
        urgentReorderCount={urgentReorders.length}
      />

      <WorkspaceTabs<ProductWorkspaceView>
        className="mt-6"
        active={activeProductView}
        onChange={setActiveProductView}
        tabs={productViews}
      />

      {activeProductView === "Lots" ? (
      <section className="card mt-5 overflow-hidden">
        <div className="flex flex-col gap-3 border-b px-5 py-4 sm:flex-row sm:items-center sm:justify-between" style={{ borderColor: "var(--border)" }}>
          <div>
            <h2 className="text-[16px] font-bold" style={{ color: "var(--text)" }}>Batch / Lot Inventory</h2>
            <p className="text-[12px] mt-0.5" style={{ color: "var(--text-3)" }}>
              Stock tracked by received lot, cost, expiry and remaining quantity.
            </p>
          </div>
          <span className="chip chip-brand" style={{ fontSize: "12px", height: "28px" }}>
            {formatNumber(openBatches.length)} open lots
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full border-separate border-spacing-0 text-[13px]">
            <thead>
              <tr>
                {["Lot", "Product", "Supplier", "Qty", "Cost", "Expiry"].map((h, i) => (
                  <th key={h} className="border-b px-4 py-3 text-start text-[10px] font-bold uppercase tracking-[0.14em]"
                    style={{ borderColor: "var(--border)", color: "var(--text-3)", textAlign: i >= 3 && i <= 4 ? "right" : "left" }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {openBatches.slice(0, 12).map((batch) => (
                <tr key={batch.id} className="t-row">
                  <td className="border-b px-4 py-3 font-bold tabular-nums" style={{ borderColor: "var(--border)", color: "var(--brand)" }}>{batch.batchNumber}</td>
                  <td className="border-b px-4 py-3 font-semibold" style={{ borderColor: "var(--border)", color: "var(--text)" }}>{batch.productName}</td>
                  <td className="border-b px-4 py-3" style={{ borderColor: "var(--border)", color: "var(--text-3)" }}>{batch.supplierName ?? "—"}</td>
                  <td className="border-b px-4 py-3 text-end font-bold tabular-nums" style={{ borderColor: "var(--border)", color: "var(--text)" }}>{formatNumber(batch.quantityRemaining)}</td>
                  <td className="border-b px-4 py-3 text-end tabular-nums" style={{ borderColor: "var(--border)", color: "var(--text-2)" }}>{formatCurrency(batch.unitCost)}</td>
                  <td className="border-b px-4 py-3" style={{ borderColor: "var(--border)", color: batch.expiryDate ? "var(--text-2)" : "var(--text-3)" }}>
                    {batch.expiryDate ? formatDate(batch.expiryDate) : "—"}
                  </td>
                </tr>
              ))}
              {openBatches.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-12 text-center text-[13px] font-medium" style={{ color: "var(--text-3)" }}>
                    Receiving batches will appear here.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
      ) : null}

      {activeProductView === "Alerts" ? (
      <AlertsPanel
        reorderSuggestions={reorderSuggestions}
        reorderGroups={reorderGroups}
        expiryAlerts={expiryAlerts}
        deadStockItems={deadStockItems}
        promoSuggestions={promoSuggestions}
        buildSupplierOrderMessage={buildSupplierOrderMessage}
        copySupplierOrder={copySupplierOrder}
      />
      ) : null}

      {activeProductView === "Control" ? (
      <StockControlPanel
        products={products}
        adjustmentProduct={adjustmentProduct}
        adjustmentProductId={adjustmentProductId}
        onAdjustmentProductIdChange={setAdjustmentProductId}
        adjustmentMode={adjustmentMode}
        onAdjustmentModeChange={setAdjustmentMode}
        adjustmentQuantity={adjustmentQuantity}
        onAdjustmentQuantityChange={setAdjustmentQuantity}
        adjustmentReason={adjustmentReason}
        onAdjustmentReasonChange={setAdjustmentReason}
        adjustmentBatchId={adjustmentBatchId}
        onAdjustmentBatchIdChange={setAdjustmentBatchId}
        adjustmentNote={adjustmentNote}
        onAdjustmentNoteChange={setAdjustmentNote}
        selectedProductBatches={selectedProductBatches}
        recentAdjustments={recentAdjustments}
        activeStockCount={activeStockCount}
        countProductId={countProductId}
        onCountProductIdChange={setCountProductId}
        countedQuantity={countedQuantity}
        onCountedQuantityChange={setCountedQuantity}
        countSearch={countSearch}
        onCountSearchChange={setCountSearch}
        countLines={countLines}
        onSaveStockAdjustment={saveStockAdjustment}
        onBeginStockCount={beginStockCount}
        onSaveCountLine={saveCountLine}
        onPostStockCount={postStockCount}
      />
      ) : null}

      {activeProductView === "Setup" ? (
      <>
      <ProductSetupForm
        selectedProduct={selectedProduct}
        setSelectedProductId={setSelectedProductId}
        products={products}
        productCategory={productCategory}
        setProductCategory={setProductCategory}
        reorderPoint={reorderPoint}
        setReorderPoint={setReorderPoint}
        reorderQuantity={reorderQuantity}
        setReorderQuantity={setReorderQuantity}
        expiryDate={expiryDate}
        setExpiryDate={setExpiryDate}
        productSupplierId={productSupplierId}
        setProductSupplierId={setProductSupplierId}
        barcodeAliases={barcodeAliases}
        setBarcodeAliases={setBarcodeAliases}
        suppliers={suppliers}
        categories={categories}
        categoryFrom={categoryFrom}
        setCategoryFrom={setCategoryFrom}
        categoryTo={categoryTo}
        setCategoryTo={setCategoryTo}
        productImage={productImage}
        onImageChange={setProductImage}
        onToggleFavorite={() => selectedProduct && toggleFavorite(selectedProduct)}
        onSaveProductSetup={saveProductSetup}
        onSaveCategoryRename={saveCategoryRename}
      />

      {selectedProduct && !selectedProduct.parentId ? (
      <section className="mt-5 rounded-2xl border p-4" style={{ background: "var(--surface)", borderColor: "var(--border)" }}>
        <label className="flex cursor-pointer items-start gap-3">
          <input
            type="checkbox"
            checked={isParent}
            onChange={(event) => setIsParent(event.target.checked)}
            className="mt-0.5 h-5 w-5 rounded"
          />
          <div>
            <span className="text-[14px] font-bold" style={{ color: "var(--text)" }}>This product has variants</span>
            <p className="text-[12px] mt-0.5" style={{ color: "var(--text-3)" }}>
              Enable to add versions like different sizes, colours, or flavours.
            </p>
          </div>
        </label>
      </section>
      ) : null}

      {selectedProduct?.parentId ? (
      <section className="mt-5 rounded-2xl border p-4" style={{ background: "var(--surface)", borderColor: "var(--border)" }}>
        <h3 className="mb-3 text-[14px] font-bold" style={{ color: "var(--text)" }}>Variant settings</h3>
        <label className="block">
          <span className="block text-[11px] font-bold uppercase tracking-wide mb-1.5" style={{ color: "var(--text-3)" }}>Variant name</span>
          <input
            value={variantName}
            onChange={(event) => setVariantName(event.target.value)}
            placeholder="e.g. Small, Red, 1L"
            className="input w-full"
          />
        </label>
        <p className="mt-1.5 text-[11px]" style={{ color: "var(--text-3)" }}>
          Save product setup to apply the change.
        </p>
      </section>
      ) : null}

      {(isParent || selectedProduct?.isParent) && selectedProduct ? (
      <section className="mt-5 overflow-hidden rounded-2xl border" style={{ background: "var(--surface)", borderColor: "var(--border)" }}>
        <div className="border-b px-4 py-3" style={{ borderColor: "var(--border)" }}>
          <h3 className="text-[14px] font-bold" style={{ color: "var(--text)" }}>Variants</h3>
        </div>

        {parentVariants.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="min-w-full text-[13px]">
            <thead>
              <tr>
                {["Name","Price","Stock","Barcode",""].map((h) => (
                  <th key={h} className="border-b px-4 py-2.5 text-start text-[10px] font-bold uppercase tracking-wide"
                    style={{ borderColor: "var(--border)", color: "var(--text-3)" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {parentVariants.map((variant) => (
                <tr key={variant.id} className="hover:bg-[var(--surface-hover)] transition-colors">
                  <td className="border-b px-4 py-3 font-semibold" style={{ borderColor: "var(--border)", color: "var(--text)" }}>{variant.variantName}</td>
                  <td className="border-b px-4 py-3 tabular-nums" style={{ borderColor: "var(--border)", color: "var(--text-2)" }}>{formatCurrency(variant.price)}</td>
                  <td className="border-b px-4 py-3 tabular-nums" style={{ borderColor: "var(--border)", color: "var(--text-2)" }}>{formatNumber(variant.stock)}</td>
                  <td className="border-b px-4 py-3 font-mono text-[12px]" style={{ borderColor: "var(--border)", color: "var(--text-3)" }}>{variant.barcode}</td>
                  <td className="border-b px-4 py-3" style={{ borderColor: "var(--border)" }}>
                    <button onClick={() => setDeleteVariantId(variant.id)}
                      className="flex h-7 w-7 items-center justify-center rounded-lg border transition"
                      style={{ borderColor: "var(--border)", color: "var(--text-3)" }}
                      onMouseEnter={(e) => { e.currentTarget.style.color = "var(--rose)"; e.currentTarget.style.borderColor = "var(--rose)" }}
                      onMouseLeave={(e) => { e.currentTarget.style.color = "var(--text-3)"; e.currentTarget.style.borderColor = "var(--border)" }}
                      aria-label={`Remove ${variant.variantName}`}>
                      <X size={13} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        ) : (
        <p className="px-4 py-6 text-[13px]" style={{ color: "var(--text-3)" }}>No variants yet. Add one below.</p>
        )}

        <div className="border-t p-4" style={{ borderColor: "var(--border)" }}>
          <p className="mb-3 text-[11px] font-bold uppercase tracking-wide" style={{ color: "var(--text-3)" }}>Add variant</p>
          <div className="grid gap-2 sm:grid-cols-4">
            <input value={newVariantName} onChange={(e) => setNewVariantName(e.target.value)}
              placeholder="Variant name" className="input" />
            <input type="number" min="0" value={newVariantPrice} onChange={(e) => setNewVariantPrice(e.target.value)}
              placeholder="Price" className="input" />
            <input type="number" min="0" value={newVariantStock} onChange={(e) => setNewVariantStock(e.target.value)}
              placeholder="Stock" className="input" />
            <div className="flex gap-2">
              <input value={newVariantBarcode} onChange={(e) => setNewVariantBarcode(e.target.value)}
                placeholder="Barcode" className="input flex-1" />
              <button type="button" onClick={addVariant} className="btn btn-primary gap-1.5 px-3">
                <Plus size={14} /> Add
              </button>
            </div>
          </div>
        </div>
      </section>
      ) : null}
      </>
      ) : null}

      <datalist id="catalog-categories">
        {categories
          .filter((category) => category !== "All")
          .map((category) => (
            <option key={category} value={category} />
          ))}
      </datalist>

      {activeProductView === "Catalog" ? (
      <>
      {bulkEditOpen && (
        <div className="card mb-4 p-4" style={{ borderLeft: "3px solid var(--blue)" }}>
          <h3 className="mb-3 text-[13px] font-bold" style={{ color: "var(--text)" }}>Bulk Price Edit</h3>
          <div className="flex flex-wrap gap-2">
            <select value={bulkEditCategory} onChange={(e) => setBulkEditCategory(e.target.value)} className="input h-9 text-[13px]">
              <option value="All">All Categories</option>
              {categories.filter((c) => c !== "All").map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            <select value={bulkEditField} onChange={(e) => setBulkEditField(e.target.value as "price" | "cost")} className="input h-9 text-[13px]">
              <option value="price">Price</option>
              <option value="cost">Cost</option>
            </select>
            <select value={bulkEditMode} onChange={(e) => setBulkEditMode(e.target.value as "percent" | "fixed")} className="input h-9 text-[13px]">
              <option value="percent">% change</option>
              <option value="fixed">Fixed ± $</option>
            </select>
            <input type="number" value={bulkEditValue} onChange={(e) => setBulkEditValue(e.target.value)}
              placeholder={bulkEditMode === "percent" ? "e.g. 10 = +10%" : "e.g. 0.50"}
              className="input h-9 w-32 text-[13px]" />
            <button type="button" onClick={applyBulkPriceEdit} className="btn btn-primary btn-sm">Apply</button>
            <button type="button" onClick={() => setBulkEditOpen(false)} className="btn btn-default btn-sm">Cancel</button>
          </div>
          <p className="mt-2 text-[11px]" style={{ color: "var(--text-3)" }}>
            Affects {products.filter((p) => !p.isParent && (bulkEditCategory === "All" || p.category === bulkEditCategory)).length} products. Applied immediately.
          </p>
        </div>
      )}
      <ProductTable
        filteredProducts={filteredProducts}
        lowStockCount={lowStockCount}
        search={search}
        onSearchChange={setSearch}
        selectedCategory={selectedCategory}
        onCategoryChange={setSelectedCategory}
        categories={categories}
        onToggleFavorite={toggleFavorite}
        onDeleteClick={setDeleteProductId}
        onEditClick={openProductEdit}
      />
      </>
      ) : null}

      {/* ── Categories tab ── */}
      {activeProductView === "Categories" ? (
      <section className="card mt-5 overflow-hidden">
        <div className="flex items-center justify-between border-b px-5 py-4" style={{ borderColor: "var(--border)" }}>
          <div>
            <h2 className="text-[16px] font-bold" style={{ color: "var(--text)" }}>Categories</h2>
            <p className="text-[12px] mt-0.5" style={{ color: "var(--text-3)" }}>Manage and rename product categories</p>
          </div>
          <span className="chip chip-brand" style={{ fontSize: "12px", height: "28px" }}>{categories.length - 1} total</span>
        </div>
        {categories.filter((c) => c !== "All").length === 0 ? (
          <div className="px-5 py-12 text-center text-[13px]" style={{ color: "var(--text-3)" }}>
            No categories yet. Create one by editing a product.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-[13px]">
              <thead>
                <tr>
                  <th className="border-b px-5 py-3 text-start text-[10px] font-bold uppercase tracking-[0.14em]" style={{ borderColor: "var(--border)", color: "var(--text-3)" }}>Category</th>
                  <th className="border-b px-5 py-3 text-end text-[10px] font-bold uppercase tracking-[0.14em]" style={{ borderColor: "var(--border)", color: "var(--text-3)" }}>Products</th>
                  <th className="border-b px-5 py-3 text-end text-[10px] font-bold uppercase tracking-[0.14em]" style={{ borderColor: "var(--border)", color: "var(--text-3)" }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {categories.filter((c) => c !== "All").map((cat) => {
                  const count = products.filter((p) => p.category === cat).length
                  return (
                    <tr key={cat} className="t-row">
                      <td className="border-b px-5 py-3 font-semibold" style={{ borderColor: "var(--border)", color: "var(--text)" }}>{cat}</td>
                      <td className="border-b px-5 py-3 text-end tabular-nums" style={{ borderColor: "var(--border)", color: "var(--text-2)" }}>{count}</td>
                      <td className="border-b px-5 py-3 text-end" style={{ borderColor: "var(--border)" }}>
                        <input defaultValue={cat} onBlur={(e) => { const n = e.target.value.trim(); if (n && n !== cat) { renameCategory(cat, n); showToast(`Renamed "${cat}" to "${n}"`) }; e.target.style.borderColor = "var(--border)"; e.target.style.boxShadow = "none" }}
                          className="h-8 w-40 rounded-lg border px-3 text-[12px] font-medium outline-none transition text-end"
                          style={{ background: "var(--surface-2)", borderColor: "var(--border)", color: "var(--text)" }}
                          onFocus={(e) => { e.target.style.borderColor = "var(--brand)"; e.target.style.boxShadow = "0 0 0 3px var(--focus-ring)" }} />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
      ) : null}

      <ConfirmDialog
        open={deleteProductId !== null}
        title={t("desktop.delete_product")}
        confirmLabel={t("pos.delete")}
        confirmDestructive
        onConfirm={() => {
          if (deleteProductId !== null) {
            deleteProduct(deleteProductId)
            setDeleteProductId(null)
          }
        }}
        onCancel={() => setDeleteProductId(null)}
      >
        <p>{t("desktop.delete_product_confirm")}</p>
      </ConfirmDialog>

      <ConfirmDialog
        open={deleteVariantId !== null}
        title="Remove variant"
        confirmLabel="Remove"
        confirmDestructive
        onConfirm={() => {
          if (deleteVariantId !== null) {
            deleteProduct(deleteVariantId)
            setDeleteVariantId(null)
          }
        }}
        onCancel={() => setDeleteVariantId(null)}
      >
        <p>Remove this variant? This cannot be undone.</p>
      </ConfirmDialog>

      {/* Edit Product Modal */}
      {editProduct && (
        <div className="modal-overlay" onClick={() => setEditProduct(null)}>
          <div className="modal-card" style={{ maxWidth: "520px" }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Edit Product</h2>
              <button onClick={() => setEditProduct(null)} className="btn-icon" style={{ color: "var(--text-3)" }}>✕</button>
            </div>
            <div className="modal-body space-y-3">
              <label className="block">
                <span className="block text-[12px] font-bold mb-1" style={{ color: "var(--text-2)" }}>Name</span>
                <input value={editName} onChange={(e) => setEditName(e.target.value)} className="input w-full" />
              </label>
              <label className="block">
                <span className="block text-[12px] font-bold mb-1" style={{ color: "var(--text-2)" }}>Category</span>
                <input value={editCategory} onChange={(e) => setEditCategory(e.target.value)} className="input w-full" />
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="block text-[12px] font-bold mb-1" style={{ color: "var(--text-2)" }}>Price $</span>
                  <input type="number" min="0" step="0.01" value={editPrice} onChange={(e) => setEditPrice(e.target.value)} className="input w-full" />
                </label>
                <label className="block">
                  <span className="block text-[12px] font-bold mb-1" style={{ color: "var(--text-2)" }}>Cost $</span>
                  <input type="number" min="0" step="0.01" value={editCost} onChange={(e) => setEditCost(e.target.value)} className="input w-full" />
                </label>
              </div>
              <label className="block">
                <span className="block text-[12px] font-bold mb-1" style={{ color: "var(--text-2)" }}>Barcode</span>
                <input value={editBarcode} onChange={(e) => setEditBarcode(e.target.value)} className="input w-full font-mono" />
              </label>
              <label className="block">
                <span className="block text-[12px] font-bold mb-1" style={{ color: "var(--text-2)" }}>Barcode Aliases <span className="font-normal" style={{ color: "var(--text-3)" }}>(comma-separated)</span></span>
                <input value={editBarcodeAliases} onChange={(e) => setEditBarcodeAliases(e.target.value)} placeholder="5281000123457, 5281000123458" className="input w-full font-mono" />
              </label>
              <div className="grid grid-cols-3 gap-3">
                <label className="block">
                  <span className="block text-[12px] font-bold mb-1" style={{ color: "var(--text-2)" }}>Stock</span>
                  <input type="number" min="0" value={editStock} onChange={(e) => setEditStock(e.target.value)} className="input w-full" />
                </label>
                <label className="block">
                  <span className="block text-[12px] font-bold mb-1" style={{ color: "var(--text-2)" }}>Reorder Pt</span>
                  <input type="number" min="0" value={editReorderPoint} onChange={(e) => setEditReorderPoint(e.target.value)} className="input w-full" />
                </label>
                <label className="block">
                  <span className="block text-[12px] font-bold mb-1" style={{ color: "var(--text-2)" }}>Reorder Qty</span>
                  <input type="number" min="0" value={editReorderQty} onChange={(e) => setEditReorderQty(e.target.value)} className="input w-full" />
                </label>
              </div>
            </div>
            <div className="modal-footer">
              <button onClick={() => setEditProduct(null)} className="btn btn-default">Cancel</button>
              <button onClick={saveProductEdit} className="btn btn-primary">Save Changes</button>
            </div>
          </div>
        </div>
      )}

      </>
      )}
    </main>
  )
}

import { useEffect, useMemo, useState } from "react"
import { useDebounce } from "../../hooks/useDebounce"
import type { Product } from "../../features/pos/types/product"
import { ImagePlus, Plus, Download, SlidersHorizontal, X, Filter, ArrowUpDown } from "lucide-react"
import KpiCards from "../../features/pos/components/KpiCards"
import AlertsPanel from "../../features/pos/components/AlertsPanel"
import ProductSetupForm from "../../features/pos/components/ProductSetupForm"
import ProductTable from "../../features/pos/components/ProductTable"
import ProductQuickCreate from "../../features/pos/components/ProductQuickCreate"
import ProductEditDrawer from "../../features/pos/components/ProductEditDrawer"
import Spinner from "../../components/ui/Spinner"
import WorkspaceTabs from "../../components/ui/WorkspaceTabs"
import { getApiUrl, getAuthToken } from "../../features/pos/services/sync.service"

import { formatCurrency, formatNumber } from "../../features/pos/lib/currency"
import { subscribeInventoryBatches } from "../../features/pos/services/inventoryBatch.service"
import {
  createProduct,
  deleteProduct,
  getLowStockProducts,
  getNoBarcodeProducts,
  getProducts,
  productMatchesSearch,
  renameCategory,
  sortProducts,
  subscribeProducts,
  updateProduct,
  detectDuplicateBarcodes,
  type ProductSortKey,
  type SortDir,
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
import { showToast } from "../../features/pos/services/toast.service"
import { useI18n } from "@lebanonpos/shared"
// POS-UX-IA-2B.5: Products is catalog-focused. Stock quantities, batches,
// counts, and reconciliation moved to the dedicated /stock workspace.
// "Control"/"Lots" remain as legacy deep-link values that fall back to Catalog
// (and /products/count redirects to /stock at the route level).
type ProductWorkspaceView = "Catalog" | "Categories" | "Alerts" | "Setup"
type ProductInitialTab = ProductWorkspaceView | "Control" | "Lots"

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

export default function ProductsPage({ initialTab }: { initialTab?: ProductInitialTab } = {}) {
  // Legacy stock deep links (Control/Lots) safely fall back to Catalog.
  const safeInitialTab: ProductWorkspaceView =
    initialTab === "Control" || initialTab === "Lots" || !initialTab
      ? "Catalog"
      : initialTab
  const [products, setProducts] = useState<Product[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [suppliers, setSuppliers] =
    useState<SupplierLedger[]>(getSupplierLedger())
  const [search, setSearch] = useState("")
  const [showArchived, setShowArchived] = useState(false)
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
  const [activeProductView, setActiveProductView] =
    useState<ProductWorkspaceView>(safeInitialTab)
  const [batchVersion, setBatchVersion] = useState(0)
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
  const [toolsOpen, setToolsOpen] = useState(false)
  const [bulkEditCategory, setBulkEditCategory] = useState("All")
  const [bulkEditField, setBulkEditField] = useState<"price" | "cost">("price")
  const [bulkEditMode, setBulkEditMode] = useState<"percent" | "fixed">("percent")
  const [bulkEditValue, setBulkEditValue] = useState("")
  const [isParent, setIsParent] = useState(false)
  const [variantName, setVariantName] = useState("")
  const [newVariantName, setNewVariantName] = useState("")
  const [quickView, setQuickView] = useState<"active" | "archived" | "low" | "nobarcode" | "duplicates">("active")
  const [sortKey, setSortKey] = useState<ProductSortKey>("name")
  const [sortDir, setSortDir] = useState<SortDir>("asc")
  const [showQuickCreate, setShowQuickCreate] = useState(false)
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

    return () => {
      active = false
      unsubscribe()
      unsubscribeSuppliers()
      unsubscribeSales()
      unsubscribeBatches()
    }
  }, [])

  const categories = useMemo(
    () => ["All", ...Array.from(new Set(products.map((p) => p.category)))],
    [products, batchVersion]
  )

  const filteredProducts = useMemo(() => {
    let list = products

    if (quickView === "archived") {
      list = list.filter(p => p.archived)
    } else {
      list = list.filter(p => !p.archived)
    }

    if (quickView === "low") {
      list = getLowStockProducts(list)
    } else if (quickView === "nobarcode") {
      list = getNoBarcodeProducts(list)
    } else if (quickView === "duplicates") {
      const dupBarcodes = new Set(detectDuplicateBarcodes().map(d => d.barcode))
      list = list.filter(p => p.barcode && dupBarcodes.has(p.barcode))
    }

    if (quickView !== "duplicates" && quickView !== "nobarcode") {
      const query = search.trim().toLowerCase()
      const matchesCategory = selectedCategory === "All" ||
        list.some(p => p.category === selectedCategory) // will filter below

      list = list.filter((product) => {
        const matchesCat = selectedCategory === "All" || product.category === selectedCategory
        const matchesSearch = query.length === 0 || productMatchesSearch(product, query)
        return matchesCat && matchesSearch
      })
    }

    return sortProducts(list, sortKey, sortDir)
  }, [products, debouncedSearch, selectedCategory, quickView, sortKey, sortDir])

  const duplicateBarcodes = useMemo(() => detectDuplicateBarcodes(), [products])
  const selectedProduct =
    products.find((product) => product.id === selectedProductId) ?? products[0]
  const reorderSuggestions = useMemo(
    () => getReorderSuggestions(products),
    [products, batchVersion]
  )
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

  const urgentReorders = reorderSuggestions.filter(
    (suggestion) => suggestion.suggestedQuantity > 0
  )

  // Archived products are no longer for sale — excluding them here matches
  // getLowStockProducts/getNoBarcodeProducts/getReorderSuggestions, which
  // already filter archived internally. Without this, an archived product's
  // stock/value kept inflating the "Total Stock"/"Total Value" KPI cards
  // even though it's excluded from the Active tab and count right below.
  const activeProducts = products.filter((product) => !product.archived)
  const totalStock = activeProducts.reduce((sum, product) => sum + product.stock, 0)
  const totalValue = activeProducts.reduce(
    (sum, product) => sum + product.stock * product.cost,
    0
  )
  const lowStockCount = getLowStockProducts(products).length
  const productViews: Array<{
    value?: ProductWorkspaceView
    label: string
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
      value: "Setup",
      label: "Add product",
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
    const result = updateProduct(editProduct.id, {
      name: editName,
      category: editCategory,
      price: normalizeNumber(editPrice),
      cost: normalizeNumber(editCost),
      barcode: editBarcode || undefined,
      barcodeAliases: editBarcodeAliases.split(",").map((a: string) => a.trim()).filter((a: string) => a.length > 0),
      reorderPoint: normalizeNumber(editReorderPoint),
      reorderQuantity: normalizeNumber(editReorderQty),
    })
    if (result === undefined) {
      showToast(`${editName} could not be updated. Check for duplicate barcodes.`, "error")
      return
    }
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
      setGenImageStatus(`Generated ${data.generated} AI images (${data.placeholders} placeholders, ${data.total} total)`)
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

  return (
    <main className="min-h-0 flex-1 overflow-y-auto app-page">
      {isLoading ? (
        <div className="app-page p-6 space-y-3">
          {[1,2,3,4,5,6,7,8].map(i => (
            <div key={i} className="skeleton h-14 rounded-lg" style={{ background: "var(--surface-3)", animation: "pulse 1.5s infinite" }} />
          ))}
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
          {/* Power tools live behind one calm menu — the toolbar stays quiet */}
          <div className="relative">
            <button type="button" onClick={() => setToolsOpen((v) => !v)}
              aria-expanded={toolsOpen} aria-haspopup="menu"
              className="btn btn-default btn-sm">⋯ Tools</button>
            {toolsOpen && (
              <>
                <div className="fixed inset-0 z-30" onClick={() => setToolsOpen(false)} />
                <div className="absolute end-0 top-full z-40 mt-1.5 w-52 overflow-hidden rounded-xl border p-1 shadow-xl"
                  style={{ background: "var(--surface)", borderColor: "var(--border)" }} role="menu">
                  <button type="button" role="menuitem" disabled={generatingImages}
                    onClick={() => { setToolsOpen(false); generateProductImages() }}
                    className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-start text-[13px] font-semibold transition hover:opacity-80 disabled:opacity-50"
                    style={{ color: "var(--text)" }}>
                    <ImagePlus size={14} style={{ color: "var(--text-3)" }} />
                    {generatingImages ? "Generating…" : "Generate Images"}
                  </button>
                  <button type="button" role="menuitem"
                    onClick={() => { setToolsOpen(false); setBulkEditOpen(true) }}
                    className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-start text-[13px] font-semibold transition hover:opacity-80"
                    style={{ color: "var(--text)" }}>
                    <SlidersHorizontal size={14} style={{ color: "var(--text-3)" }} />
                    Bulk Edit
                  </button>
                </div>
              </>
            )}
          </div>
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
        totalProducts={activeProducts.length}
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

      {/* POS-UX-IA-2B.5: Products is catalog-focused; stock ops moved to /stock. */}
      <div className="card mt-4 flex flex-wrap items-center justify-between gap-3 p-4 text-[12px]"
        style={{ borderColor: "var(--border)", color: "var(--text-2)" }}>
        <span>
          For <span className="font-semibold">quantities, batches, stock counts, and reconciliation</span>, use{" "}
          <span className="font-bold" style={{ color: "var(--text)" }}>Stock &amp; Batches</span>.
        </span>
        <button type="button" onClick={() => { window.location.href = "/stock" }}
          className="btn btn-default btn-sm">Open Stock &amp; Batches</button>
      </div>

      {activeProductView === "Alerts" ? (
      <AlertsPanel
        reorderSuggestions={reorderSuggestions}
        reorderGroups={reorderGroups}
        expiryAlerts={expiryAlerts}
        deadStockItems={deadStockItems}
        promoSuggestions={promoSuggestions}
        buildSupplierOrderMessage={buildSupplierOrderMessage}
        copySupplierOrder={copySupplierOrder}
        onWriteOffProduct={() => { window.location.href = "/stock" }}
        onViewProduct={() => { window.location.href = "/stock" }}
        onReceiveProduct={() => { window.location.href = "/products/new" }}
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
                      className="flex h-7 w-7 items-center justify-center rounded-lg border transition hover:opacity-80"
                      style={{ borderColor: "var(--border)", color: "var(--text-3)" }}
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
      {/* Quick views & toolbar */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="flex rounded-lg p-0.5 gap-0.5" style={{ background: "var(--surface-2)" }}>
          {([
            ["active", `Active (${products.filter(p => !p.archived).length})`],
            ["archived", `Archived (${products.filter(p => p.archived).length})`],
            ["low", `Low (${getLowStockProducts(products).length})`],
            ["nobarcode", `No Barcode (${getNoBarcodeProducts(products).length})`],
            ["duplicates", `Dupes (${duplicateBarcodes.length})`],
          ] as const).map(([key, label]) => (
            <button
              key={key}
              onClick={() => { setQuickView(key); setSearch(""); setSelectedCategory("All") }}
              className="px-3 py-1.5 text-[11px] font-semibold rounded-md transition-colors"
              style={{
                background: quickView === key ? "var(--brand)" : "transparent",
                color: quickView === key ? "var(--brand-contrast)" : "var(--text-2)",
              }}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="flex-1" />

        <div className="flex items-center gap-2">
          <select value={sortKey} onChange={e => setSortKey(e.target.value as ProductSortKey)}
            className="input h-8 text-[12px] w-24">
            <option value="name">Name</option>
            <option value="stock">Stock</option>
            <option value="category">Category</option>
            <option value="price">Price</option>
            <option value="cost">Cost</option>
            <option value="margin">Margin</option>
          </select>
          <button onClick={() => setSortDir(d => d === "asc" ? "desc" : "asc")}
            className="icon-btn h-8 w-8 flex items-center justify-center rounded-md"
            style={{ color: "var(--text-2)", border: "1px solid var(--border)" }}>
            <ArrowUpDown size={14} />
          </button>
        </div>

        <button onClick={() => setShowQuickCreate(true)}
          className="btn btn-primary btn-sm flex items-center gap-1">
          <Plus size={14} /> New Product
        </button>
        <button onClick={() => setBulkEditOpen(o => !o)}
          className="btn btn-default btn-sm flex items-center gap-1">
          <SlidersHorizontal size={14} /> Bulk Edit
        </button>
      </div>

      {bulkEditOpen && (
        <div className="card mb-4 p-4" style={{ borderLeft: "3px solid var(--brand)" }}>
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

      {/* Quick Create Product Modal */}
      {showQuickCreate && (
        <ProductQuickCreate
          categories={categories}
          onClose={() => setShowQuickCreate(false)}
          onCreated={() => {
            getProducts().then(setProducts)
            setBatchVersion(v => v + 1)
          }}
        />
      )}

      {/* Edit Product Drawer */}
      {editProduct && (
        <ProductEditDrawer
          product={editProduct}
          editName={editName} onEditNameChange={setEditName}
          editCategory={editCategory} onEditCategoryChange={setEditCategory}
          editPrice={editPrice} onEditPriceChange={setEditPrice}
          editCost={editCost} onEditCostChange={setEditCost}
          editBarcode={editBarcode} onEditBarcodeChange={setEditBarcode}
          editBarcodeAliases={editBarcodeAliases} onEditBarcodeAliasesChange={setEditBarcodeAliases}
          editReorderPoint={editReorderPoint} onEditReorderPointChange={setEditReorderPoint}
          editReorderQty={editReorderQty} onEditReorderQtyChange={setEditReorderQty}
          onSave={saveProductEdit}
          onClose={() => setEditProduct(null)}
        />
      )}

      </>
      )}
    </main>
  )
}

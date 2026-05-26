import { useEffect, useMemo, useState } from "react"
import { useDebounce } from "../../hooks/useDebounce"
import type { Product } from "../../features/pos/types/product"
import KpiCards from "../../features/pos/components/KpiCards"
import AlertsPanel from "../../features/pos/components/AlertsPanel"
import StockControlPanel from "../../features/pos/components/StockControlPanel"
import ProductSetupForm from "../../features/pos/components/ProductSetupForm"
import ProductTable from "../../features/pos/components/ProductTable"
import Spinner from "../../components/ui/Spinner"
import WorkspaceTabs from "../../components/ui/WorkspaceTabs"

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
type ProductWorkspaceView = "Catalog" | "Alerts" | "Control" | "Lots" | "Setup"

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

export default function ProductsPage() {
  const [products, setProducts] = useState<Product[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [suppliers, setSuppliers] =
    useState<SupplierLedger[]>(getSupplierLedger())
  const [search, setSearch] = useState("")
  const debouncedSearch = useDebounce(search, 200)
  const [selectedCategory, setSelectedCategory] = useState("All")
  const [selectedProductId, setSelectedProductId] = useState<number | null>(null)
  const [productCategory, setProductCategory] = useState("")
  const [productSupplierId, setProductSupplierId] = useState("")
  const [reorderPoint, setReorderPoint] = useState("")
  const [reorderQuantity, setReorderQuantity] = useState("")
  const [expiryDate, setExpiryDate] = useState("")
  const [barcodeAliases, setBarcodeAliases] = useState("")
  const [categoryFrom, setCategoryFrom] = useState("")
  const [categoryTo, setCategoryTo] = useState("")
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
    useState<ProductWorkspaceView>("Catalog")
  const [batchVersion, setBatchVersion] = useState(0)
  const [controlVersion, setControlVersion] = useState(0)
  const [deleteProductId, setDeleteProductId] = useState<number | null>(null)

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
    setProductSupplierId(selectedProduct.supplierId ?? "")
    setReorderPoint(String(selectedProduct.reorderPoint ?? 10))
    setReorderQuantity(String(selectedProduct.reorderQuantity ?? 20))
    setExpiryDate(selectedProduct.expiryDate ?? "")
    setBarcodeAliases((selectedProduct.barcodeAliases ?? []).join("\n"))
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
    })
    showToast(`${selectedProduct.name} setup saved.`)
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
    <main className="min-h-0 flex-1 overflow-y-auto bg-[#eef3f2] p-3 sm:p-5 xl:p-6">
      {isLoading ? (
        <div className="flex min-h-[400px] items-center justify-center p-6">
          <Spinner label="Loading inventory..." />
        </div>
      ) : (
      <>
      <KpiCards
        totalProducts={products.length}
        totalStock={totalStock}
        totalValue={totalValue}
        urgentReorderCount={urgentReorders.length}
      />

      <WorkspaceTabs<ProductWorkspaceView>
        className="mt-5"
        active={activeProductView}
        onChange={setActiveProductView}
        tabs={productViews}
      />

      {activeProductView === "Lots" ? (
      <section className="mt-5 rounded-lg border border-zinc-200 bg-white shadow-sm">
        <div className="flex flex-col gap-3 border-b border-zinc-200 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-xl font-bold text-zinc-950">
              Batch / lot inventory
            </h2>
            <p className="text-sm text-zinc-500">
              Stock is tracked by received lot, cost, expiry, and remaining quantity.
            </p>
          </div>
          <span className="rounded-lg bg-zinc-100 px-3 py-2 text-sm font-bold text-zinc-700">
            {formatNumber(openBatches.length)} open lots
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full border-separate border-spacing-0 text-sm">
            <thead>
              <tr className="text-left text-xs font-bold uppercase tracking-[0.14em] text-zinc-500">
                <th className="border-b border-zinc-200 px-4 py-3">Lot</th>
                <th className="border-b border-zinc-200 px-4 py-3">Product</th>
                <th className="border-b border-zinc-200 px-4 py-3">Supplier</th>
                <th className="border-b border-zinc-200 px-4 py-3 text-right">Qty</th>
                <th className="border-b border-zinc-200 px-4 py-3 text-right">Cost</th>
                <th className="border-b border-zinc-200 px-4 py-3">Expiry</th>
              </tr>
            </thead>
            <tbody>
              {openBatches.slice(0, 12).map((batch) => (
                <tr key={batch.id} className="hover:bg-zinc-50">
                  <td className="border-b border-zinc-100 px-4 py-4 font-bold text-zinc-950">
                    {batch.batchNumber}
                  </td>
                  <td className="border-b border-zinc-100 px-4 py-4 text-zinc-700">
                    {batch.productName}
                  </td>
                  <td className="border-b border-zinc-100 px-4 py-4 text-zinc-600">
                    {batch.supplierName ?? "-"}
                  </td>
                  <td className="border-b border-zinc-100 px-4 py-4 text-right font-bold text-zinc-950">
                    {formatNumber(batch.quantityRemaining)}
                  </td>
                  <td className="border-b border-zinc-100 px-4 py-4 text-right text-zinc-700">
                    {formatCurrency(batch.unitCost)}
                  </td>
                  <td className="border-b border-zinc-100 px-4 py-4 text-zinc-600">
                    {batch.expiryDate ? formatDate(batch.expiryDate) : "-"}
                  </td>
                </tr>
              ))}

              {openBatches.length === 0 ? (
                <tr>
                  <td
                    colSpan={6}
                    className="px-4 py-10 text-center text-sm font-medium text-zinc-500"
                  >
                    New receiving batches will appear here.
                  </td>
                </tr>
              ) : null}
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
        onToggleFavorite={() => selectedProduct && toggleFavorite(selectedProduct)}
        onSaveProductSetup={saveProductSetup}
        onSaveCategoryRename={saveCategoryRename}
      />
      ) : null}

      <datalist id="catalog-categories">
        {categories
          .filter((category) => category !== "All")
          .map((category) => (
            <option key={category} value={category} />
          ))}
      </datalist>

      {activeProductView === "Catalog" ? (
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
      />
      ) : null}

      <ConfirmDialog
        open={deleteProductId !== null}
        title="Delete product"
        confirmLabel="Delete"
        confirmDestructive
        onConfirm={() => {
          if (deleteProductId !== null) {
            deleteProduct(deleteProductId)
            setDeleteProductId(null)
          }
        }}
        onCancel={() => setDeleteProductId(null)}
      >
        <p>Delete this product? This cannot be undone.</p>
      </ConfirmDialog>
      </>
      )}
    </main>
  )
}

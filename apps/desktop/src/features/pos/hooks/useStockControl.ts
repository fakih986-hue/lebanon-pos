import { useEffect, useMemo, useState } from "react"
import { useDebounce } from "../../../hooks/useDebounce"
import type { Product } from "../types/product"
import { getInventoryBatches } from "../services/inventoryBatch.service"
import {
  getStockAdjustments,
  recordStockAdjustment,
  subscribeStockAdjustments,
  type StockAdjustmentReason,
} from "../services/inventoryAdjustment.service"
import {
  completeStockCount,
  getStockCounts,
  startStockCount,
  subscribeStockCounts,
  updateStockCountLine,
  type StockCountSession,
} from "../services/stockCount.service"
import {
  getReconciliationIssues,
  type ReconciliationIssue,
} from "../services/product.service"
import { showToast } from "../services/toast.service"

// POS-UX-IA-2B.2: Stock-control state, derived values, subscriptions and
// handlers extracted verbatim from ProductsPage into a portable hook. This is
// the future /stock route boundary — everything the "Stock tools" view (adjust,
// count, batches-for-adjustment, reconciliation) needs lives here so it can be
// mounted elsewhere without re-threading ~25 props by hand. No behavior change:
// same state, same memo dependency lists, same handler logic, same toasts.

function normalizeNumber(value: string) {
  const parsedValue = Number(value)

  return Number.isFinite(parsedValue) ? Math.max(0, parsedValue) : 0
}

function normalizeBarcode(value: string) {
  return value.trim().replace(/\s+/g, "")
}

/**
 * Owns all Stock tools (adjust / count / reconciliation) state and logic.
 *
 * @param products the current product list (shared with ProductsPage)
 * @param selectedProduct the page's currently selected product, used only to
 *        seed the adjustment/count product ids the first time (preserves the
 *        original selectedProduct effect behavior).
 */
export function useStockControl(
  products: Product[],
  selectedProduct: Product | undefined
) {
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
  const [controlVersion, setControlVersion] = useState(0)
  const [reconIssues, setReconIssues] = useState<ReconciliationIssue[]>([])
  const [reconLoading, setReconLoading] = useState(false)

  useEffect(() => {
    let active = true

    const unsubscribeAdjustments = subscribeStockAdjustments(() =>
      setControlVersion((version) => version + 1)
    )
    const unsubscribeCounts = subscribeStockCounts(() => {
      if (!active) return
      setStockCounts(getStockCounts())
      setControlVersion((version) => version + 1)
    })

    return () => {
      active = false
      unsubscribeAdjustments()
      unsubscribeCounts()
    }
  }, [])

  // Seed the adjustment/count product the first time a product is selected.
  useEffect(() => {
    if (!selectedProduct) {
      return
    }

    setAdjustmentProductId((currentId) => currentId ?? selectedProduct.id)
    setCountProductId((currentId) => currentId ?? selectedProduct.id)
  }, [selectedProduct])

  const adjustmentProduct =
    products.find((product) => product.id === adjustmentProductId) ??
    selectedProduct

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
      openBatches.filter((batch) => batch.productId === adjustmentProduct?.id),
    [adjustmentProduct?.id, openBatches]
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeStockCount, debouncedCountSearch])

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

  async function runReconScan() {
    setReconLoading(true)
    const issues = await getReconciliationIssues()
    setReconIssues(issues)
    setReconLoading(false)
  }

  return {
    // adjustment state (also read by ProductsPage Alerts write-off action)
    adjustmentProduct,
    adjustmentProductId,
    setAdjustmentProductId,
    adjustmentMode,
    setAdjustmentMode,
    adjustmentQuantity,
    setAdjustmentQuantity,
    adjustmentReason,
    setAdjustmentReason,
    adjustmentBatchId,
    setAdjustmentBatchId,
    adjustmentNote,
    setAdjustmentNote,
    selectedProductBatches,
    // all currently-open batches (also read by ProductsPage for the
    // Batches tab-count badge — computed once here)
    openBatches,
    // count state
    countProductId,
    setCountProductId,
    countedQuantity,
    setCountedQuantity,
    countSearch,
    setCountSearch,
    countLines,
    activeStockCount,
    // derived (also read by ProductsPage for the tab-count badge)
    recentAdjustments,
    // reconciliation
    reconIssues,
    reconLoading,
    runReconScan,
    // handlers
    saveStockAdjustment,
    beginStockCount,
    saveCountLine,
    postStockCount,
  }
}

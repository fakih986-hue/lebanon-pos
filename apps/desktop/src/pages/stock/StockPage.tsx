import { useEffect, useState } from "react"
import { useSearchParams } from "react-router"

import type { Product } from "../../features/pos/types/product"
import StockControlPanel from "../../features/pos/components/StockControlPanel"
import BatchesPanel from "../../features/pos/components/BatchesPanel"
import OpeningInventoryPanel from "../../features/pos/components/OpeningInventoryPanel"
import LedgerReconciliationPanel from "../../features/pos/components/LedgerReconciliationPanel"
import WorkspaceTabs from "../../components/ui/WorkspaceTabs"
import Spinner from "../../components/ui/Spinner"
import { getProducts, subscribeProducts } from "../../features/pos/services/product.service"
import { subscribeSales } from "../../features/pos/services/sales.service"
import { useStockControl } from "../../features/pos/hooks/useStockControl"

// POS-UX-IA-2B.3: Dedicated Stock & Batches workspace (/stock). This is the
// destination the ProductsPage → Stock tools / Batches views will eventually
// move to. For now it lives alongside Products (Products keeps its own copies).
// All stock behavior is reused from useStockControl + the existing panels — no
// business logic here, no logic/service files touched.

type StockWorkspaceView = "Control" | "Lots" | "Opening" | "Recon"

const stockViews: Array<{
  value?: StockWorkspaceView
  label: string
  count?: number
}> = [
  { value: "Control", label: "Adjust & count" },
  { value: "Lots", label: "Batches" },
  { value: "Opening", label: "Opening inventory" },
  { value: "Recon", label: "Reconciliation" },
]

const isStockView = (v: string | null): v is StockWorkspaceView =>
  v === "Control" || v === "Lots" || v === "Opening" || v === "Recon"

export default function StockPage() {
  const [products, setProducts] = useState<Product[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [selectedProductId] = useState<number | null>(null)
  const [searchParams] = useSearchParams()
  const initialView = searchParams.get("view")
  const [activeView, setActiveView] = useState<StockWorkspaceView>(isStockView(initialView) ? initialView : "Control")

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

    const unsubscribeProducts = subscribeProducts((data) => {
      if (active) setProducts(data)
    })
    const unsubscribeSales = subscribeSales(() => {
      if (active) setProducts((current) => [...current])
    })

    return () => {
      active = false
      unsubscribeProducts()
      unsubscribeSales()
    }
  }, [])

  const selectedProduct =
    products.find((product) => product.id === selectedProductId) ?? products[0]
  const stock = useStockControl(products, selectedProduct)

  return (
    <main className="min-h-0 flex-1 overflow-y-auto app-page">
      {isLoading ? (
        <div className="flex items-center justify-center py-20">
          <Spinner />
        </div>
      ) : (
        <>
          <div className="mb-6">
            <h1 className="text-[22px] font-bold tracking-tight" style={{ color: "var(--text)" }}>
              Stock &amp; Batches
            </h1>
            <p className="text-[13px] mt-1" style={{ color: "var(--text-3)" }}>
              Adjust and count stock, review received batches, and reconcile aggregate vs batches vs ledger. To add new stock, use Receive stock in the sidebar.
            </p>
          </div>

          <WorkspaceTabs<StockWorkspaceView>
            active={activeView}
            onChange={setActiveView}
            tabs={stockViews}
          />

          {activeView === "Control" ? (
            <div className="mt-5">
              <StockControlPanel
                products={products}
                adjustmentProduct={stock.adjustmentProduct}
                adjustmentProductId={stock.adjustmentProductId}
                onAdjustmentProductIdChange={stock.setAdjustmentProductId}
                adjustmentMode={stock.adjustmentMode}
                onAdjustmentModeChange={stock.setAdjustmentMode}
                adjustmentQuantity={stock.adjustmentQuantity}
                onAdjustmentQuantityChange={stock.setAdjustmentQuantity}
                adjustmentReason={stock.adjustmentReason}
                onAdjustmentReasonChange={stock.setAdjustmentReason}
                adjustmentBatchId={stock.adjustmentBatchId}
                onAdjustmentBatchIdChange={stock.setAdjustmentBatchId}
                adjustmentNote={stock.adjustmentNote}
                onAdjustmentNoteChange={stock.setAdjustmentNote}
                selectedProductBatches={stock.selectedProductBatches}
                recentAdjustments={stock.recentAdjustments}
                activeStockCount={stock.activeStockCount}
                countProductId={stock.countProductId}
                onCountProductIdChange={stock.setCountProductId}
                countedQuantity={stock.countedQuantity}
                onCountedQuantityChange={stock.setCountedQuantity}
                countSearch={stock.countSearch}
                onCountSearchChange={stock.setCountSearch}
                countLines={stock.countLines}
                onSaveStockAdjustment={stock.saveStockAdjustment}
                onBeginStockCount={stock.beginStockCount}
                onSaveCountLine={stock.saveCountLine}
                onPostStockCount={stock.postStockCount}
              />
            </div>
          ) : null}

          {activeView === "Lots" ? <BatchesPanel /> : null}

          {activeView === "Opening" ? <OpeningInventoryPanel /> : null}

          {activeView === "Recon" ? (
            <>
              {/* Reconciliation section (identical to ProductsPage Stock tools) */}
              <section className="card mt-5 overflow-hidden">
                <div className="flex items-center justify-between border-b px-5 py-4" style={{ borderColor: "var(--border)" }}>
                  <div>
                    <h2 className="text-[16px] font-bold" style={{ color: "var(--text)" }}>Inventory Reconciliation</h2>
                    <p className="text-[12px] mt-0.5" style={{ color: "var(--text-3)" }}>
                      Detect stock vs batch mismatches, orphan batches, and data integrity issues.
                    </p>
                  </div>
                  <button onClick={stock.runReconScan}
                    className="btn btn-default btn-sm" disabled={stock.reconLoading}>
                    {stock.reconLoading ? "Scanning..." : stock.reconIssues.length > 0 ? `Refresh` : "Run Scan"}
                  </button>
                </div>

                {stock.reconIssues.length > 0 ? (
                  <div className="overflow-x-auto">
                    <table className="min-w-full border-separate border-spacing-0 text-[13px]">
                      <thead>
                        <tr>
                          {["Product","Issue","Detail","Suggested Action"].map(h => (
                            <th key={h} className="border-b px-4 py-3 text-start text-[10px] font-bold uppercase tracking-[0.14em]"
                              style={{ borderColor: "var(--border)", color: "var(--text-3)" }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {stock.reconIssues.map((issue, i) => (
                          <tr key={i} className="t-row">
                            <td className="border-b px-4 py-3 font-semibold" style={{ borderColor: "var(--border)", color: "var(--text)" }}>
                              {issue.productName}
                            </td>
                            <td className="border-b px-4 py-3">
                              <span className="chip text-[10px] px-2 py-0.5 rounded font-bold" style={{
                                background: issue.severity === "error" ? "var(--danger-soft)" : "var(--warning-soft)",
                                color: issue.severity === "error" ? "var(--danger-text)" : "var(--warning-text)",
                              }}>{issue.type.replace(/_/g, " ")}</span>
                            </td>
                            <td className="border-b px-4 py-3 text-[12px]" style={{ borderColor: "var(--border)", color: "var(--text-2)" }}>
                              {issue.detail}
                            </td>
                            <td className="border-b px-4 py-3 text-[12px]" style={{ borderColor: "var(--border)", color: "var(--text-3)" }}>
                              {issue.suggestedAction}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : stock.reconIssues.length === 0 && !stock.reconLoading ? (
                  <div className="px-5 py-12 text-center text-[13px] font-medium" style={{ color: "var(--text-3)" }}>
                    Click 'Run Scan' to check inventory integrity.
                  </div>
                ) : null}
              </section>
              {/* POS-SYNC-AUTHORITY-2C-1: ledger-aware reconciliation (aggregate vs batches vs ledger) */}
              <LedgerReconciliationPanel />
            </>
          ) : null}
        </>
      )}
    </main>
  )
}

import { useEffect, useState } from "react"
import { Link, useSearchParams } from "react-router"
import { Download, PackagePlus } from "lucide-react"
import { useI18n } from "@lebanonpos/shared"

import type { Product } from "../../features/pos/types/product"
import StockControlPanel from "../../features/pos/components/StockControlPanel"
import OpeningInventoryPanel from "../../features/pos/components/OpeningInventoryPanel"
import LedgerReconciliationPanel from "../../features/pos/components/LedgerReconciliationPanel"
import LotsPanel from "../../features/pos/components/backoffice/LotsPanel"
import { PageHeader, SkeletonRows, StockNav } from "../../features/pos/components/backoffice/BackOffice"
import { downloadCsv } from "../../features/pos/lib/csv"
import { getInventoryBatches, type InventoryBatch } from "../../features/pos/services/inventoryBatch.service"
import { getProducts, subscribeProducts } from "../../features/pos/services/product.service"
import { subscribeSales } from "../../features/pos/services/sales.service"
import { userCan } from "../../features/pos/services/security.service"
import { useStockControl } from "../../features/pos/hooks/useStockControl"

// Midnight Gold v2 — Lots & counts (/stock). Lots is the default view (lot list + movement trace);
// Adjust & count, Opening inventory and Reconciliation are the existing panels and services, unchanged.
// Views are links (?view=…) so they survive reload; ?lot=<id> opens a lot, ?product=<id> scopes to a product.
type StockView = "Lots" | "Control" | "Opening" | "Recon"
const VIEWS: StockView[] = ["Lots", "Control", "Opening", "Recon"]
const isView = (v: string | null): v is StockView => VIEWS.includes(v as StockView)

export default function StockPage() {
  const { t } = useI18n()
  const [params, setParams] = useSearchParams()
  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState(true)
  const view: StockView = isView(params.get("view")) ? (params.get("view") as StockView) : "Lots"
  const productParam = params.get("product") ? Number(params.get("product")) : null
  const canReceive = userCan("inventory.receive")
  const canAdjust = userCan("inventory.adjust")

  useEffect(() => {
    let alive = true
    getProducts().then((d) => { if (alive) { setProducts(d); setLoading(false) } }).catch(() => { if (alive) setLoading(false) })
    const un1 = subscribeProducts((d) => { if (alive) setProducts(d) })
    const un2 = subscribeSales(() => { if (alive) setProducts((c) => [...c]) })
    return () => { alive = false; un1(); un2() }
  }, [])

  const selectedProduct = (productParam !== null ? products.find((p) => p.id === productParam) : undefined) ?? products[0]
  const stock = useStockControl(products, selectedProduct)
  const { setAdjustmentProductId } = stock
  // Deep link: /stock?view=Control&product=<id> preselects that product in the adjustment form.
  useEffect(() => {
    if (view === "Control" && productParam !== null && products.some((p) => p.id === productParam)) setAdjustmentProductId(productParam)
  }, [view, productParam, products, setAdjustmentProductId])

  function go(v: StockView, extra?: Record<string, string>) {
    const next = new URLSearchParams()
    if (v !== "Lots") next.set("view", v)
    for (const [k, val] of Object.entries(extra ?? {})) next.set(k, val)
    setParams(next)
  }
  function adjustLot(lot: InventoryBatch) {
    stock.setAdjustmentProductId(lot.productId)
    stock.setAdjustmentBatchId(lot.id)
    go("Control")
  }
  function exportLots() {
    downloadCsv(`lots-${new Date().toISOString().slice(0, 10)}.csv`,
      ["Lot", "Product", "Barcode", "Received", "Supplier", "PO", "Received qty", "Remaining", "Expiry", "Unit cost", "Value"],
      getInventoryBatches().map((b) => [b.batchNumber, b.productName, b.barcode, b.receivedAt.slice(0, 10), b.supplierName ?? "", b.purchaseOrderNumber ?? "", b.initialQuantity, b.quantityRemaining, b.expiryDate ?? "", b.unitCost, Math.round(b.quantityRemaining * b.unitCost * 100) / 100]))
  }
  const tab = (v: StockView, label: string) => (
    <Link to={v === "Lots" ? "/stock" : `/stock?view=${v}`} aria-current={view === v ? "page" : undefined}>{label}</Link>
  )

  return (
    <main className="mg2 mg2-bo min-h-0 flex-1 overflow-y-auto">
      <div className="mg2-wrap">
        <PageHeader eyebrow={t("inv.eyebrow")} title={t("inv.lots.title")} actions={<>
          <button type="button" className="mg2-btn" onClick={exportLots} aria-label={t("inv.lots.export")}><Download size={16} /><span className="hidden sm:inline">{t("inv.lots.export")}</span></button>
          {canReceive && <Link to="/products/new" className="mg2-btn mg2-btn-primary" style={{ textDecoration: "none" }}><PackagePlus size={16} />{t("inv.receive")}</Link>}
        </>} />
        <StockNav />
        <nav className="mg2-nav" aria-label={t("inv.lots.sections")} style={{ marginTop: -8 }}>
          {tab("Lots", t("inv.lots.tab.lots"))}
          {tab("Control", t("inv.lots.tab.control"))}
          {tab("Opening", t("inv.lots.tab.opening"))}
          {tab("Recon", t("inv.lots.tab.recon"))}
        </nav>
        {productParam !== null && view === "Lots" && (
          <div className="mg2-banner mg2-t-info" style={{ marginBottom: 12 }}>
            <span style={{ flex: 1 }}>{t("inv.lots.scoped", { name: products.find((p) => p.id === productParam)?.name ?? `#${productParam}` })}</span>
            <button type="button" className="mg2-btn" onClick={() => go("Lots")}>{t("inv.lots.show_all")}</button>
          </div>
        )}

        {loading ? <SkeletonRows /> : view === "Lots" ? (
          <LotsPanel initialLotId={params.get("lot")} productFilter={productParam} canAdjust={canAdjust} onAdjustLot={adjustLot} />
        ) : view === "Control" ? (
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
        ) : view === "Opening" ? (
          <OpeningInventoryPanel />
        ) : (
          <>
            <section className="mg2-card">
              <div className="mg2-card-head">
                <div>
                  <h2 className="mg2-section-title">{t("inv.recon.title")}</h2>
                  <p className="mg2-cap" style={{ margin: 0 }}>{t("inv.recon.help")}</p>
                </div>
                <button type="button" className="mg2-btn" onClick={stock.runReconScan} disabled={stock.reconLoading}>
                  {stock.reconLoading ? t("inv.recon.running") : stock.reconIssues.length > 0 ? t("inv.recon.refresh") : t("inv.recon.run")}
                </button>
              </div>
              {stock.reconIssues.length > 0 ? (
                <div className="mg2-table-wrap" style={{ border: 0, borderRadius: 0 }}>
                  <table className="mg2-table" aria-label={t("inv.recon.title")}>
                    <thead><tr><th>{t("inv.col.product")}</th><th>{t("inv.recon.issue")}</th><th className="p3">{t("inv.recon.detail")}</th><th className="p4">{t("inv.recon.action")}</th></tr></thead>
                    <tbody>
                      {stock.reconIssues.map((issue, i) => (
                        <tr key={i} style={{ cursor: "default" }}>
                          <td>{issue.productName}</td>
                          <td><span className={`mg2-badge ${issue.severity === "error" ? "t-err" : "t-warn"}`}>{issue.type.replace(/_/g, " ")}</span></td>
                          <td className="p3" style={{ color: "var(--text-2)" }}>{issue.detail}</td>
                          <td className="p4" style={{ color: "var(--text-2)" }}>{issue.suggestedAction}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : !stock.reconLoading ? <p className="mg2-cap" style={{ padding: 16, margin: 0 }}>{t("inv.recon.idle")}</p> : null}
            </section>
            <div style={{ marginTop: 16 }}><LedgerReconciliationPanel /></div>
          </>
        )}
      </div>
    </main>
  )
}

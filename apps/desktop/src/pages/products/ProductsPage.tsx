import { useEffect, useMemo, useState } from "react"
import { Link, useNavigate, useSearchParams } from "react-router"
import { AlertTriangle, ArrowDown, ArrowUp, Download, Lock, PackagePlus, Plus, Search, Star, Wrench, XCircle } from "lucide-react"
import { useI18n } from "@lebanonpos/shared"

import { useDebounce } from "../../hooks/useDebounce"
import type { Product } from "../../features/pos/types/product"
import AlertsPanel from "../../features/pos/components/AlertsPanel"
import BulkImportModal from "../../features/pos/components/BulkImportModal"
import CatalogCleanupPanel from "../../features/pos/components/CatalogCleanupPanel"
import { Badge, Drawer, EmptyState, FilterChip, PageHeader, SkeletonRows, StockNav } from "../../features/pos/components/backoffice/BackOffice"
import ProductDetailsDrawer from "../../features/pos/components/backoffice/ProductDetailsDrawer"
import ProductEditorDrawer from "../../features/pos/components/backoffice/ProductEditorDrawer"
import { downloadCsv } from "../../features/pos/lib/csv"
import { formatCurrency, formatNumber } from "../../features/pos/lib/currency"
import { daysToExpiry } from "../../features/pos/lib/lotTrace"
import { getApiUrl, getAuthToken } from "../../features/pos/services/sync.service"
import { getInventoryBatches, subscribeInventoryBatches, type InventoryBatch } from "../../features/pos/services/inventoryBatch.service"
import {
  archiveProduct, detectDuplicateBarcodes, getLowStockProducts, getNoBarcodeProducts, getProducts, productMatchesSearch,
  renameCategory, restoreProduct, sortProducts, subscribeProducts, updateProduct, type ProductSortKey, type SortDir,
} from "../../features/pos/services/product.service"
import { subscribeSales } from "../../features/pos/services/sales.service"
import { userCan } from "../../features/pos/services/security.service"
import { getSupplierLedger, subscribeSuppliers, type SupplierLedger } from "../../features/pos/services/supplier.service"
import {
  getDeadStockItems, getExpiryAlerts, getPromoSuggestions, getReorderSuggestions, groupReorderSuggestionsBySupplier,
} from "../../features/pos/services/stock.service"
import { showToast } from "../../features/pos/services/toast.service"

// Midnight Gold v2 — Products (DESIGN-SYSTEM §8 Back office / Lots; prototype 03-products-lots).
// Every control is wired to the existing product / batch / supplier services; quantities change
// only through receiving, sales and stock adjustments (updateProduct refuses stock edits).
type View = "all" | "low" | "out" | "expiring" | "nobarcode" | "duplicates" | "archived"
const VIEWS: View[] = ["all", "low", "out", "expiring", "nobarcode", "duplicates", "archived"]
type ReorderGroup = ReturnType<typeof groupReorderSuggestionsBySupplier>[number]

function margin(p: Product) {
  return p.price > 0 ? ((p.price - p.cost) / p.price) * 100 : null
}
function supplierOrderMessage(g: ReorderGroup) {
  return [
    `Purchase order request - ${g.supplierName}`,
    `Estimated cost: ${formatCurrency(g.totalCost)}`,
    "",
    ...g.items.filter((i) => i.suggestedQuantity > 0).map((i) => `- ${i.product.name}: ${formatNumber(i.suggestedQuantity)} units (${i.product.barcode})`),
  ].join("\n")
}

export default function ProductsPage() {
  const { t } = useI18n()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const [products, setProducts] = useState<Product[]>([])
  const [batches, setBatches] = useState<InventoryBatch[]>(() => getInventoryBatches())
  const [suppliers, setSuppliers] = useState<SupplierLedger[]>(() => getSupplierLedger())
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState(params.get("q") ?? "")
  const q = useDebounce(search, 150)
  const view = (VIEWS.includes(params.get("view") as View) ? params.get("view") : "all") as View
  const [category, setCategory] = useState("All")
  const [supplierId, setSupplierId] = useState("")
  const [sortKey, setSortKey] = useState<ProductSortKey>("name")
  const [sortDir, setSortDir] = useState<SortDir>("asc")
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [detailId, setDetailId] = useState<number | null>(params.get("product") ? Number(params.get("product")) : null)
  const [editor, setEditor] = useState<{ mode: "create" } | { mode: "edit"; id: number } | null>(null)
  const [tool, setTool] = useState<null | "import" | "cleanup" | "categories" | "alerts" | "menu">(null)
  const [bulk, setBulk] = useState<null | "category" | "price">(null)
  const [bulkCategory, setBulkCategory] = useState("")
  const [bulkField, setBulkField] = useState<"price" | "cost">("price")
  const [bulkMode, setBulkMode] = useState<"percent" | "fixed">("percent")
  const [bulkValue, setBulkValue] = useState("")
  const [generating, setGenerating] = useState(false)
  const canManage = userCan("inventory.manage")
  const canReceive = userCan("inventory.receive")

  useEffect(() => {
    let alive = true
    getProducts().then((d) => { if (alive) { setProducts(d); setLoading(false) } }).catch(() => { if (alive) setLoading(false) })
    const un1 = subscribeProducts((d) => { if (alive) setProducts(d) })
    const un2 = subscribeInventoryBatches(() => { if (alive) setBatches(getInventoryBatches()) })
    const un3 = subscribeSuppliers(() => { if (alive) setSuppliers(getSupplierLedger()) })
    const un4 = subscribeSales(() => { if (alive) setProducts((c) => [...c]) })
    return () => { alive = false; un1(); un2(); un3(); un4() }
  }, [])

  // Open lots per product, for the Lots column, the Expiring view and the details drawer.
  const lotsByProduct = useMemo(() => {
    const m = new Map<number, InventoryBatch[]>()
    for (const b of batches) if (b.quantityRemaining > 0) m.set(b.productId, [...(m.get(b.productId) ?? []), b])
    return m
  }, [batches])
  const duplicateSet = useMemo(() => new Set(detectDuplicateBarcodes(products).map((d) => d.barcode)), [products])
  const lowIds = useMemo(() => new Set(getLowStockProducts(products).filter((p) => p.stock > 0).map((p) => p.id)), [products])
  const noBarcodeIds = useMemo(() => new Set(getNoBarcodeProducts(products).map((p) => p.id)), [products])
  const activeProducts = useMemo(() => products.filter((p) => !p.archived), [products])
  const expiringIds = useMemo(() => new Set(activeProducts.filter((p) => {
    const lots = lotsByProduct.get(p.id) ?? []
    const dates = lots.map((b) => b.expiryDate).filter(Boolean) as string[]
    if (!lots.length && p.expiryDate) dates.push(p.expiryDate)
    return dates.some((d) => { const n = daysToExpiry(d); return n !== null && n <= 30 })
  }).map((p) => p.id)), [activeProducts, lotsByProduct])
  const inView = (p: Product, v: View) =>
    v === "archived" ? !!p.archived
      : p.archived ? false
      : v === "all" ? true
      : v === "low" ? lowIds.has(p.id)
      : v === "out" ? !p.isParent && p.stock <= 0
      : v === "expiring" ? expiringIds.has(p.id)
      : v === "nobarcode" ? noBarcodeIds.has(p.id)
      : !!p.barcode && duplicateSet.has(p.barcode)
  const counts = Object.fromEntries(VIEWS.map((v) => [v, products.filter((p) => inView(p, v)).length])) as Record<View, number>
  const categories = useMemo(() => Array.from(new Set(products.map((p) => p.category))).filter(Boolean).sort(), [products])

  const query = q.trim().toLowerCase()
  const list = sortProducts(products.filter((p) =>
    inView(p, view) &&
    (category === "All" || p.category === category) &&
    (!supplierId || p.supplierId === supplierId) &&
    (!query || productMatchesSearch(p, query))), sortKey, sortDir)

  const parentName = (p: Product) => (p.parentId ? products.find((x) => x.id === p.parentId)?.name : undefined)
  const variantCount = (p: Product) => products.filter((x) => x.parentId === p.id && !x.archived).length
  const visibleIds = list.map((p) => p.id)
  const allSelected = visibleIds.length > 0 && visibleIds.every((id) => selected.has(id))
  const selectedList = products.filter((p) => selected.has(p.id))
  const detail = detailId !== null ? products.find((p) => p.id === detailId) : undefined
  const reorder = useMemo(() => getReorderSuggestions(products), [products])

  function setView(v: View) {
    const next = new URLSearchParams(params); if (v === "all") next.delete("view"); else next.set("view", v)
    setParams(next, { replace: true }); setSelected(new Set())
  }
  function toggleSort(k: ProductSortKey) {
    if (sortKey === k) setSortDir((d) => (d === "asc" ? "desc" : "asc")); else { setSortKey(k); setSortDir("asc") }
  }
  function toggle(id: number) {
    setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })
  }
  function failure(err: unknown) { showToast(String((err as Error)?.message ?? err), "error") }
  function bulkArchive(restore: boolean) {
    let done = 0
    for (const p of selectedList) {
      try { if (restore) restoreProduct(p.id); else archiveProduct(p.id); done++ } catch (err) { failure(err); break }
    }
    if (done) showToast(t(restore ? "inv.bulk.restored" : "inv.bulk.archived", { n: done }))
    setSelected(new Set())
  }
  function bulkSetCategory() {
    const c = bulkCategory.trim()
    if (!c) { showToast(t("inv.bulk.need_category"), "error"); return }
    let done = 0
    try { for (const p of selectedList) if (updateProduct(p.id, { category: c })) done++ } catch (err) { failure(err) }
    showToast(t("inv.bulk.category_set", { n: done, category: c }))
    setBulk(null); setBulkCategory(""); setSelected(new Set())
  }
  function bulkPrice() {
    const v = parseFloat(bulkValue)
    if (!Number.isFinite(v) || v === 0) { showToast(t("inv.bulk.need_value"), "error"); return }
    let done = 0
    try {
      for (const p of selectedList) {
        if (p.isParent) continue
        const cur = bulkField === "price" ? p.price : p.cost
        const next = Math.max(0, bulkMode === "percent" ? cur * (1 + v / 100) : cur + v)
        if (updateProduct(p.id, { [bulkField]: Math.round(next * 100) / 100 })) done++
      }
    } catch (err) { failure(err) }
    showToast(t("inv.bulk.adjusted", { n: done }))
    setBulk(null); setBulkValue(""); setSelected(new Set())
  }
  function exportCsv(rows: Product[]) {
    downloadCsv(`products-${new Date().toISOString().slice(0, 10)}.csv`,
      ["Name", "Category", "Barcode", "Aliases", "Price", "Cost", "Stock", "Reorder point", "Reorder qty", "Supplier", "Archived"],
      rows.map((p) => [p.name, p.category, p.barcode ?? "", (p.barcodeAliases ?? []).join(" "), p.price, p.cost, p.stock, p.reorderPoint ?? "", p.reorderQuantity ?? "", p.supplierName ?? "", p.archived ? "yes" : ""]))
  }
  async function generateImages() {
    const apiUrl = getApiUrl(); const token = getAuthToken()
    if (!apiUrl || !token) { showToast(t("inv.tools.images_need_server"), "error"); return }
    setGenerating(true)
    try {
      const res = await fetch(`${apiUrl}/api/images/generate-all`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ force: true }) })
      if (!res.ok) throw new Error((await res.json().catch(() => ({ error: res.statusText }))).error || `HTTP ${res.status}`)
      const data = await res.json()
      for (const item of Array.isArray(data.products) ? data.products : []) if (item.image) updateProduct(item.id, { image: item.image })
      showToast(t("inv.tools.images_done", { n: data.generated ?? 0, total: data.total ?? 0 }))
    } catch (err) { showToast(t("inv.tools.images_failed", { reason: String((err as Error).message) }), "error") }
    finally { setGenerating(false) }
  }
  async function copyOrder(g: ReorderGroup) {
    try { await navigator.clipboard.writeText(supplierOrderMessage(g)); showToast(t("inv.copied")) }
    catch { showToast(t("inv.clipboard_blocked"), "error") }
  }

  const sortHead = (k: ProductSortKey, label: string, className?: string) => (
    <th className={className} aria-sort={sortKey === k ? (sortDir === "asc" ? "ascending" : "descending") : "none"}>
      <button type="button" className="mg2-sort" onClick={() => toggleSort(k)}>
        {label}{sortKey === k && (sortDir === "asc" ? <ArrowUp size={13} aria-hidden="true" /> : <ArrowDown size={13} aria-hidden="true" />)}
      </button>
    </th>
  )
  const noPermission = <span className="mg2-cap" id="inv-manage-why" style={{ display: "inline-flex", gap: 6, alignItems: "center" }}><Lock size={14} aria-hidden="true" />{t("inv.perm.manage")}</span>

  return (
    <main className="mg2 mg2-bo min-h-0 flex-1 overflow-y-auto">
      <div className="mg2-wrap">
        <PageHeader eyebrow={t("inv.eyebrow")} title={t("inv.products.title")} actions={<>
          <button type="button" className="mg2-btn" onClick={() => setTool(tool === "menu" ? null : "menu")} aria-expanded={tool === "menu"} aria-label={t("inv.tools.title")}><Wrench size={16} /><span className="hidden sm:inline">{t("inv.tools.title")}</span></button>
          <button type="button" className="mg2-btn" onClick={() => exportCsv(list)} aria-label={t("inv.export")}><Download size={16} /><span className="hidden sm:inline">{t("inv.export")}</span></button>
          {canReceive && <Link to="/products/new" className="mg2-btn" style={{ textDecoration: "none" }} aria-label={t("inv.receive")}><PackagePlus size={16} /><span className="hidden sm:inline">{t("inv.receive")}</span></Link>}
          <button type="button" className="mg2-btn mg2-btn-primary" onClick={() => setEditor({ mode: "create" })} disabled={!canManage} aria-describedby={canManage ? undefined : "inv-manage-why"}><Plus size={16} />{t("inv.products.add")}</button>
        </>} />
        {!canManage && <div style={{ marginTop: 8 }}>{noPermission}</div>}
        {tool === "menu" && (
          <div className="mg2-card" style={{ marginTop: 8, padding: 6, display: "flex", flexWrap: "wrap", gap: 6 }}>
            {canManage && <button type="button" className="mg2-btn mg2-btn-ghost" onClick={() => setTool("import")}>{t("inv.tools.import")}</button>}
            {canManage && <button type="button" className="mg2-btn mg2-btn-ghost" onClick={() => setTool("cleanup")}>{t("inv.tools.cleanup")}</button>}
            {canManage && <button type="button" className="mg2-btn mg2-btn-ghost" onClick={() => setTool("categories")}>{t("inv.tools.categories")}</button>}
            <button type="button" className="mg2-btn mg2-btn-ghost" onClick={() => setTool("alerts")}>{t("inv.tools.alerts", { n: reorder.length })}</button>
            {canManage && <button type="button" className="mg2-btn mg2-btn-ghost" disabled={generating} onClick={() => { setTool(null); void generateImages() }}>{generating ? t("inv.tools.images_running") : t("inv.tools.images")}</button>}
          </div>
        )}
        <StockNav counts={{ products: counts.all }} />

        {selected.size > 0 ? (
          <div className="mg2-bulkbar" role="region" aria-label={t("inv.bulk.label")}>
            <strong>{t("inv.bulk.selected", { n: selected.size })}</strong>
            {view === "archived"
              ? <button type="button" className="mg2-btn" disabled={!canManage} onClick={() => bulkArchive(true)}>{t("inv.restore")}</button>
              : <button type="button" className="mg2-btn" disabled={!canManage} onClick={() => bulkArchive(false)}>{t("inv.archive")}</button>}
            <button type="button" className="mg2-btn" disabled={!canManage} onClick={() => setBulk(bulk === "category" ? null : "category")} aria-expanded={bulk === "category"}>{t("inv.bulk.set_category")}</button>
            <button type="button" className="mg2-btn" disabled={!canManage} onClick={() => setBulk(bulk === "price" ? null : "price")} aria-expanded={bulk === "price"}>{t("inv.bulk.adjust")}</button>
            <button type="button" className="mg2-btn" onClick={() => exportCsv(selectedList)}><Download size={16} />{t("inv.export")}</button>
            <button type="button" className="mg2-btn mg2-btn-ghost" onClick={() => setSelected(new Set())}>{t("inv.bulk.clear")}</button>
            {!canManage && noPermission}
            {bulk === "category" && (
              <div style={{ display: "flex", gap: 8, flexBasis: "100%", flexWrap: "wrap" }}>
                <input className="mg2-input" list="inv-categories" value={bulkCategory} onChange={(e) => setBulkCategory(e.target.value)} aria-label={t("inv.field.category")} placeholder={t("inv.field.category")} autoFocus />
                <button type="button" className="mg2-btn mg2-btn-primary" onClick={bulkSetCategory}>{t("inv.apply")}</button>
              </div>
            )}
            {bulk === "price" && (
              <div style={{ display: "flex", gap: 8, flexBasis: "100%", flexWrap: "wrap", alignItems: "center" }}>
                <select className="mg2-select" value={bulkField} onChange={(e) => setBulkField(e.target.value as "price" | "cost")} aria-label={t("inv.bulk.field")}>
                  <option value="price">{t("inv.field.price")}</option><option value="cost">{t("inv.field.cost")}</option>
                </select>
                <select className="mg2-select" value={bulkMode} onChange={(e) => setBulkMode(e.target.value as "percent" | "fixed")} aria-label={t("inv.bulk.mode")}>
                  <option value="percent">{t("inv.bulk.percent")}</option><option value="fixed">{t("inv.bulk.fixed")}</option>
                </select>
                <input className="mg2-input num" type="number" step="0.01" inputMode="decimal" dir="ltr" value={bulkValue} onChange={(e) => setBulkValue(e.target.value)} aria-label={t("inv.bulk.value")} placeholder={bulkMode === "percent" ? "10" : "0.50"} style={{ width: 120 }} autoFocus />
                <button type="button" className="mg2-btn mg2-btn-primary" onClick={bulkPrice}>{t("inv.apply")}</button>
                <span className="mg2-cap">{t("inv.bulk.price_help", { n: selectedList.filter((p) => !p.isParent).length })}</span>
              </div>
            )}
          </div>
        ) : (
          <div className="mg2-toolbar">
            <div className="mg2-search">
              <Search size={16} aria-hidden="true" />
              <input className="mg2-input" type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t("inv.products.search")} aria-label={t("inv.products.search")} />
            </div>
            <select className="mg2-select" value={category} onChange={(e) => setCategory(e.target.value)} aria-label={t("inv.field.category")}>
              <option value="All">{t("inv.all_categories")}</option>
              {categories.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            {suppliers.length > 0 && (
              <select className="mg2-select" value={supplierId} onChange={(e) => setSupplierId(e.target.value)} aria-label={t("inv.field.supplier")}>
                <option value="">{t("inv.all_suppliers")}</option>
                {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            )}
          </div>
        )}
        <div className="mg2-chips" role="group" aria-label={t("inv.views")} style={{ marginBottom: 12 }}>
          {VIEWS.map((v) => (
            <FilterChip key={v} pressed={view === v} onClick={() => setView(v)} label={t(`inv.view.${v}`)} count={counts[v]}
              tone={v === "low" || v === "expiring" || v === "duplicates" ? "warn" : v === "out" ? "err" : undefined} />
          ))}
        </div>

        {loading ? <SkeletonRows /> : products.length === 0 ? (
          <div className="mg2-card"><EmptyState title={t("inv.products.empty_title")} text={t("inv.products.empty_text")}
            action={<div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "center" }}>
              {canReceive && <Link to="/products/new" className="mg2-btn" style={{ textDecoration: "none" }}>{t("inv.receive")}</Link>}
              <button type="button" className="mg2-btn mg2-btn-primary" disabled={!canManage} onClick={() => setEditor({ mode: "create" })}>{t("inv.products.add")}</button>
            </div>} /></div>
        ) : list.length === 0 ? (
          <div className="mg2-card"><EmptyState title={t("inv.products.no_match")} text={t("inv.products.no_match_text")}
            action={<button type="button" className="mg2-btn" onClick={() => { setSearch(""); setCategory("All"); setSupplierId(""); setView("all") }}>{t("inv.clear_filters")}</button>} /></div>
        ) : (
          <div className="mg2-table-wrap">
            <table className="mg2-table" aria-label={t("inv.products.table")}>
              <thead>
                <tr>
                  <th style={{ width: 44 }}>
                    <input type="checkbox" className="mg2-check" checked={allSelected} aria-label={t("inv.bulk.select_all")}
                      onChange={() => setSelected(allSelected ? new Set() : new Set(visibleIds))} />
                  </th>
                  {sortHead("name", t("inv.col.product"))}
                  {sortHead("category", t("inv.col.category"), "p3")}
                  {sortHead("price", t("inv.col.price"), "num")}
                  {sortHead("cost", t("inv.col.cost"), "num p4")}
                  {sortHead("margin", t("inv.col.margin"), "num p4")}
                  {sortHead("stock", t("inv.col.stock"), "num")}
                  <th className="end p3">{t("inv.col.lots")}</th>
                </tr>
              </thead>
              <tbody>
                {list.map((p) => {
                  const lots = lotsByProduct.get(p.id) ?? []
                  const soon = lots.filter((b) => { const n = daysToExpiry(b.expiryDate); return n !== null && n <= 30 }).length
                  const m = margin(p)
                  const reorderAt = p.reorderPoint ?? 10
                  const stockTone = p.isParent ? null : p.stock <= 0 ? "err" : p.stock <= reorderAt ? "warn" : null
                  return (
                    <tr key={p.id} aria-selected={selected.has(p.id) || detailId === p.id} onClick={() => setDetailId(p.id)}>
                      <td onClick={(e) => e.stopPropagation()}>
                        <input type="checkbox" className="mg2-check" checked={selected.has(p.id)} onChange={() => toggle(p.id)} aria-label={t("inv.bulk.select", { name: p.name })} />
                      </td>
                      <td>
                        <button type="button" className="mg2-sort" style={{ textAlign: "start", fontWeight: 600 }} onClick={(e) => { e.stopPropagation(); setDetailId(p.id) }}>
                          {p.favorite && <Star size={13} aria-label={t("inv.favorite")} style={{ color: "var(--brand)" }} />}{p.name}
                        </button>
                        <span className="sub">
                          <span className="code">{p.barcode || t("inv.no_barcode")}</span>
                          {p.parentId ? <> · {t("inv.variant_of", { name: parentName(p) ?? "" })}</> : p.isParent ? <> · {t("inv.variants_n", { n: variantCount(p) })}</> : null}
                          {p.archived && <> · <Badge tone="muted">{t("inv.archived")}</Badge></>}
                          {p.barcode && duplicateSet.has(p.barcode) && <> · <Badge tone="warn">{t("inv.duplicate_barcode")}</Badge></>}
                        </span>
                      </td>
                      <td className="p3">{p.category}</td>
                      <td className="num">{formatCurrency(p.price)}</td>
                      <td className="num p4" style={{ color: "var(--text-2)" }}>{formatCurrency(p.cost)}</td>
                      <td className="num p4" style={{ color: m === null ? "var(--text-3)" : m < 10 ? "var(--v2-err)" : m < 25 ? "var(--v2-warn)" : "var(--text-2)" }}>{m === null ? "—" : `${Math.round(m)}%`}</td>
                      <td className="num">
                        {p.isParent ? <span style={{ color: "var(--text-3)" }}>—</span>
                          : stockTone === "err" ? <Badge tone="err" icon={<XCircle size={13} aria-hidden="true" />}>{t("inv.stock_out", { n: formatNumber(p.stock) })}</Badge>
                          : stockTone === "warn" ? <Badge tone="warn" icon={<AlertTriangle size={13} aria-hidden="true" />}>{t("inv.stock_low", { n: formatNumber(p.stock) })}</Badge>
                          : formatNumber(p.stock)}
                      </td>
                      <td className="end p3" style={{ color: "var(--text-2)" }}>
                        {lots.length === 0 ? <span style={{ color: "var(--text-3)" }}>{p.stock > 0 ? t("inv.lots_untracked") : "—"}</span>
                          : <>{t("inv.lots_n", { n: lots.length })}{soon > 0 && <> · <span style={{ color: "var(--v2-warn)" }}>{t("inv.lots_expiring", { n: soon })}</span></>}</>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
        {!loading && list.length > 0 && <p className="mg2-cap" style={{ marginTop: 8 }}>{t("inv.products.footer", { shown: list.length, value: formatCurrency(activeProducts.reduce((s, p) => s + p.stock * p.cost, 0)) })}</p>}
      </div>

      <datalist id="inv-categories">{categories.map((c) => <option key={c} value={c} />)}</datalist>

      {detail && (
        <ProductDetailsDrawer product={detail} products={products} lots={lotsByProduct.get(detail.id) ?? []} canManage={canManage} canReceive={canReceive}
          onClose={() => setDetailId(null)}
          onEdit={() => setEditor({ mode: "edit", id: detail.id })}
          onOpenLot={(lotId) => navigate(`/stock?lot=${encodeURIComponent(lotId)}`)} />
      )}
      {editor && (
        <ProductEditorDrawer mode={editor.mode} product={editor.mode === "edit" ? products.find((p) => p.id === editor.id) : undefined}
          products={products} categories={categories} suppliers={suppliers}
          onClose={() => setEditor(null)}
          onSaved={(p) => { setEditor(null); setDetailId(p.id) }} />
      )}
      {tool === "import" && <BulkImportModal products={products} onClose={() => setTool(null)} onImported={() => getProducts().then(setProducts)} />}
      {tool === "cleanup" && <CatalogCleanupPanel products={products} onClose={() => setTool(null)} onChanged={() => getProducts().then(setProducts)} onEditProduct={(p) => { setTool(null); setEditor({ mode: "edit", id: p.id }) }} />}
      <Drawer open={tool === "categories"} title={t("inv.tools.categories")} onClose={() => setTool(null)}>
        <p className="mg2-cap" style={{ margin: 0 }}>{t("inv.categories.help")}</p>
        {categories.map((c) => (
          <label key={c} className="mg2-field">
            <span className="lbl">{c} · {t("inv.products_n", { n: products.filter((p) => p.category === c).length })}</span>
            <input className="mg2-input" defaultValue={c} aria-label={t("inv.categories.rename", { name: c })}
              onBlur={(e) => {
                const n = e.target.value.trim()
                if (!n || n === c) return
                try { renameCategory(c, n); showToast(t("inv.categories.renamed", { from: c, to: n })) } catch (err) { failure(err) }
              }} />
          </label>
        ))}
      </Drawer>
      <Drawer open={tool === "alerts"} wide title={t("inv.tools.alerts", { n: reorder.length })} onClose={() => setTool(null)}>
        <AlertsPanel reorderSuggestions={reorder} reorderGroups={groupReorderSuggestionsBySupplier(reorder)}
          expiryAlerts={getExpiryAlerts(products, 30)} deadStockItems={getDeadStockItems(products, 60)} promoSuggestions={getPromoSuggestions(products)}
          buildSupplierOrderMessage={supplierOrderMessage} copySupplierOrder={(g) => { void copyOrder(g) }}
          onWriteOffProduct={() => navigate("/stock?view=Control")}
          onViewProduct={(id) => { setTool(null); setDetailId(id) }}
          onReceiveProduct={() => navigate("/products/new")} />
      </Drawer>
    </main>
  )
}

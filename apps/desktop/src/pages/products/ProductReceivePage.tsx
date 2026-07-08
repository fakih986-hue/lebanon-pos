import { useEffect, useMemo, useRef, useState } from "react"
import type { ChangeEvent } from "react"
import {
  Banknote, Barcode, Building2, Camera, CheckCircle2, ClipboardCheck,
  Copy, CreditCard, Landmark, LoaderCircle, PackagePlus, Plus, Printer,
  RotateCcw, Search, Trash2, WalletCards,
} from "lucide-react"
import { Link } from "react-router"
import Spinner from "../../components/ui/Spinner"
import { renderCode128Svg } from "../../features/pos/lib/barcode"
import {
  createBarcodeDetector, createHtml5Qrcode, detectBarcodeFromImageFile,
  getCameraErrorMessage, getHtml5QrcodeFormatCodes, getLiveCameraIssue,
  getPreferredCameraConstraints,
  type BrowserBarcodeDetector, type Html5QrcodeInstance,
} from "../../features/pos/lib/cameraScanner"
import { formatCurrency, formatNumber } from "../../features/pos/lib/currency"
import { createId } from "../../features/pos/lib/storage"
import {
  findProductByBarcode, generateProductBarcode,
  getProducts, receiveProducts, updateProduct,
  parseSpreadsheetPaste,
} from "../../features/pos/services/product.service"
import { recordAuditEvent } from "../../features/pos/services/security.service"
import { getSettings } from "../../features/pos/services/settings.service"
import {
  getSupplierLedger, recordPurchaseOrder, subscribeSuppliers,
  type PurchasePaymentMethod, type SupplierLedger,
} from "../../features/pos/services/supplier.service"
import type { Product, ProductAccent } from "../../features/pos/types/product"
import { showToast } from "../../features/pos/services/toast.service"
import { useI18n } from "@lebanonpos/shared"

type BatchRow = {
  id: string; name: string; category: string; quantity: number
  cost: number; price: number; reorderPoint: number; reorderQuantity: number
  expiryDate: string; barcode: string; labels: number; accent: ProductAccent
}
type LabelSize = "40x25" | "50x30" | "58x35"

const purchasePaymentMethods: PurchasePaymentMethod[] = [
  "On Account", "Cash", "Card", "Bank Transfer", "Wallet",
]
const labelSizes: Record<LabelSize, { label: string; width: string; height: string }> = {
  "40x25": { label: "40×25", width: "40mm", height: "25mm" },
  "50x30": { label: "50×30", width: "50mm", height: "30mm" },
  "58x35": { label: "58×35", width: "58mm", height: "35mm" },
}
const pmIcons: Record<string, typeof Banknote> = {
  Cash: Banknote, Card: CreditCard, Wallet: WalletCards,
  "Bank Transfer": Landmark, "On Account": ClipboardCheck,
}
const accents: ProductAccent[] = ["emerald", "cyan", "amber", "rose", "violet", "indigo"]
const RECEIVE_CAMERA_READER_ID = "lebanonpos-receive-camera-reader"

function createRow(defaults?: Partial<BatchRow>): BatchRow {
  return { id: createId(), name: "", category: "", quantity: 0, cost: 0, price: 0, reorderPoint: 10, reorderQuantity: 20, expiryDate: "", barcode: "", labels: 1, accent: accents[Math.floor(Math.random() * accents.length)], ...defaults }
}
function escapeHtml(v: string) { return v.replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#039;") }
function normalizeNumber(v: string) { const n = Number(v); return Number.isFinite(n) ? n : 0 }
function isRowReady(row: BatchRow) { return row.name.trim().length > 0 && row.barcode.trim().length > 0 && row.quantity > 0 }

export default function ProductReceivePage() {
  const { t } = useI18n()
  const [products, setProducts] = useState<Product[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [suppliers, setSuppliers] = useState<SupplierLedger[]>(getSupplierLedger())
  const [rows, setRows] = useState<BatchRow[]>([createRow()])
  const [activeRowId, setActiveRowId] = useState(rows[0].id)
  const [cameraStatus, setCameraStatus] = useState("")
  const [cameraEngine, setCameraEngine] = useState<"native" | "html5" | null>(null)
  const [labelSize, setLabelSize] = useState<LabelSize>("50x30")
  const [lastReceivedTotal, setLastReceivedTotal] = useState(0)
  const [selectedSupplierId, setSelectedSupplierId] = useState("")
  const [purchasePaymentMethod, setPurchasePaymentMethod] = useState<PurchasePaymentMethod>("On Account")
  const [supplierInvoiceNumber, setSupplierInvoiceNumber] = useState("")
  const [supplierNote, setSupplierNote] = useState("")
  const [barcodeSuggestions, setBarcodeSuggestions] = useState<Record<string, { name: string; category: string } | null>>({})

  const videoRef = useRef<HTMLVideoElement | null>(null)
  const scanCaptureInputRef = useRef<HTMLInputElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const frameRef = useRef<number | null>(null)
  const detectorRef = useRef<BrowserBarcodeDetector | null>(null)
  const html5ScannerRef = useRef<Html5QrcodeInstance | null>(null)
  // Per-row barcode input refs — USB scanner fires into the active row's barcode field
  const barcodeRefs = useRef<Record<string, HTMLInputElement | null>>({})

  useEffect(() => {
    let active = true
    getProducts().then((data) => { if (active) { setProducts(data); setIsLoading(false) } })
    const unsub = subscribeSuppliers(() => setSuppliers(getSupplierLedger()))
    return () => { active = false; unsub(); stopCamera() }
  }, [])

  // Auto-focus the barcode field of the active row so USB scanners fire into it
  useEffect(() => {
    const el = barcodeRefs.current[activeRowId]
    if (el) el.focus()
  }, [activeRowId])

  const categories = useMemo(() => Array.from(new Set(products.map((p) => p.category))), [products])
  const readyRows = rows.filter(isRowReady)
  const totalUnits = readyRows.reduce((s, r) => s + r.quantity, 0)
  const totalCost = readyRows.reduce((s, r) => s + r.quantity * r.cost, 0)
  const labelsToPrint = rows.reduce((s, r) => s + (r.barcode.trim() ? Math.max(0, r.labels) : 0), 0)
  const selectedSupplier = suppliers.find((s) => s.id === selectedSupplierId)

  function updateRow(id: string, patch: Partial<BatchRow>) {
    setRows((rows) => rows.map((r) => r.id === id ? { ...r, ...patch } : r))
  }
  function addRow(defaults?: Partial<BatchRow>) {
    const row = createRow(defaults)
    setRows((rows) => [...rows, row])
    setActiveRowId(row.id)
  }
  function removeRow(id: string) {
    setRows((rows) => {
      const next = rows.filter((r) => r.id !== id)
      if (next.length === 0) { const row = createRow(); setActiveRowId(row.id); return [row] }
      if (activeRowId === id) setActiveRowId(next[0].id)
      return next
    })
  }
  function fillRowFromBarcode(row: BatchRow, barcode: string): BatchRow {
    const product = findProductByBarcode(barcode)
    if (!product) return { ...row, barcode, name: "", category: "Pantry", price: 0, cost: 0, reorderPoint: 10, reorderQuantity: 20, expiryDate: "" }
    return { ...row, name: product.name, category: product.category, price: product.price, cost: product.cost, reorderPoint: product.reorderPoint ?? 10, reorderQuantity: product.reorderQuantity ?? 20, expiryDate: product.expiryDate ?? "", barcode: product.barcode, accent: product.accent }
  }
  function applyBarcodeToActiveRow(barcode: string) {
    const clean = barcode.trim().replace(/\s+/g, "")
    if (!clean) return
    setRows((rows) => rows.map((r) => r.id !== activeRowId ? r : fillRowFromBarcode(r, clean)))
    const product = findProductByBarcode(clean)
    showToast(product ? `Loaded: ${product.name}` : `New barcode: ${clean}`)
  }
  function handleBarcodeInput(rowId: string, value: string) {
    setRows((rows) => rows.map((r) => r.id !== rowId ? r : { ...r, barcode: value }))
    if (activeRowId !== rowId) return
    const clean = value.trim().replace(/\s+/g, "")
    if (!clean) return
    const product = findProductByBarcode(clean)
    if (product) {
      setRows((rows) => rows.map((r) => r.id !== rowId ? r : fillRowFromBarcode(r, clean)))
      return
    }
    // Barcode not in local DB — try Open Food Facts
    lookupBarcode(rowId, clean)
  }

  async function lookupBarcode(rowId: string, barcode: string) {
    if (barcode.length < 8) return
    if (barcodeSuggestions[barcode] !== undefined) {
      setBarcodeSuggestions((prev) => ({ ...prev, [barcode]: prev[barcode] }))
      return
    }
    setBarcodeSuggestions((prev) => ({ ...prev, [barcode]: null }))

    // 1. UPCitemdb — 707M products, free tier (100/day), no key needed
    try {
      const res = await fetch(`https://api.upcitemdb.com/prod/trial/lookup?upc=${encodeURIComponent(barcode)}`)
      if (res.ok) {
        const data = await res.json()
        if (data?.items?.[0]) {
          const item = data.items[0]
          const suggestion = {
            name: (item.title || item.description || "").trim(),
            category: (item.category || "General"),
          }
          if (suggestion.name) {
            setBarcodeSuggestions((prev) => ({ ...prev, [barcode]: suggestion }))
            return
          }
        }
      }
    } catch { /* try next */ }

    // 2. Open Food Facts — food, beverages
    // 3. Open Beauty Facts — cosmetics, personal care
    // 4. Open Products Facts — general consumer goods
    const fallbacks = [
      { url: "https://world.openfoodfacts.org" },
      { url: "https://world.openbeautyfacts.org" },
      { url: "https://world.openproductsfacts.org" },
    ]

    for (const db of fallbacks) {
      try {
        const res = await fetch(`${db.url}/api/v2/product/${encodeURIComponent(barcode)}.json`)
        if (!res.ok) continue
        const data = await res.json()
        if (data?.product?.product_name) {
          const suggestion = {
            name: data.product.product_name as string,
            category: (data.product.categories_tags?.[0] || "").replace("en:", "").replace(/-/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase()) || "General",
          }
          setBarcodeSuggestions((prev) => ({ ...prev, [barcode]: suggestion }))
          return
        }
      } catch { /* try next */ }
    }
  }

  function applySuggestion(rowId: string, barcode: string) {
    const suggestion = barcodeSuggestions[barcode]
    if (!suggestion) return
    updateRow(rowId, {
      name: suggestion.name,
      category: suggestion.category,
      barcode,
    })
    setBarcodeSuggestions((prev) => { const next = { ...prev }; delete next[barcode]; return next })
  }
  function generateBarcodeForRow(id: string) {
    updateRow(id, { barcode: generateProductBarcode() })
    setActiveRowId(id)
    showToast(t("pos.receive.barcode_generated"))
  }
  function duplicateRow(row: BatchRow) {
    addRow({ name: row.name, category: row.category, cost: row.cost, price: row.price, quantity: row.quantity, reorderPoint: row.reorderPoint, reorderQuantity: row.reorderQuantity, expiryDate: row.expiryDate, labels: row.labels, accent: row.accent, barcode: "" })
  }
  function saveBatch() {
    if (readyRows.length === 0) { showToast(t("pos.receive.no_ready_rows"), "error"); return }
    const result = receiveProducts(readyRows.map((r) => ({ name: r.name, category: r.category, cost: r.cost, price: r.price, stock: r.quantity, barcode: r.barcode, accent: r.accent, reorderPoint: r.reorderPoint, reorderQuantity: r.reorderQuantity, expiryDate: r.expiryDate, supplierId: selectedSupplier?.id, supplierName: selectedSupplier?.name })))
    const { errors, rejectedCount } = result ?? { errors: [], rejectedCount: 0 }
    getProducts().then(setProducts)
    setLastReceivedTotal(totalUnits)
    let poNumber = ""
    if (selectedSupplier && totalCost > 0) {
      try {
        const po = recordPurchaseOrder({ supplierId: selectedSupplier.id, supplierName: selectedSupplier.name, status: "Received", invoiceNumber: supplierInvoiceNumber, note: supplierNote, paymentMethod: purchasePaymentMethod, paidAmount: purchasePaymentMethod === "On Account" ? 0 : totalCost, items: readyRows.map((r) => ({ name: r.name, barcode: r.barcode, quantity: r.quantity, unitCost: r.cost, unitPrice: r.price, total: r.quantity * r.cost })) })
        poNumber = po.poNumber
        setSuppliers(getSupplierLedger())
      } catch { }
    }
    recordAuditEvent({ action: "inventory.receive", entity: "inventory", summary: `${totalUnits} units received.`, metadata: { rows: readyRows.length, totalUnits, totalCost } })
    if (rejectedCount > 0) {
      showToast(`${formatNumber(totalUnits)} units received · ${rejectedCount} row(s) rejected. See receiving log.`, "error")
      for (const err of errors) showToast(err, "error")
    } else {
      showToast(`${formatNumber(totalUnits)} units received${poNumber ? ` · ${poNumber}` : ""}.`)
    }
  }
  function pasteFromSpreadsheet() {
    const text = prompt("Paste spreadsheet data (Name, Barcode, Category, Qty, Cost, Price):")
    if (!text?.trim()) return
    const { rows: parsed, rejected } = parseSpreadsheetPaste(text)
    parsed.forEach(r => addRow({ name: r.name, barcode: r.barcode, category: r.category, quantity: r.quantity, cost: r.cost, price: r.price }))
    if (rejected.length > 0) {
      showToast(`${parsed.length} rows added · ${rejected.length} rejected: ${rejected.map(r => `Row ${r.index}: ${r.reason}`).join("; ")}`, "error")
    } else {
      showToast(`${parsed.length} rows imported.`)
    }
    if (parsed.length > 0) setActiveRowId("")
  }
  function resetBatch() {
    const row = createRow()
    setRows([row]); setActiveRowId(row.id); setLastReceivedTotal(0)
    setSupplierInvoiceNumber(""); setSupplierNote(""); showToast(t("pos.receive.batch_cleared"))
  }

  async function startCamera() {
    if (cameraEngine) { stopCamera(); setCameraStatus(""); return }
    const issue = getLiveCameraIssue()
    if (issue) { setCameraStatus(issue); scanCaptureInputRef.current?.click(); return }
    try {
      const detector = await createBarcodeDetector()
      if (!detector) {
        setCameraEngine("html5"); setCameraStatus("Starting…")
        await new Promise<void>((r) => window.requestAnimationFrame(() => r()))
        const scanner = await createHtml5Qrcode(RECEIVE_CAMERA_READER_ID)
        if (!scanner) { stopCamera(); setCameraStatus(t("pos.receive.camera_engine_failed")); return }
        html5ScannerRef.current = scanner
        await scanner.start({ facingMode: "environment" }, { fps: 12, qrbox: { width: 260, height: 160 }, formatsToSupport: getHtml5QrcodeFormatCodes() }, (text) => { applyBarcodeToActiveRow(text); setCameraStatus(""); stopCamera() })
        setCameraStatus("Camera ready — point at barcode"); return
      }
      const stream = await navigator.mediaDevices.getUserMedia(getPreferredCameraConstraints())
      streamRef.current = stream
      if (videoRef.current) { videoRef.current.srcObject = stream; videoRef.current.muted = true; videoRef.current.setAttribute("playsinline", "true"); await videoRef.current.play() }
      detectorRef.current = detector; setCameraEngine("native"); setCameraStatus("Camera ready"); void scanCameraFrame()
    } catch (err) { stopCamera(); setCameraStatus(getCameraErrorMessage(err)) }
  }
  async function handleScanCapture(e: ChangeEvent<HTMLInputElement>) {
    const file = e.currentTarget.files?.[0]; e.currentTarget.value = ""
    if (!file) return
    try { const bc = await detectBarcodeFromImageFile(file); if (!bc) { showToast("No barcode found", "error"); return } applyBarcodeToActiveRow(bc) }
    catch { showToast("Scan failed", "error") }
  }
  function stopCamera() {
    if (frameRef.current) { window.cancelAnimationFrame(frameRef.current); frameRef.current = null }
    streamRef.current?.getTracks().forEach((t) => t.stop()); streamRef.current = null; detectorRef.current = null
    const s = html5ScannerRef.current; html5ScannerRef.current = null
    if (s) void s.stop().catch(() => undefined).finally(() => s.clear())
    if (videoRef.current) videoRef.current.srcObject = null
    setCameraEngine(null)
  }
  async function scanCameraFrame() {
    const d = detectorRef.current; const v = videoRef.current
    if (!d || !v) return
    try { const r = await d.detect(v); const bc = r[0]?.rawValue; if (bc) { applyBarcodeToActiveRow(bc); setCameraStatus(""); stopCamera(); return } }
    catch { }
    frameRef.current = window.requestAnimationFrame(() => void scanCameraFrame())
  }
  function printLabels() {
    const labels = rows.filter((r) => r.barcode.trim() && r.name.trim()).flatMap((r) => Array.from({ length: Math.max(0, r.labels) }, () => ({ name: r.name, price: r.price, barcode: r.barcode })))
    if (labels.length === 0) { showToast(t("pos.receive.print_labels_incomplete"), "error"); return }
    const size = labelSizes[labelSize]
    const html = labels.map((l) => `<section class="label"><div class="name">${escapeHtml(l.name)}</div><div class="barcode">${renderCode128Svg(l.barcode, 54, 2)}</div><div class="meta"><span>${escapeHtml(l.barcode)}</span><strong>${escapeHtml(formatCurrency(l.price))}</strong></div></section>`).join("")
    const win = window.open("", "print-labels")
    if (!win) { showToast(t("pos.receive.popup_blocked"), "error"); return }
    win.document.write(`<!doctype html><html><head><style>@page{size:${size.width} ${size.height};margin:0}*{box-sizing:border-box}body{margin:0;font-family:Arial,sans-serif;color:#000}.label{width:${size.width};height:${size.height};page-break-after:always;padding:2mm;display:flex;flex-direction:column;justify-content:space-between;overflow:hidden}.name{font-size:10px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.barcode{height:14mm}.barcode svg{width:100%;height:100%;display:block}.meta{display:flex;align-items:center;justify-content:space-between;font-size:8px;gap:2mm}</style></head><body>${html}</body></html>`)
    win.document.close(); win.focus(); window.setTimeout(() => win.print(), 250)
    showToast(`${labels.length} labels sent to printer.`)
  }

  if (isLoading) return (
    <main className="flex min-h-0 flex-1 items-center justify-center bg-page">
      <Spinner label={t("pos.loading_products")} />
    </main>
  )

  return (
    <main className="min-h-0 flex-1 overflow-y-auto bg-page">
      <div className="mx-auto max-w-7xl p-4 sm:p-6 space-y-5">

        {/* ── Page header ───────────────────────────────── */}
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-[22px] font-bold tracking-tight" style={{ color: "var(--text)" }}>
              Receive Inventory
            </h1>
            <p className="text-[13px] mt-0.5" style={{ color: "var(--text-3)" }}>
              Scan or enter products to add to stock
            </p>
          </div>

          {/* KPI chips */}
          <div className="flex flex-wrap items-center gap-2">
            {[
              { label: "Ready",  value: readyRows.length,         accent: readyRows.length > 0 },
              { label: "Units",  value: formatNumber(totalUnits),  accent: false },
              { label: "Cost",   value: formatCurrency(totalCost), accent: false },
              { label: "Labels", value: formatNumber(labelsToPrint), accent: false },
            ].map((k) => (
              <div
                key={k.label}
                className="rounded-xl px-3 py-1.5"
                style={k.accent
                  ? { background: "var(--brand-soft)", border: "1px solid var(--brand-border)" }
                  : { background: "var(--surface)", border: "1px solid var(--border)" }
                }
              >
                <span className="text-[10px] font-semibold uppercase tracking-wide me-1.5" style={{ color: "var(--text-3)" }}>{k.label}</span>
                <span className="text-[14px] font-bold tabular-nums" style={{ color: k.accent ? "var(--brand)" : "var(--text)" }}>{k.value}</span>
              </div>
            ))}

            <div className="flex gap-2 ms-1">
              <button type="button" onClick={() => addRow()}
                className="btn btn-default h-9 gap-1.5 text-[13px]">
                <Plus size={14} /> Add Row
              </button>
              <button type="button" onClick={pasteFromSpreadsheet}
                className="btn btn-default h-9 gap-1.5 text-[13px]" title="Paste from spreadsheet">
                Paste
              </button>
              <button type="button" onClick={saveBatch} disabled={readyRows.length === 0}
                className="btn btn-primary h-9 gap-1.5 text-[13px] disabled:opacity-40">
                <CheckCircle2 size={14} /> Save Batch
              </button>
            </div>
          </div>
        </div>

        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">

          {/* ── Left: Product rows ──────────────────────── */}
          <section className="space-y-3">

            {rows.map((row, idx) => {
              const active = activeRowId === row.id
              const ready = isRowReady(row)
              const matched = row.barcode ? findProductByBarcode(row.barcode) : null

              return (
                <div
                  key={row.id}
                  className="rounded-2xl overflow-hidden transition-all duration-150"
                  style={{
                    background: "var(--surface)",
                    border: "1.5px solid",
                    borderColor: active ? "var(--brand)" : "var(--border)",
                    boxShadow: active ? "0 0 0 3px var(--brand-soft)" : "var(--shadow-xs)",
                  }}
                  onClick={() => setActiveRowId(row.id)}
                >
                  {/* Row header */}
                  <div className="flex items-center gap-3 px-4 py-3 border-b" style={{ borderColor: "var(--border)" }}>
                    {/* Row number / ready indicator */}
                    <span
                      className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold"
                      style={ready
                        ? { background: "var(--brand-soft)", color: "var(--brand)" }
                        : { background: "var(--surface-2)", color: "var(--text-3)" }
                      }
                    >
                      {ready ? "✓" : idx + 1}
                    </span>

                    {/* Barcode input — USB scanner fires here when row is active */}
                    <div className="flex min-w-0 flex-1 items-center gap-2">
                      <Barcode size={14} className="shrink-0" style={{ color: "var(--text-3)" }} />
                      <input
                        ref={(el) => { barcodeRefs.current[row.id] = el }}
                        value={row.barcode}
                        onChange={(e) => handleBarcodeInput(row.id, e.target.value)}
                        onFocus={() => setActiveRowId(row.id)}
                        placeholder="Barcode — scan or type"
                        className="min-w-0 flex-1 bg-transparent text-[13px] font-mono outline-none placeholder:text-[var(--text-3)]"
                        style={{ color: "var(--text)" }}
                      />
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); generateBarcodeForRow(row.id) }}
                        className="shrink-0 flex items-center gap-1 h-7 rounded-lg border px-2.5 text-[11px] font-semibold transition hover:opacity-80"
                        style={{ borderColor: "var(--border)", color: "var(--text-3)", background: "var(--surface-2)" }}
                        title="Generate barcode"
                      >
                        <Barcode size={11} /> Gen
                      </button>
                      {/* Camera scan button — for this specific row */}
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); setActiveRowId(row.id); startCamera() }}
                        className="shrink-0 flex h-7 w-7 items-center justify-center rounded-lg border transition"
                        style={active && cameraEngine
                          ? { background: "rgba(239,68,68,0.10)", borderColor: "rgba(239,68,68,0.28)", color: "var(--danger)" }
                          : { borderColor: "var(--border)", color: "var(--text-3)", background: "var(--surface-2)" }
                        }
                        title="Scan via camera"
                      >
                        <Camera size={11} />
                      </button>
                    </div>

                    {/* Row actions */}
                    <div className="flex items-center gap-1 shrink-0">
                      <button type="button" onClick={(e) => { e.stopPropagation(); duplicateRow(row) }}
                        className="flex h-7 w-7 items-center justify-center rounded-lg border transition hover:opacity-80"
                        style={{ borderColor: "var(--border)", color: "var(--text-3)" }} title="Duplicate">
                        <Copy size={12} />
                      </button>
                      <button type="button" onClick={(e) => { e.stopPropagation(); removeRow(row.id) }}
                        className="flex h-7 w-7 items-center justify-center rounded-lg border transition"
                        style={{ borderColor: "var(--border)", color: "var(--text-3)" }}
                        onMouseEnter={(e) => { e.currentTarget.style.color = "var(--rose)"; e.currentTarget.style.borderColor = "var(--rose)" }}
                        onMouseLeave={(e) => { e.currentTarget.style.color = "var(--text-3)"; e.currentTarget.style.borderColor = "var(--border)" }}
                        title="Remove">
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </div>

                  {/* Match banner */}
                  {matched ? (
                    <div className="flex items-center gap-2 px-4 py-1.5 text-[11px] font-semibold" style={{ background: "var(--brand-soft)", color: "var(--brand-text)" }}>
                      <CheckCircle2 size={12} />
                      Restocking: <strong className="ms-0.5">{matched.name}</strong>
                      <span className="ms-auto opacity-60">Stock {matched.stock} → {matched.stock + row.quantity}</span>
                    </div>
                  ) : row.barcode ? (
                    <div className="flex items-center gap-2 px-4 py-1.5 text-[11px] font-semibold" style={{ background: "var(--amber-soft)", color: "var(--amber)" }}>
                      <PackagePlus size={12} /> New product
                    </div>
                  ) : null}

                  {/* Add as alias — when barcode doesn't match any existing product */}
                  {!matched && row.barcode && row.barcode.length >= 3 && !row.name && (
                    <div className="flex items-center gap-2 px-4 py-1.5 text-[11px]" style={{ background: "var(--surface-2)", borderTop: "1px solid var(--border)" }}>
                      <span className="text-[10px] font-bold shrink-0" style={{ color: "var(--amber)" }}>↳</span>
                      <select
                        className="input flex-1 text-[11px] font-semibold"
                        style={{ height: 28, minWidth: 0 }}
                        value=""
                        onChange={(e) => {
                          if (!e.target.value) return
                          const targetId = Number(e.target.value)
                          const target = products.find((p) => p.id === targetId)
                          if (!target) return
                          const aliases = [...(target.barcodeAliases ?? []), row.barcode]
                          updateProduct(targetId, { barcodeAliases: aliases })
                          updateRow(row.id, { name: target.name, category: target.category, price: target.price, cost: target.cost, barcode: target.barcode })
                          showToast(`Added ${row.barcode} as alias of ${target.name}`)
                        }}
                      >
                        <option value="">+ Add as alias of...</option>
                        {products.map((p) => (
                          <option key={p.id} value={p.id}>{p.name} ({p.barcode})</option>
                        ))}
                      </select>
                    </div>
                  )}

                  {/* Open Food Facts suggestion */}
                  {!matched && barcodeSuggestions[row.barcode] && !row.name && (
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); applySuggestion(row.id, row.barcode) }}
                      className="flex items-center gap-2 px-4 py-1.5 text-[11px] font-semibold transition hover:opacity-80 w-full text-start"
                      style={{ background: "rgba(59,130,246,0.08)", color: "var(--blue)" }}
                    >
                      <Search size={12} className="shrink-0" />
                      <span className="truncate">
                        <strong className="text-white">{barcodeSuggestions[row.barcode]!.name}</strong>
                      </span>
                      <span className="ms-auto shrink-0 text-[10px] opacity-60">Tap to use</span>
                    </button>
                  )}

                  {!matched && barcodeSuggestions[row.barcode] === null && row.barcode.length >= 8 && (
                    <div className="flex items-center gap-2 px-4 py-1 text-[10px] opacity-40" style={{ color: "var(--text-3)" }}>
                      <LoaderCircle size={10} className="animate-spin shrink-0" />
                      Looking up barcode...
                    </div>
                  )}

                  {/* Camera preview — only on active row */}
                  {active && cameraEngine && (
                    <div className="px-4 py-2">
                      <div className="relative overflow-hidden rounded-xl" style={{ border: "1.5px solid var(--brand)", boxShadow: "0 0 0 3px var(--brand-soft)" }}>
                        <video ref={videoRef} muted playsInline className={`aspect-video w-full bg-zinc-950 object-cover ${cameraEngine === "native" ? "block" : "hidden"}`} />
                        <div id={RECEIVE_CAMERA_READER_ID} className={`overflow-hidden bg-zinc-950 ${cameraEngine === "html5" ? "block" : "hidden"}`} />
                        {cameraStatus && (
                          <div className="absolute bottom-2 left-2 right-2 rounded-lg bg-black/60 px-2 py-1 text-center text-[11px] font-semibold text-white">
                            {cameraStatus}
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Fields grid */}
                  <div className="grid grid-cols-2 gap-3 px-4 py-3 sm:grid-cols-3 lg:grid-cols-6">
                    {[
                      { label: "Name",     value: row.name,     key: "name",     disabled: !!matched, type: "text",   colSpan: "lg:col-span-2" },
                      { label: "Category", value: row.category, key: "category", disabled: !!matched, type: "text",   colSpan: "" },
                    ].map((f) => (
                      <label key={f.key} className={`block ${f.colSpan}`}>
                        <span className="block text-[10px] font-bold uppercase tracking-wide mb-1" style={{ color: "var(--text-3)" }}>{f.label}</span>
                        <input
                          value={f.value}
                          disabled={f.disabled}
                          onChange={(e) => updateRow(row.id, { [f.key]: e.target.value } as any)}
                          list={f.key === "category" ? "product-categories" : undefined}
                          className="input w-full"
                          style={{ height: 34, fontSize: 13, fontWeight: 600, opacity: f.disabled ? 0.55 : 1 }}
                        />
                      </label>
                    ))}

                    {(() => {
                      const settings = getSettings()
                      const applyProfit = (pct: number) => {
                        const price = Math.round(row.cost * (1 + pct / 100) * 100) / 100
                        updateRow(row.id, { price })
                      }
                      return (
                        <>
                          {/* Cost + profit buttons */}
                          <label className="block">
                            <span className="block text-[10px] font-bold uppercase tracking-wide mb-1" style={{ color: "var(--text-3)" }}>Cost $</span>
                            <div className="flex items-center gap-0.5">
                              <input
                                type="number" min="0" step="0.01" value={row.cost || ""}
                                onChange={(e) => updateRow(row.id, { cost: normalizeNumber(e.target.value) } as any)}
                                className="input text-end"
                                style={{ height: 34, fontSize: 13, fontWeight: 600, width: 60, minWidth: 60, flex: "0 0 auto" }}
                              />
                              {row.cost > 0 && (
                                <>
                                  <button
                                    type="button"
                                    onClick={() => applyProfit(settings.profitPercent1)}
                                    className="shrink-0 rounded px-1 py-0 text-[9px] font-bold transition active:opacity-70"
                                    style={{ background: "var(--brand-soft)", color: "var(--brand-text)", height: 34 }}
                                  >
                                    +{settings.profitPercent1}%
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => applyProfit(settings.profitPercent2)}
                                    className="shrink-0 rounded px-1 py-0 text-[9px] font-bold transition active:opacity-70"
                                    style={{ background: "var(--brand-soft)", color: "var(--brand-text)", height: 34 }}
                                  >
                                    +{settings.profitPercent2}%
                                  </button>
                                </>
                              )}
                            </div>
                          </label>
                          <label className="block">
                            <span className="block text-[10px] font-bold uppercase tracking-wide mb-1" style={{ color: "var(--text-3)" }}>Price $</span>
                            <input
                              type="number" min="0" step="0.01" value={row.price || ""}
                              onChange={(e) => updateRow(row.id, { price: normalizeNumber(e.target.value) } as any)}
                              className="input w-full text-end"
                              style={{ height: 34, fontSize: 13, fontWeight: 600 }}
                            />
                          </label>
                          <label className="block">
                            <span className="block text-[10px] font-bold uppercase tracking-wide mb-1" style={{ color: "var(--text-3)" }}>Qty</span>
                            <input
                              type="number" min="0" step="1" value={row.quantity || ""}
                              onChange={(e) => updateRow(row.id, { quantity: normalizeNumber(e.target.value) } as any)}
                              className="input w-full text-end"
                              style={{ height: 34, fontSize: 13, fontWeight: 600 }}
                            />
                          </label>
                        </>
                      )
                    })()}
                  </div>

                  {/* Expiry + barcode preview — compact footer */}
                  <div className="flex items-center gap-3 border-t px-4 py-2" style={{ borderColor: "var(--border)" }}>
                    <label className="flex items-center gap-2 min-w-0">
                      <span className="shrink-0 text-[10px] font-bold uppercase tracking-wide" style={{ color: "var(--text-3)" }}>Expiry</span>
                      <input
                        type="date" value={row.expiryDate}
                        onChange={(e) => updateRow(row.id, { expiryDate: e.target.value })}
                        className="input"
                        style={{ height: 28, fontSize: 11, width: 130 }}
                      />
                    </label>
                    <label className="flex items-center gap-2 ms-auto">
                      <span className="text-[10px] font-bold uppercase tracking-wide" style={{ color: "var(--text-3)" }}>Labels</span>
                      <input
                        type="number" min="0" step="1" value={row.labels || ""}
                        onChange={(e) => updateRow(row.id, { labels: normalizeNumber(e.target.value) })}
                        className="input text-center"
                        style={{ height: 28, fontSize: 11, width: 52 }}
                      />
                    </label>
                    {row.barcode && (
                      <div className="shrink-0 overflow-hidden rounded-lg" style={{ background: "#fff" }}
                        dangerouslySetInnerHTML={{ __html: renderCode128Svg(row.barcode, 28, 1) }} />
                    )}
                  </div>
                </div>
              )
            })}

            {/* Add row */}
            <button
              type="button" onClick={() => addRow()}
              className="flex w-full items-center justify-center gap-2 rounded-2xl border-2 border-dashed py-3 text-[13px] font-semibold transition hover:opacity-70"
              style={{ borderColor: "var(--border)", color: "var(--text-3)" }}
            >
              <Plus size={15} /> Add another product
            </button>

            <datalist id="product-categories">
              {categories.map((c) => <option key={c} value={c} />)}
            </datalist>
          </section>

          {/* ── Right: Supplier + Labels ─────────────────── */}
          <aside className="space-y-4">

            {/* Supplier */}
            <div className="rounded-2xl border p-4 space-y-3" style={{ background: "var(--surface)", borderColor: "var(--border)" }}>
              <div className="flex items-center gap-2">
                <Building2 size={14} style={{ color: "var(--brand)" }} />
                <h3 className="text-[13px] font-bold" style={{ color: "var(--text)" }}>Supplier & Purchase</h3>
              </div>

              {suppliers.length > 0 ? (
                <select value={selectedSupplierId} onChange={(e) => setSelectedSupplierId(e.target.value)} className="input w-full">
                  <option value="">No supplier</option>
                  {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name} — {formatCurrency(s.balance)}</option>)}
                </select>
              ) : (
                <Link to="/suppliers" className="btn btn-primary w-full justify-center text-[13px]">Add a supplier first</Link>
              )}

              <input
                value={supplierInvoiceNumber} onChange={(e) => setSupplierInvoiceNumber(e.target.value)}
                placeholder="Invoice number"
                className="input w-full" style={{ fontSize: 13 }}
              />

              {/* Payment method */}
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wide mb-2" style={{ color: "var(--text-3)" }}>Payment</p>
                <div className="grid grid-cols-2 gap-1.5">
                  {purchasePaymentMethods.map((method) => {
                    const Icon = pmIcons[method] ?? ClipboardCheck
                    const active = purchasePaymentMethod === method
                    return (
                      <button key={method} type="button" onClick={() => setPurchasePaymentMethod(method)}
                        className="flex items-center justify-center gap-1.5 h-8 rounded-xl border text-[11px] font-bold transition"
                        style={active
                          ? { background: "var(--surface-3)", borderColor: "var(--border-strong)", color: "var(--text)" }
                          : { borderColor: "var(--border)", color: "var(--text-3)", background: "var(--surface-2)" }
                        }>
                        <Icon size={12} />
                        {method === "On Account" ? "Account" : method === "Bank Transfer" ? "Bank" : method}
                      </button>
                    )
                  })}
                </div>
              </div>

              <textarea
                value={supplierNote} onChange={(e) => setSupplierNote(e.target.value)}
                placeholder="Note (optional)" rows={2}
                className="input w-full resize-none py-2 text-[13px]"
                style={{ height: "auto" }}
              />

              {/* Summary */}
              <div className="rounded-xl px-3 py-2.5 space-y-1" style={{ background: "var(--surface-2)" }}>
                <div className="flex justify-between text-[12px]">
                  <span style={{ color: "var(--text-3)" }}>Products</span>
                  <span className="font-bold" style={{ color: "var(--text)" }}>{readyRows.length}</span>
                </div>
                <div className="flex justify-between text-[12px]">
                  <span style={{ color: "var(--text-3)" }}>Total units</span>
                  <span className="font-bold" style={{ color: "var(--text)" }}>{formatNumber(totalUnits)}</span>
                </div>
                <div className="flex justify-between text-[13px] border-t pt-1.5 mt-1" style={{ borderColor: "var(--border)" }}>
                  <span className="font-semibold" style={{ color: "var(--text-3)" }}>Total cost</span>
                  <span className="text-[16px] font-bold" style={{ color: "var(--text)" }}>{formatCurrency(totalCost)}</span>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <button type="button" onClick={saveBatch} disabled={readyRows.length === 0}
                  className="btn btn-primary h-10 gap-2 justify-center text-[13px] disabled:opacity-40">
                  <CheckCircle2 size={14} /> Save
                </button>
                <button type="button" onClick={resetBatch}
                  className="btn btn-default h-10 gap-2 justify-center text-[13px]">
                  <RotateCcw size={14} /> Clear
                </button>
              </div>

              {lastReceivedTotal > 0 && (
                <Link to="/products" className="btn btn-ghost w-full justify-center text-[13px] border" style={{ borderColor: "var(--border)" }}>
                  View inventory →
                </Link>
              )}
            </div>

            {/* Labels */}
            <div className="rounded-2xl border p-4 space-y-3" style={{ background: "var(--surface)", borderColor: "var(--border)" }}>
              <div className="flex items-center gap-2">
                <Printer size={14} style={{ color: "var(--brand)" }} />
                <h3 className="text-[13px] font-bold" style={{ color: "var(--text)" }}>Print Labels</h3>
                <span className="ms-auto rounded-full px-2 py-0.5 text-[10px] font-bold" style={{ background: "var(--brand-soft)", color: "var(--brand-text)" }}>
                  {labelsToPrint} labels
                </span>
              </div>

              <div className="grid grid-cols-3 gap-1.5">
                {(Object.keys(labelSizes) as LabelSize[]).map((size) => (
                  <button key={size} type="button" onClick={() => setLabelSize(size)}
                    className="rounded-xl border py-2 text-[11px] font-bold transition"
                    style={labelSize === size
                      ? { background: "var(--surface-3)", borderColor: "var(--border-strong)", color: "var(--text)" }
                      : { borderColor: "var(--border)", color: "var(--text-3)", background: "var(--surface-2)" }
                    }>
                    {labelSizes[size].label}
                  </button>
                ))}
              </div>

              {/* Preview */}
              {(() => { const r = rows.find((r) => r.id === activeRowId); return r?.barcode ? (
                <div className="flex flex-col items-center gap-1 rounded-xl p-3" style={{ background: "#fff" }}>
                  <p className="text-[10px] font-bold text-zinc-800 truncate max-w-full">{r.name || "—"}</p>
                  <div dangerouslySetInnerHTML={{ __html: renderCode128Svg(r.barcode, 60, 1.4) }} />
                  <p className="text-[9px] text-zinc-500 font-mono">{r.barcode}</p>
                </div>
              ) : null })()}

              <button type="button" onClick={printLabels} disabled={labelsToPrint === 0}
                className="btn btn-default w-full justify-center gap-2 h-10 text-[13px] disabled:opacity-40">
                <Printer size={14} /> Print {labelsToPrint > 0 ? `${labelsToPrint} labels` : ""}
              </button>
            </div>

          </aside>
        </div>
      </div>

      <input ref={scanCaptureInputRef} type="file" accept="image/*" capture="environment" onChange={handleScanCapture} className="hidden" />
    </main>
  )
}

import { useEffect, useMemo, useRef, useState } from "react"
import type { ChangeEvent } from "react"
import {
  Banknote,
  Barcode,
  Building2,
  CheckCircle2,
  ClipboardCheck,
  Copy,
  CreditCard,
  Keyboard,
  Landmark,
  PackagePlus,
  Plus,
  Printer,
  RotateCcw,
  ScanBarcode,
  Trash2,
  WalletCards,
} from "lucide-react"
import { Link } from "react-router"
import Spinner from "../../components/ui/Spinner"

import { renderCode128Svg } from "../../features/pos/lib/barcode"
import {
  createBarcodeDetector,
  createHtml5Qrcode,
  detectBarcodeFromImageFile,
  getCameraErrorMessage,
  getHtml5QrcodeFormatCodes,
  getLiveCameraIssue,
  getPreferredCameraConstraints,
  type BrowserBarcodeDetector,
  type Html5QrcodeInstance,
} from "../../features/pos/lib/cameraScanner"
import { formatCurrency, formatNumber } from "../../features/pos/lib/currency"
import {
  findProductByBarcode,
  generateProductBarcode,
  getProducts,
  receiveProducts,
} from "../../features/pos/services/product.service"
import { recordAuditEvent } from "../../features/pos/services/security.service"
import {
  getSupplierLedger,
  recordPurchaseOrder,
  subscribeSuppliers,
  type PurchasePaymentMethod,
  type SupplierLedger,
} from "../../features/pos/services/supplier.service"
import type { Product, ProductAccent } from "../../features/pos/types/product"
import { showToast } from "../../features/pos/services/toast.service"
import { useI18n } from "@lebanonpos/shared"

type BatchRow = {
  id: string
  name: string
  category: string
  quantity: number
  cost: number
  price: number
  reorderPoint: number
  reorderQuantity: number
  expiryDate: string
  barcode: string
  labels: number
  accent: ProductAccent
}

type LabelSize = "40x25" | "50x30" | "58x35"
type SideTab = "supplier" | "scanner" | "labels"

const purchasePaymentMethods: PurchasePaymentMethod[] = [
  "On Account", "Cash", "Card", "Bank Transfer", "Wallet",
]

const labelSizes: Record<LabelSize, { label: string; width: string; height: string }> = {
  "40x25": { label: "40 × 25 mm", width: "40mm", height: "25mm" },
  "50x30": { label: "50 × 30 mm", width: "50mm", height: "30mm" },
  "58x35": { label: "58 × 35 mm", width: "58mm", height: "35mm" },
}

const pmIcons: Record<string, typeof Banknote> = {
  Cash: Banknote, Card: CreditCard, Wallet: WalletCards,
  "Bank Transfer": Landmark, "On Account": ClipboardCheck,
}

const accents: ProductAccent[] = ["emerald", "cyan", "amber", "rose", "violet", "indigo"]

const RECEIVE_CAMERA_READER_ID = "lebanonpos-receive-camera-reader"

function createRow(defaults?: Partial<BatchRow>): BatchRow {
  return {
    id: crypto.randomUUID(),
    name: "",
    category: "Pantry",
    quantity: 1,
    cost: 0,
    price: 0,
    reorderPoint: 10,
    reorderQuantity: 20,
    expiryDate: "",
    barcode: "",
    labels: 1,
    accent: accents[Math.floor(Math.random() * accents.length)],
    ...defaults,
  }
}

function escapeHtml(value: string) {
  return value.replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#039;")
}

function normalizeNumber(value: string) {
  const v = Number(value)
  return Number.isFinite(v) ? v : 0
}

function isRowReady(row: BatchRow) {
  return row.name.trim().length > 0 && row.barcode.trim().length > 0 && row.quantity > 0
}

export default function ProductReceivePage() {
  const { t } = useI18n()
  const [products, setProducts] = useState<Product[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [suppliers, setSuppliers] = useState<SupplierLedger[]>(getSupplierLedger())
  const [rows, setRows] = useState<BatchRow[]>([createRow()])
  const [activeRowId, setActiveRowId] = useState(rows[0].id)
  const [scannerValue, setScannerValue] = useState("")
  const [cameraStatus, setCameraStatus] = useState(t("pos.receive.camera_idle"))
  const [cameraEngine, setCameraEngine] = useState<"native" | "html5" | null>(null)
  const [labelSize, setLabelSize] = useState<LabelSize>("50x30")
  const [lastReceivedTotal, setLastReceivedTotal] = useState(0)
  const [selectedSupplierId, setSelectedSupplierId] = useState("")
  const [purchasePaymentMethod, setPurchasePaymentMethod] = useState<PurchasePaymentMethod>("On Account")
  const [supplierInvoiceNumber, setSupplierInvoiceNumber] = useState("")
  const [supplierNote, setSupplierNote] = useState("")
  const [sideTab, setSideTab] = useState<SideTab>("supplier")

  const videoRef = useRef<HTMLVideoElement | null>(null)
  const scanCaptureInputRef = useRef<HTMLInputElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const frameRef = useRef<number | null>(null)
  const detectorRef = useRef<BrowserBarcodeDetector | null>(null)
  const html5ScannerRef = useRef<Html5QrcodeInstance | null>(null)
  const scanInputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    let active = true
    getProducts().then((data) => { if (active) { setProducts(data); setIsLoading(false) } })
    const unsub = subscribeSuppliers(() => setSuppliers(getSupplierLedger()))
    return () => { active = false; unsub(); stopCamera() }
  }, [])

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

  function applyBarcodeToActiveRow(barcode: string) {
    const clean = barcode.trim().replace(/\s+/g, "")
    if (!clean) return
    const product = findProductByBarcode(clean)
    setRows((rows) => rows.map((r) => {
      if (r.id !== activeRowId) return r
      if (!product) return { ...r, barcode: clean }
      return { ...r, name: product.name, category: product.category, price: product.price, cost: product.cost, reorderPoint: product.reorderPoint ?? 10, reorderQuantity: product.reorderQuantity ?? 20, expiryDate: product.expiryDate ?? "", barcode: product.barcode, accent: product.accent }
    }))
    setScannerValue("")
    showToast(product ? `Loaded: ${product.name}` : `New barcode: ${clean}`)
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
    receiveProducts(readyRows.map((r) => ({ name: r.name, category: r.category, cost: r.cost, price: r.price, stock: r.quantity, barcode: r.barcode, accent: r.accent, reorderPoint: r.reorderPoint, reorderQuantity: r.reorderQuantity, expiryDate: r.expiryDate, supplierId: selectedSupplier?.id, supplierName: selectedSupplier?.name })))
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
    showToast(`${formatNumber(totalUnits)} units received${poNumber ? ` · ${poNumber}` : ""}.`)
  }

  function resetBatch() {
    const row = createRow()
    setRows([row]); setActiveRowId(row.id); setScannerValue(""); setLastReceivedTotal(0)
    setSupplierInvoiceNumber(""); setSupplierNote(""); showToast(t("pos.receive.batch_cleared"))
  }

  async function startCamera() {
    if (cameraEngine) { stopCamera(); setCameraStatus(t("pos.receive.camera_stopped")); return }
    const issue = getLiveCameraIssue()
    if (issue) { setCameraStatus(issue); scanCaptureInputRef.current?.click(); return }
    try {
      const detector = await createBarcodeDetector()
      if (!detector) {
        setCameraEngine("html5"); setCameraStatus("Starting camera scanner…")
        await new Promise<void>((r) => window.requestAnimationFrame(() => r()))
        const scanner = await createHtml5Qrcode(RECEIVE_CAMERA_READER_ID)
        if (!scanner) { stopCamera(); setCameraStatus(t("pos.receive.camera_engine_failed")); return }
        html5ScannerRef.current = scanner
        await scanner.start({ facingMode: "environment" }, { fps: 12, qrbox: { width: 260, height: 160 }, formatsToSupport: getHtml5QrcodeFormatCodes() }, (text) => { applyBarcodeToActiveRow(text); setCameraStatus(t("pos.receive.scanned", { barcode: text })); stopCamera() })
        setCameraStatus(t("pos.receive.camera_ready")); return
      }
      const stream = await navigator.mediaDevices.getUserMedia(getPreferredCameraConstraints())
      streamRef.current = stream
      if (videoRef.current) { videoRef.current.srcObject = stream; videoRef.current.muted = true; videoRef.current.setAttribute("playsinline", "true"); await videoRef.current.play() }
      detectorRef.current = detector; setCameraEngine("native"); setCameraStatus(t("pos.receive.camera_ready")); void scanCameraFrame()
    } catch (err) { stopCamera(); setCameraStatus(t("pos.receive.camera_error_with_hint", { error: getCameraErrorMessage(err) })) }
  }

  async function handleScanCapture(e: ChangeEvent<HTMLInputElement>) {
    const file = e.currentTarget.files?.[0]; e.currentTarget.value = ""
    if (!file) return
    try { setCameraStatus(t("pos.receive.reading_barcode")); const bc = await detectBarcodeFromImageFile(file); if (!bc) { setCameraStatus(t("pos.receive.no_barcode_found")); return } applyBarcodeToActiveRow(bc); setCameraStatus(t("pos.receive.scanned", { barcode: bc })) }
    catch { setCameraStatus(t("pos.receive.scan_failed")) }
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
    try { const r = await d.detect(v); const bc = r[0]?.rawValue; if (bc) { applyBarcodeToActiveRow(bc); setCameraStatus(t("pos.receive.scanned", { barcode: bc })); stopCamera(); return } }
    catch { setCameraStatus("Scanning…") }
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
    <main className="min-h-0 flex-1 overflow-y-auto bg-page p-3 sm:p-5">
      {/* ── KPI row ── */}
      <div className="mb-5 grid grid-cols-3 gap-3 sm:grid-cols-4">
        {[
          { label: t("pos.receive.ready_rows"),  value: formatNumber(readyRows.length), color: readyRows.length > 0 ? "var(--brand-text)" : "var(--text-3)" },
          { label: t("pos.receive.units"),        value: formatNumber(totalUnits) },
          { label: t("pos.receive.cost_value"),   value: formatCurrency(totalCost) },
          { label: "Labels",                      value: formatNumber(labelsToPrint), hidden: true },
        ].map((kpi) => (
          <div
            key={kpi.label}
            className={`rounded-xl border p-4 ${kpi.hidden ? "hidden sm:block" : ""}`}
            style={{ background: "var(--surface)", borderColor: "var(--border)" }}
          >
            <p className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: "var(--text-3)" }}>{kpi.label}</p>
            <p className="mt-1.5 text-2xl font-bold" style={{ color: kpi.color ?? "var(--text)" }}>{kpi.value}</p>
          </div>
        ))}
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        {/* ── Product rows ── */}
        <section className="space-y-3">
          {/* Section header */}
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-[16px] font-bold" style={{ color: "var(--text)" }}>{t("pos.receive.title")}</h2>
              <p className="text-[12px] mt-0.5" style={{ color: "var(--text-3)" }}>{t("pos.receive.desc")}</p>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => addRow()}
                className="btn btn-default h-9 gap-1.5 text-[13px]"
              >
                <Plus size={15} />
                {t("pos.receive.add_row")}
              </button>
              <button
                type="button"
                onClick={saveBatch}
                className="btn btn-primary h-9 gap-1.5 text-[13px]"
              >
                <CheckCircle2 size={15} />
                {t("pos.receive.save_batch")}
              </button>
            </div>
          </div>

          {/* USB scan bar */}
          <div
            className="flex items-center gap-3 rounded-xl border px-4 py-3"
            style={{ background: "var(--surface)", borderColor: "var(--border)" }}
          >
            <Keyboard size={16} style={{ color: "var(--text-3)" }} className="shrink-0" />
            <input
              ref={scanInputRef}
              value={scannerValue}
              onChange={(e) => setScannerValue(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); applyBarcodeToActiveRow(scannerValue) } }}
              placeholder={t("pos.receive.scan_into_row")}
              className="flex-1 bg-transparent text-[14px] font-medium outline-none"
              style={{ color: "var(--text)" }}
            />
            <span className="text-[11px] font-semibold shrink-0" style={{ color: "var(--text-3)" }}>
              → Row #{rows.findIndex((r) => r.id === activeRowId) + 1}
            </span>
          </div>

          {/* Product cards */}
          <div className="space-y-3">
            {rows.map((row, idx) => {
              const active = activeRowId === row.id
              const ready = isRowReady(row)
              return (
                <div
                  key={row.id}
                  className="rounded-xl border transition-all"
                  style={{
                    background: "var(--surface)",
                    borderColor: active ? "var(--brand)" : "var(--border)",
                    boxShadow: active ? "0 0 0 3px var(--brand-soft)" : "var(--shadow-xs)",
                  }}
                  onFocus={() => setActiveRowId(row.id)}
                  onClick={() => setActiveRowId(row.id)}
                >
                  {/* Card header row */}
                  <div className="flex items-center gap-3 border-b px-4 py-2.5" style={{ borderColor: "var(--border)" }}>
                    <span
                      className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold"
                      style={ready
                        ? { background: "var(--brand-soft)", color: "var(--brand-text)" }
                        : { background: "var(--surface-3)", color: "var(--text-3)" }
                      }
                    >
                      {ready ? "✓" : idx + 1}
                    </span>

                    <input
                      value={row.name}
                      onChange={(e) => updateRow(row.id, { name: e.target.value })}
                      placeholder={t("pos.receive.product_name")}
                      className="min-w-0 flex-1 bg-transparent text-[14px] font-semibold outline-none"
                      style={{ color: "var(--text)" }}
                    />

                    <input
                      value={row.category}
                      list="product-categories"
                      onChange={(e) => updateRow(row.id, { category: e.target.value })}
                      placeholder="Category"
                      className="w-28 rounded-lg border px-2 text-[12px] font-medium h-8 outline-none"
                      style={{ background: "var(--surface-2)", borderColor: "var(--border)", color: "var(--text-2)" }}
                    />

                    {/* Actions */}
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        onClick={() => setActiveRowId(row.id)}
                        title="Target this row for scanner"
                        className="flex h-7 w-7 items-center justify-center rounded-lg border transition"
                        style={active
                          ? { borderColor: "var(--brand)", background: "var(--brand-soft)", color: "var(--brand-text)" }
                          : { borderColor: "var(--border)", color: "var(--text-3)" }
                        }
                      >
                        <ScanBarcode size={13} />
                      </button>
                      <button
                        type="button"
                        onClick={() => duplicateRow(row)}
                        title="Duplicate"
                        className="flex h-7 w-7 items-center justify-center rounded-lg border transition hover:opacity-80"
                        style={{ borderColor: "var(--border)", color: "var(--text-3)" }}
                      >
                        <Copy size={13} />
                      </button>
                      <button
                        type="button"
                        onClick={() => removeRow(row.id)}
                        title="Remove"
                        className="flex h-7 w-7 items-center justify-center rounded-lg border transition"
                        style={{ borderColor: "var(--border)", color: "var(--text-3)" }}
                        onMouseEnter={(e) => { e.currentTarget.style.color = "var(--rose)"; e.currentTarget.style.borderColor = "var(--rose)" }}
                        onMouseLeave={(e) => { e.currentTarget.style.color = "var(--text-3)"; e.currentTarget.style.borderColor = "var(--border)" }}
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>

                  {/* Card body — key fields in a clean grid */}
                  <div className="grid grid-cols-2 gap-x-4 gap-y-2 px-4 py-3 sm:grid-cols-3 lg:grid-cols-6">
                    {[
                      { label: t("pos.table.cost"), value: row.cost, key: "cost", step: "0.01", min: "0", suffix: "$" },
                      { label: t("pos.table.price"), value: row.price, key: "price", step: "0.01", min: "0", suffix: "$" },
                      { label: t("pos.table.qty"), value: row.quantity, key: "quantity", step: "1", min: "1" },
                      { label: t("pos.receive.low_alert"), value: row.reorderPoint, key: "reorderPoint", step: "1", min: "0", amber: true },
                      { label: t("pos.receive.labels"), value: row.labels, key: "labels", step: "1", min: "0" },
                    ].map((field) => (
                      <label key={field.key} className="block">
                        <span className="block text-[10px] font-bold uppercase tracking-wide mb-1" style={{ color: "var(--text-3)" }}>
                          {field.suffix}{field.label}
                        </span>
                        <input
                          type="number"
                          min={field.min}
                          step={field.step}
                          value={field.value}
                          onChange={(e) => updateRow(row.id, { [field.key]: normalizeNumber(e.target.value) } as any)}
                          className="input text-right"
                          style={{
                            height: 34, fontSize: 13, fontWeight: 600,
                            ...(field.amber ? { borderColor: "rgba(245,158,11,0.4)", background: "var(--amber-soft)" } : {}),
                          }}
                        />
                      </label>
                    ))}

                    {/* Expiry */}
                    <label className="block">
                      <span className="block text-[10px] font-bold uppercase tracking-wide mb-1" style={{ color: "var(--text-3)" }}>
                        {t("pos.receive.expiry")}
                      </span>
                      <input
                        type="date"
                        value={row.expiryDate}
                        onChange={(e) => updateRow(row.id, { expiryDate: e.target.value })}
                        className="input"
                        style={{ height: 34, fontSize: 12 }}
                      />
                    </label>
                  </div>

                  {/* Barcode row */}
                  <div className="flex items-center gap-2 border-t px-4 py-2.5" style={{ borderColor: "var(--border)" }}>
                    <Barcode size={14} style={{ color: "var(--text-3)" }} className="shrink-0" />
                    <input
                      value={row.barcode}
                      onChange={(e) => updateRow(row.id, { barcode: e.target.value })}
                      placeholder={t("pos.receive.scan_or_generate")}
                      className="min-w-0 flex-1 bg-transparent text-[13px] font-mono outline-none"
                      style={{ color: "var(--text-2)" }}
                    />
                    <button
                      type="button"
                      onClick={() => generateBarcodeForRow(row.id)}
                      className="shrink-0 flex items-center gap-1.5 h-7 rounded-lg border px-2.5 text-[11px] font-semibold transition hover:opacity-80"
                      style={{ borderColor: "var(--border)", color: "var(--text-2)", background: "var(--surface-2)" }}
                    >
                      <Barcode size={12} />
                      Generate
                    </button>
                    {row.barcode && (
                      <div
                        className="shrink-0 rounded-lg overflow-hidden p-1"
                        style={{ background: "#fff" }}
                        dangerouslySetInnerHTML={{ __html: renderCode128Svg(row.barcode, 32, 1.2) }}
                      />
                    )}
                  </div>
                </div>
              )
            })}
          </div>

          {/* Add row button at bottom */}
          <button
            type="button"
            onClick={() => addRow()}
            className="flex w-full items-center justify-center gap-2 rounded-xl border-2 border-dashed py-3 text-[13px] font-semibold transition hover:opacity-80"
            style={{ borderColor: "var(--border)", color: "var(--text-3)" }}
          >
            <Plus size={16} />
            {t("pos.receive.add_row")}
          </button>

          <datalist id="product-categories">
            {categories.map((c) => <option key={c} value={c} />)}
          </datalist>
        </section>

        {/* ── Right panel ── */}
        <aside className="space-y-4">
          {/* Tab switcher */}
          <div
            className="flex gap-1 rounded-xl p-1"
            style={{ background: "var(--surface-2)", border: "1px solid var(--border)" }}
          >
            {([
              { key: "supplier" as const, icon: <Building2 size={14} />, label: t("pos.table.supplier") },
              { key: "scanner" as const, icon: <ScanBarcode size={14} />, label: t("pos.receive.barcode_scanner") },
              { key: "labels" as const, icon: <Printer size={14} />, label: t("pos.receive.barcode_labels") },
            ]).map((tab) => (
              <button
                key={tab.key}
                type="button"
                onClick={() => setSideTab(tab.key)}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-lg py-2 text-[11px] font-semibold transition"
                style={sideTab === tab.key
                  ? { background: "var(--text)", color: "var(--surface)", boxShadow: "var(--shadow-sm)" }
                  : { color: "var(--text-3)" }
                }
              >
                {tab.icon}
                <span className="hidden sm:inline">{tab.label}</span>
              </button>
            ))}
          </div>

          {/* Supplier tab */}
          {sideTab === "supplier" && (
            <div
              className="rounded-xl border p-4 space-y-3"
              style={{ background: "var(--surface)", borderColor: "var(--border)" }}
            >
              <h3 className="text-[13px] font-bold" style={{ color: "var(--text)" }}>
                {t("pos.receive.supplier_purchase")}
              </h3>

              {suppliers.length > 0 ? (
                <select
                  value={selectedSupplierId}
                  onChange={(e) => setSelectedSupplierId(e.target.value)}
                  className="input"
                >
                  <option value="">{t("pos.receive.no_supplier")}</option>
                  {suppliers.map((s) => (
                    <option key={s.id} value={s.id}>{s.name} — {formatCurrency(s.balance)}</option>
                  ))}
                </select>
              ) : (
                <Link to="/suppliers" className="btn btn-primary w-full justify-center">
                  {t("pos.receive.add_supplier")}
                </Link>
              )}

              <input
                value={supplierInvoiceNumber}
                onChange={(e) => setSupplierInvoiceNumber(e.target.value)}
                placeholder={t("pos.receive.invoice_number")}
                className="input"
              />

              {/* Payment method pills */}
              <div>
                <p className="text-[11px] font-bold uppercase tracking-wide mb-2" style={{ color: "var(--text-3)" }}>Payment</p>
                <div className="grid grid-cols-2 gap-1.5">
                  {purchasePaymentMethods.map((method) => {
                    const Icon = pmIcons[method] ?? ClipboardCheck
                    const active = purchasePaymentMethod === method
                    return (
                      <button
                        key={method}
                        type="button"
                        onClick={() => setPurchasePaymentMethod(method)}
                        className="flex items-center justify-center gap-1.5 h-9 rounded-lg border text-[12px] font-semibold transition"
                        style={active
                          ? { background: "var(--accent)", borderColor: "var(--accent)", color: "#fff" }
                          : { borderColor: "var(--border)", color: "var(--text-2)", background: "var(--surface-2)" }
                        }
                      >
                        <Icon size={13} />
                        {method === "On Account" ? t("pos.receive.payment.on_account") : method === "Bank Transfer" ? t("pos.receive.payment.bank_transfer") : method}
                      </button>
                    )
                  })}
                </div>
              </div>

              <textarea
                value={supplierNote}
                onChange={(e) => setSupplierNote(e.target.value)}
                placeholder={t("pos.receive.purchase_note")}
                rows={2}
                className="input w-full resize-none py-2"
                style={{ height: "auto" }}
              />

              {/* Summary */}
              <div
                className="rounded-lg px-3 py-2.5 space-y-1.5 text-[13px]"
                style={{ background: "var(--surface-2)" }}
              >
                <div className="flex justify-between" style={{ color: "var(--text-2)" }}>
                  <span>Total cost</span>
                  <span className="font-bold" style={{ color: "var(--text)" }}>{formatCurrency(totalCost)}</span>
                </div>
                {selectedSupplier && (
                  <div className="flex justify-between" style={{ color: "var(--text-2)" }}>
                    <span>{t("pos.table.supplier")}</span>
                    <span className="font-semibold" style={{ color: "var(--text)" }}>{selectedSupplier.name}</span>
                  </div>
                )}
              </div>

              {/* Save + Reset */}
              <div className="grid grid-cols-2 gap-2">
                <button type="button" onClick={saveBatch} className="btn btn-primary h-10 gap-2 justify-center">
                  <ClipboardCheck size={15} />
                  {t("pos.save")}
                </button>
                <button type="button" onClick={resetBatch} className="btn btn-default h-10 gap-2 justify-center">
                  <RotateCcw size={15} />
                  {t("pos.clear")}
                </button>
              </div>

              {lastReceivedTotal > 0 && (
                <Link to="/products" className="btn btn-ghost w-full justify-center border" style={{ borderColor: "var(--border)" }}>
                  {t("pos.receive.view_inventory")}
                </Link>
              )}
            </div>
          )}

          {/* Scanner tab */}
          {sideTab === "scanner" && (
            <div
              className="rounded-xl border p-4 space-y-3"
              style={{ background: "var(--surface)", borderColor: "var(--border)" }}
            >
              <h3 className="text-[13px] font-bold" style={{ color: "var(--text)" }}>
                {t("pos.receive.barcode_scanner")}
              </h3>
              <p className="text-[12px]" style={{ color: "var(--text-3)" }}>
                {cameraStatus}
              </p>

              {/* Camera preview */}
              <div className="overflow-hidden rounded-xl" style={{ background: "#000" }}>
                <video
                  ref={videoRef}
                  className={`aspect-video w-full object-cover ${cameraEngine === "html5" ? "hidden" : "block"}`}
                  muted playsInline
                />
                <div id={RECEIVE_CAMERA_READER_ID} className={cameraEngine === "html5" ? "block" : "hidden"} />
              </div>

              <input ref={scanCaptureInputRef} type="file" accept="image/*" capture="environment" onChange={handleScanCapture} className="hidden" />

              <button
                type="button"
                onClick={startCamera}
                className="btn w-full justify-center gap-2"
                style={cameraEngine
                  ? { background: "var(--rose-soft)", color: "var(--rose)", border: "1px solid rgba(244,63,94,0.3)" }
                  : { background: "var(--text)", color: "var(--surface)" }
                }
              >
                <ScanBarcode size={15} />
                {cameraEngine ? t("pos.stop") : t("pos.scan")}
              </button>

              <p className="text-[11px] text-center" style={{ color: "var(--text-3)" }}>
                {t("pos.receive.usb_scanner_desc")}
              </p>
            </div>
          )}

          {/* Labels tab */}
          {sideTab === "labels" && (
            <div
              className="rounded-xl border p-4 space-y-4"
              style={{ background: "var(--surface)", borderColor: "var(--border)" }}
            >
              <h3 className="text-[13px] font-bold" style={{ color: "var(--text)" }}>
                {t("pos.receive.barcode_labels")}
              </h3>

              <div>
                <p className="text-[11px] font-bold uppercase tracking-wide mb-2" style={{ color: "var(--text-3)" }}>
                  {t("pos.receive.label_size")}
                </p>
                <div className="grid grid-cols-3 gap-2">
                  {(Object.keys(labelSizes) as LabelSize[]).map((size) => (
                    <button
                      key={size}
                      type="button"
                      onClick={() => setLabelSize(size)}
                      className="rounded-lg border py-2 text-[12px] font-semibold transition"
                      style={labelSize === size
                        ? { background: "var(--accent-soft)", borderColor: "var(--accent)", color: "var(--accent-text)" }
                        : { borderColor: "var(--border)", color: "var(--text-2)" }
                      }
                    >
                      {labelSizes[size].label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Label preview for active row */}
              {rows.find((r) => r.id === activeRowId)?.barcode && (
                <div
                  className="rounded-lg overflow-hidden p-3 flex flex-col items-center gap-1"
                  style={{ background: "#fff" }}
                >
                  <p className="text-[10px] font-bold text-zinc-800 truncate max-w-full">{rows.find((r) => r.id === activeRowId)?.name}</p>
                  <div dangerouslySetInnerHTML={{ __html: renderCode128Svg(rows.find((r) => r.id === activeRowId)!.barcode, 60, 1.5) }} />
                  <p className="text-[9px] text-zinc-500">{rows.find((r) => r.id === activeRowId)?.barcode}</p>
                </div>
              )}

              <button
                type="button"
                onClick={printLabels}
                className="btn btn-primary w-full justify-center gap-2 h-10"
              >
                <Printer size={15} />
                {t("pos.receive.print_labels", { n: formatNumber(labelsToPrint) })}
              </button>

              <p className="text-[11px] text-center" style={{ color: "var(--text-3)" }}>
                {t("pos.receive.barcode_labels_desc")}
              </p>
            </div>
          )}
        </aside>
      </div>
    </main>
  )
}

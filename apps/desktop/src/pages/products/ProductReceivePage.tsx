import { useEffect, useMemo, useRef, useState } from "react"
import type { ChangeEvent } from "react"
import { Link, useSearchParams } from "react-router"
import {
  Barcode, Camera, CheckCircle2, ChevronDown, ChevronUp, ClipboardPaste, Copy, ImagePlus, LoaderCircle, Plus, Printer,
  RotateCcw, ScanLine, Trash2,
} from "lucide-react"
import { useI18n } from "@lebanonpos/shared"

import { Badge, Drawer, PageHeader, SkeletonRows, StockNav, type Tone } from "../../features/pos/components/backoffice/BackOffice"
import { renderCode128Svg } from "../../features/pos/lib/barcode"
import {
  createBarcodeDetector, createHtml5Qrcode, detectBarcodeFromImageFile, getCameraErrorMessage, getHtml5QrcodeFormatCodes,
  getLiveCameraIssue, getPreferredCameraConstraints, type BrowserBarcodeDetector, type Html5QrcodeInstance,
} from "../../features/pos/lib/cameraScanner"
import { formatCurrency, formatNumber } from "../../features/pos/lib/currency"
import { fileToCompressedDataUrl } from "../../features/pos/lib/image"
import {
  addScan, applyReceiveResults, createRow, fillRowFromBarcode, isBlankRow, isRowReady, normalizeCode, parseDraft,
  rowProblems, serializeDraft, toReceiveEntry, type BatchRow, type ReceiveDraft, type RowProblem,
} from "../../features/pos/lib/receiveRows"
import {
  clearReceiveDraft, getReceiveFinanceIssues, getReceiveSubmission, getUnresolvedReceiveSubmissions, readReceiveDraftRaw,
  recoverReceiveDraft, ReceiveOutcomeUnknownError, writeReceiveDraft, type DraftRecovery,
} from "../../features/pos/services/receiveSubmission.service"
import { retryReceiveFinance } from "../../features/pos/services/receiveRecovery.service"
import ReceiveRecoveryDrawer, { type RecoverySettled } from "../../features/pos/components/backoffice/ReceiveRecoveryDrawer"
import { createId } from "../../features/pos/lib/storage"
import {
  findProductByBarcode, findProductsByExactName, generateProductBarcode, getProducts, parseSpreadsheetPaste, productMatchesSearch,
  subscribeProducts,
} from "../../features/pos/services/product.service"
import { recordAuditEvent } from "../../features/pos/services/security.service"
import { getSettings } from "../../features/pos/services/settings.service"
import {
  getSupplierLedger, receiveAndRecord, subscribeSuppliers, type PurchasePaymentMethod, type ReceivingSummary, type SupplierLedger,
} from "../../features/pos/services/supplier.service"
import { showToast } from "../../features/pos/services/toast.service"
import type { Product } from "../../features/pos/types/product"

// Midnight Gold v2 — Receiving (DESIGN-SYSTEM §8, prototype 04-receiving). One scan field for the
// delivery, a row grid where every row always shows its state, supplier/invoice/payment, a summary,
// and a draft that survives leaving the page. Rules: lib/receiveRows (unit-tested); writes only via
// receiveAndRecord on Save; a saved row leaves the grid (it can never be received twice).
type LabelSize = "40x25" | "50x30" | "58x35"
const LABEL_SIZES: Record<LabelSize, { width: string; height: string }> = {
  "40x25": { width: "40mm", height: "25mm" }, "50x30": { width: "50mm", height: "30mm" }, "58x35": { width: "58mm", height: "35mm" },
}
const PAYMENTS: PurchasePaymentMethod[] = ["On Account", "Cash", "Card", "Bank Transfer", "Wallet"]
const PAY_KEY: Record<string, string> = { "On Account": "on_account", Cash: "cash", Card: "card", "Bank Transfer": "bank_transfer", Wallet: "wallet" }
const CAMERA_READER_ID = "lebanonpos-receive-camera-reader"
const PROBLEM_KEY: Record<RowProblem, string> = {
  needs_decision: "inv.rcv.p.needs_decision", missing_name: "inv.rcv.p.missing_name", missing_barcode: "inv.rcv.p.missing_barcode",
  missing_quantity: "inv.rcv.p.missing_quantity", missing_target: "inv.rcv.p.missing_target", missing_variant_name: "inv.rcv.p.missing_variant_name",
  negative_money: "inv.rcv.p.negative_money",
}
function escapeHtml(v: string) { return v.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;") }
const num = (v: string) => { const n = Number(v); return Number.isFinite(n) ? n : 0 }
type SavedInfo = ReceivingSummary & { units: number; labels: Array<{ name: string; price: number; barcode: string; n: number }> }

export default function ProductReceivePage() {
  const { t, locale } = useI18n()
  const [params, setParams] = useSearchParams()
  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState(true)
  const [suppliers, setSuppliers] = useState<SupplierLedger[]>(() => getSupplierLedger())
  // Reopening: a draft whose save was in flight is settled by that save's ledger entry first
  // (receiveSubmission.service), so a delivery that already went in is never offered again.
  const initial = useMemo(() => {
    try {
      const d = parseDraft(readReceiveDraftRaw())
      return d ? recoverReceiveDraft(d) : null
    } catch { return null }
  }, [])
  const initialDraft = initial?.draft ?? null
  const [rows, setRows] = useState<BatchRow[]>(() => initialDraft?.rows ?? [createRow()])
  const [draftRestored, setDraftRestored] = useState(!!initialDraft && initial?.recovery.kind !== "committed")
  const [pending, setPending] = useState<ReceiveDraft["pending"]>(initialDraft?.pending)
  const [recovery, setRecovery] = useState<DraftRecovery>(initial?.recovery ?? { kind: "none" })
  const [unresolved, setUnresolved] = useState(() => { try { return getUnresolvedReceiveSubmissions() } catch { return [] } })
  const [financeIssues, setFinanceIssues] = useState(() => { try { return getReceiveFinanceIssues() } catch { return [] } })
  const [reviewId, setReviewId] = useState<string | null>(null)
  const [retrying, setRetrying] = useState("")
  const [activeRowId, setActiveRowId] = useState<string>(() => (initialDraft?.rows ?? [])[0]?.id ?? "")
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [scan, setScan] = useState("")
  const [scanStatus, setScanStatus] = useState("")
  const [pickerRowId, setPickerRowId] = useState<string | null>(null)
  const [pickerQuery, setPickerQuery] = useState("")
  const [pickerMode, setPickerMode] = useState<"alias" | "variant">("alias")
  const [supplierId, setSupplierId] = useState(initialDraft?.supplierId ?? "")
  const [payment, setPayment] = useState<PurchasePaymentMethod>((initialDraft?.paymentMethod as PurchasePaymentMethod) || "On Account")
  const [invoice, setInvoice] = useState(initialDraft?.invoiceNumber ?? "")
  const [note, setNote] = useState(initialDraft?.note ?? "")
  const [saving, setSaving] = useState(false)
  // The state above only changes after a re-render, so two clicks in one tick would both see
  // saving=false and receive the delivery twice. The ref is the lock; the state drives the UI.
  const savingRef = useRef(false)
  const [lastSaved, setLastSaved] = useState<SavedInfo | null>(null)
  const [problemBanner, setProblemBanner] = useState(false)
  const [pasteOpen, setPasteOpen] = useState(false)
  const [pasteText, setPasteText] = useState("")
  const [labelSize, setLabelSize] = useState<LabelSize>("50x30")
  const [suggestions, setSuggestions] = useState<Record<string, { name: string; category: string } | null | false>>({})
  const [cameraEngine, setCameraEngine] = useState<"native" | "html5" | null>(null)
  const [cameraStatus, setCameraStatus] = useState("")
  const scanRef = useRef<HTMLInputElement>(null)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const captureRef = useRef<HTMLInputElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const frameRef = useRef<number | null>(null)
  const detectorRef = useRef<BrowserBarcodeDetector | null>(null)
  const html5Ref = useRef<Html5QrcodeInstance | null>(null)
  const settings = getSettings()

  useEffect(() => {
    let alive = true
    getProducts().then((d) => { if (alive) { setProducts(d); setLoading(false) } })
    const un1 = subscribeProducts((d) => { if (alive) setProducts(d) })
    const un2 = subscribeSuppliers(() => { if (alive) setSuppliers(getSupplierLedger()) })
    return () => { alive = false; un1(); un2(); stopCamera() }
  }, [])

  // Deep link from a product: /products/new?barcode=… starts the delivery with that product.
  useEffect(() => {
    const code = params.get("barcode")
    if (!code || loading) return
    scanCode(code)
    const next = new URLSearchParams(params); next.delete("barcode"); setParams(next, { replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading])

  // Draft: saved as you go (images excluded); removed when the delivery is empty.
  useEffect(() => {
    const id = window.setTimeout(() => {
      try {
        const begun = rows.some((r) => !isBlankRow(r))
        if (!begun && !invoice.trim() && !note.trim() && !pending) clearReceiveDraft()
        else writeReceiveDraft(serializeDraft({ rows, supplierId, invoiceNumber: invoice, paymentMethod: payment, note, pending }))
      } catch { /* storage unavailable: nothing to persist */ }
    }, 300)
    return () => window.clearTimeout(id)
  }, [rows, supplierId, invoice, payment, note, pending])

  const byId = (id?: number) => (id == null ? undefined : products.find((p) => p.id === id))
  const productFor = (r: BatchRow) => (r.mode === "matched" ? findProductByBarcode(r.barcode) ?? undefined : r.mode === "alias" ? byId(r.targetProductId) : undefined)
  const started = rows.filter((r) => !isBlankRow(r))
  const ready = started.filter(isRowReady)
  const problemRows = started.filter((r) => !isRowReady(r))
  const units = ready.reduce((s, r) => s + r.quantity, 0)
  const cost = ready.reduce((s, r) => s + r.quantity * r.cost, 0)
  const labelsCount = rows.reduce((s, r) => s + (r.barcode.trim() && r.name.trim() ? Math.max(0, r.labels) : 0), 0)
  const supplier = suppliers.find((s) => s.id === supplierId)
  const categories = useMemo(() => Array.from(new Set(products.map((p) => p.category))).filter(Boolean), [products])
  const pasteResult = useMemo(() => parseSpreadsheetPaste(pasteText), [pasteText])

  function update(id: string, patch: Partial<BatchRow>) {
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch, saveError: undefined } : r)))
  }
  function focusRow(id: string) {
    setActiveRowId(id)
    setExpanded((e) => new Set(e).add(id))
    window.requestAnimationFrame(() => {
      document.querySelector<HTMLElement>(`[data-row="${id}"]`)?.scrollIntoView({ block: "center" })
      const target = document.querySelector<HTMLElement>(`[data-row-detail="${id}"] [data-first], [data-row="${id}"] input:not([disabled])`)
      target?.focus()
    })
  }
  function scanCode(raw: string) {
    const code = normalizeCode(raw)
    if (!code) return
    const product = findProductByBarcode(code) ?? undefined
    const res = addScan(rows, code, product)
    setRows(res.rows)
    setActiveRowId(res.rowId)
    setLastSaved(null)
    if (product) setScanStatus(t(res.merged ? "inv.rcv.scan_more" : "inv.rcv.scan_matched", { name: product.name, n: formatNumber(res.rows.find((r) => r.id === res.rowId)?.quantity ?? 1) }))
    else { setScanStatus(t("inv.rcv.scan_unknown", { code })); setExpanded((e) => new Set(e).add(res.rowId)); void lookup(code) }
  }
  function onScanKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key !== "Enter") return
    e.preventDefault()
    scanCode(scan)
    setScan("")
  }
  // Typing or scanning into a row's own barcode field keeps the previous row behaviour.
  function rowBarcode(row: BatchRow, value: string) {
    const clean = normalizeCode(value)
    const product = clean ? findProductByBarcode(clean) : undefined
    setRows((rs) => rs.map((r) => {
      if (r.id !== row.id) return r
      if (product) return { ...fillRowFromBarcode(r, clean, product), quantity: r.quantity, saveError: undefined }
      return { ...r, barcode: value, scannedBarcode: clean, mode: r.mode === "alias" || r.mode === "variant" ? r.mode : "new", saveError: undefined }
    }))
    if (clean && !product) void lookup(clean)
  }
  async function lookup(code: string) {
    // External product-name lookup for unknown codes (unchanged behaviour: UPCitemdb, then Open *Facts).
    if (code.length < 8 || suggestions[code] !== undefined) return
    setSuggestions((s) => ({ ...s, [code]: null }))
    try {
      const res = await fetch(`https://api.upcitemdb.com/prod/trial/lookup?upc=${encodeURIComponent(code)}`, { signal: AbortSignal.timeout(6000) })
      if (res.ok) {
        const item = (await res.json())?.items?.[0]
        const name = (item?.title || item?.description || "").trim()
        if (name) { setSuggestions((s) => ({ ...s, [code]: { name, category: item.category || "General" } })); return }
      }
    } catch { /* next */ }
    for (const base of ["https://world.openfoodfacts.org", "https://world.openbeautyfacts.org", "https://world.openproductsfacts.org"]) {
      try {
        const res = await fetch(`${base}/api/v2/product/${encodeURIComponent(code)}.json`, { signal: AbortSignal.timeout(6000) })
        if (!res.ok) continue
        const p = (await res.json())?.product
        if (p?.product_name) {
          const category = (p.categories_tags?.[0] || "").replace("en:", "").replace(/-/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase()) || "General"
          setSuggestions((s) => ({ ...s, [code]: { name: p.product_name as string, category } })); return
        }
      } catch { /* next */ }
    }
    setSuggestions((s) => ({ ...s, [code]: false }))
  }
  function chooseNew(id: string) { update(id, { mode: "new", targetProductId: undefined, decisionConfirmed: true }) }
  function stageAlias(id: string, target: Product) {
    setRows((rs) => rs.map((r) => {
      if (r.id !== id) return r
      const alias = normalizeCode(r.scannedBarcode || r.barcode)
      return { ...r, mode: "alias", targetProductId: target.id, decisionConfirmed: true, scannedBarcode: alias, barcode: alias, name: target.name, category: target.category, price: target.price, cost: r.cost || target.cost, accent: target.accent, saveError: undefined }
    }))
    setPickerRowId(null); setPickerQuery("")
  }
  function stageVariant(id: string, parent: Product) {
    setRows((rs) => rs.map((r) => {
      if (r.id !== id) return r
      const code = normalizeCode(r.scannedBarcode || r.barcode)
      return { ...r, mode: "variant", parentProductId: parent.id, targetProductId: undefined, decisionConfirmed: true, scannedBarcode: code, barcode: code, variantName: r.variantName ?? "", name: parent.name, category: parent.category, accent: parent.accent, saveError: undefined }
    }))
    setPickerRowId(null); setPickerQuery("")
  }
  function setVariantName(id: string, value: string) {
    setRows((rs) => rs.map((r) => {
      if (r.id !== id) return r
      const parent = byId(r.parentProductId)
      return { ...r, variantName: value, name: parent ? `${parent.name}${value.trim() ? ` - ${value.trim()}` : ""}` : r.name, saveError: undefined }
    }))
  }
  function undoDecision(id: string) {
    setRows((rs) => rs.map((r) => (r.id !== id ? r : { ...r, mode: "new", targetProductId: undefined, parentProductId: undefined, variantName: undefined, decisionConfirmed: false, barcode: r.scannedBarcode || r.barcode, name: "", category: "Pantry", price: 0, cost: 0 })))
  }
  function removeRow(id: string) {
    setRows((rs) => { const next = rs.filter((r) => r.id !== id); return next.length ? next : [createRow()] })
  }
  function duplicateRow(r: BatchRow) {
    // A duplicate is a new-product row without the barcode (a code belongs to one product only).
    const copy = createRow({ name: r.name, category: r.category, cost: r.cost, price: r.price, quantity: r.quantity, reorderPoint: r.reorderPoint, reorderQuantity: r.reorderQuantity, labels: r.labels, accent: r.accent, decisionConfirmed: !!r.name })
    setRows((rs) => [...rs, copy]); focusRow(copy.id)
  }
  function addPasted() {
    const added = pasteResult.rows.map((p) => {
      const product = findProductByBarcode(p.barcode)
      return product
        ? { ...fillRowFromBarcode(createRow(), p.barcode, product), quantity: p.quantity, cost: p.cost || product.cost, price: p.price || product.price }
        : createRow({ name: p.name, barcode: p.barcode, scannedBarcode: p.barcode, category: p.category, quantity: p.quantity, cost: p.cost, price: p.price, decisionConfirmed: true })
    })
    setRows((rs) => [...rs.filter((r) => !isBlankRow(r)), ...added])
    showToast(pasteResult.rejected.length ? t("inv.rcv.paste_partial", { n: added.length, r: pasteResult.rejected.length }) : t("inv.rcv.paste_done", { n: added.length }), pasteResult.rejected.length ? "error" : "success")
    setPasteOpen(false); setPasteText("")
  }

  function save(readyOnly = false) {
    if (savingRef.current) return
    // An interrupted save must be reconciled before anything else is received (no blind resend).
    if (unresolved.length > 0) { document.getElementById("rcv-unknown")?.focus(); return }
    if (ready.length === 0) {
      showToast(t("pos.receive.no_ready_rows"), "error")
      if (problemRows[0]) focusRow(problemRows[0].id)
      return
    }
    // Fixable problems never disable Save: Save takes the user to the first one, unless they chose
    // to save only the ready rows (the others stay in the grid).
    if (problemRows.length > 0 && !readyOnly) { setProblemBanner(true); focusRow(problemRows[0].id); return }
    const sent = ready
    const sentUnits = units
    const sentCost = cost
    const labels = sent.filter((r) => r.barcode.trim() && r.name.trim() && r.labels > 0).map((r) => ({ name: r.name, price: r.price, barcode: r.mode === "alias" ? r.scannedBarcode : r.barcode, n: r.labels }))
    // The draft records this save (its id and row ids) on disk BEFORE anything is written, so a
    // crash at any point is recoverable on reopen. If that cannot be recorded, nothing is sent.
    const nextPending = { submissionId: createId("receive"), rowIds: sent.map((r) => r.id) }
    try {
      writeReceiveDraft(serializeDraft({ rows, supplierId, invoiceNumber: invoice, paymentMethod: payment, note, pending: nextPending }))
    } catch {
      showToast(t("inv.rcv.rec.persist_failed"), "error")
      return
    }
    savingRef.current = true
    setSaving(true)
    setPending(nextPending)
    setRecovery({ kind: "none" })
    receiveAndRecord(sent.map(toReceiveEntry), supplier ? { supplierId: supplier.id, supplierName: supplier.name, invoiceNumber: invoice, paymentMethod: payment, note } : undefined, { submissionId: nextPending.submissionId })
      .then((summary) => {
        // Rows are matched by id; rows added while saving are untouched.
        const after = applyReceiveResults(rows, summary.results)
        setRows((rs) => applyReceiveResults(rs, summary.results))
        setPending(undefined)
        setProblemBanner(false)
        setDraftRestored(false)
        getProducts().then(setProducts)
        setSuppliers(getSupplierLedger())
        recordAuditEvent({ action: "inventory.receive", entity: "inventory", summary: `${sentUnits} units received.`, metadata: { rows: sent.length, totalUnits: sentUnits, totalCost: sentCost, poNumber: summary.poNumber } })
        setLastSaved({ ...summary, units: sentUnits, labels })
        setFinanceIssues(getReceiveFinanceIssues())
        if (after.every(isBlankRow)) { setInvoice(""); setNote("") }
        // Stock, purchase order and payment are separate outcomes; a failed one is said, not hidden.
        if (summary.purchaseOrder.status === "failed") showToast(t("inv.rcv.fin.po_failed_toast"), "error")
        else if (summary.payment.status === "failed") showToast(t("inv.rcv.fin.pay_failed_toast", { number: summary.purchaseOrder.number ?? "" }), "error")
        showToast(summary.errors.length ? t("inv.rcv.saved_partial", { ok: summary.acceptedCount, bad: summary.rejectedCount }) : t("inv.rcv.saved", { units: formatNumber(sentUnits) }), summary.errors.length ? "error" : "success")
        window.requestAnimationFrame(() => scanRef.current?.focus())
      })
      .catch((err) => {
        if (err instanceof ReceiveOutcomeUnknownError) {
          // Some of it may be in stock: keep the rows locked under this save until someone checks.
          setRecovery({ kind: "unknown", submissionId: err.submissionId })
          setUnresolved(getUnresolvedReceiveSubmissions())
          showToast(t("inv.rcv.rec.unknown_title"), "error")
        } else {
          // Refused before anything was written (permissions, license): every row stays.
          setPending(undefined)
          showToast(String((err as Error)?.message ?? err), "error")
        }
      })
      .finally(() => { savingRef.current = false; setSaving(false) })
  }
  // An interrupted save settled from the recovery drawer: the rows follow what actually happened.
  function onRecoverySettled(id: string, how: RecoverySettled) {
    const sub = getReceiveSubmission(id)
    if (sub) {
      const sent = new Set(sub.rowIds)
      if (how === "completed" && sub.results) setRows((rs) => applyReceiveResults(rs, sub.results!))
      if (how === "closed") setRows((rs) => rs.map((r) => (sent.has(r.id) ? { ...r, saveError: t("inv.rcv.fx.closed_row") } : r)))
    }
    if (pending?.submissionId === id) setPending(undefined)
    setRecovery({ kind: "none" })
    setReviewId(null)
    setUnresolved(getUnresolvedReceiveSubmissions())
    setFinanceIssues(getReceiveFinanceIssues())
    getProducts().then(setProducts)
    setSuppliers(getSupplierLedger())
  }
  async function retryFinance(id: string) {
    if (retrying) return
    setRetrying(id)
    try {
      const fin = await retryReceiveFinance(id)
      const ok = fin.purchaseOrder.status === "recorded" && (fin.payment.status === "recorded" || fin.payment.status === "on_account")
      showToast(ok ? t("inv.rcv.fin.retry_ok", { number: fin.purchaseOrder.number ?? "" }) : t("inv.rcv.fin.retry_failed"), ok ? "success" : "error")
    } catch (e) {
      showToast(String((e as Error)?.message ?? e), "error")
    } finally {
      setRetrying("")
      setFinanceIssues(getReceiveFinanceIssues())
      setSuppliers(getSupplierLedger())
    }
  }
  function clearDelivery() {
    if (pending) return // rows under an unreconciled save are evidence; resolve it first
    setRows([createRow()]); setInvoice(""); setNote(""); setLastSaved(null); setProblemBanner(false); setDraftRestored(false)
    try { clearReceiveDraft() } catch { /* ignore */ }
    showToast(t("pos.receive.batch_cleared"))
  }
  function printLabels(list: Array<{ name: string; price: number; barcode: string; n: number }>) {
    const labels = list.flatMap((l) => Array.from({ length: Math.max(0, l.n) }, () => l))
    if (!labels.length) { showToast(t("pos.receive.print_labels_incomplete"), "error"); return }
    const size = LABEL_SIZES[labelSize]
    const html = labels.map((l) => `<section class="label"><div class="name">${escapeHtml(l.name)}</div><div class="barcode">${renderCode128Svg(l.barcode, 54, 2)}</div><div class="meta"><span>${escapeHtml(l.barcode)}</span><strong>${escapeHtml(formatCurrency(l.price))}</strong></div></section>`).join("")
    const win = window.open("", "print-labels")
    if (!win) { showToast(t("pos.receive.popup_blocked"), "error"); return }
    win.document.write(`<!doctype html><html><head><style>@page{size:${size.width} ${size.height};margin:0}*{box-sizing:border-box}body{margin:0;font-family:Arial,sans-serif;color:#000}.label{width:${size.width};height:${size.height};page-break-after:always;padding:2mm;display:flex;flex-direction:column;justify-content:space-between;overflow:hidden}.name{font-size:10px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.barcode{height:14mm}.barcode svg{width:100%;height:100%;display:block}.meta{display:flex;align-items:center;justify-content:space-between;font-size:8px;gap:2mm}</style></head><body>${html}</body></html>`)
    win.document.close(); win.focus(); window.setTimeout(() => win.print(), 250)
    showToast(t("inv.rcv.labels_sent", { n: labels.length }))
  }

  // Camera: a scan goes into the delivery like the scan field (unchanged engines).
  async function startCamera() {
    if (cameraEngine) { stopCamera(); setCameraStatus(""); return }
    const issue = getLiveCameraIssue()
    if (issue) { setCameraStatus(issue); captureRef.current?.click(); return }
    try {
      const detector = await createBarcodeDetector()
      if (!detector) {
        setCameraEngine("html5"); setCameraStatus(t("pos.receive.camera_ready"))
        await new Promise<void>((r) => window.requestAnimationFrame(() => r()))
        const scanner = await createHtml5Qrcode(CAMERA_READER_ID)
        if (!scanner) { stopCamera(); setCameraStatus(t("pos.receive.camera_engine_failed")); return }
        html5Ref.current = scanner
        await scanner.start({ facingMode: "environment" }, { fps: 12, qrbox: { width: 260, height: 160 }, formatsToSupport: getHtml5QrcodeFormatCodes() }, (text) => { scanCode(text); setCameraStatus(""); stopCamera() })
        return
      }
      const stream = await navigator.mediaDevices.getUserMedia(getPreferredCameraConstraints())
      streamRef.current = stream
      if (videoRef.current) { videoRef.current.srcObject = stream; videoRef.current.muted = true; videoRef.current.setAttribute("playsinline", "true"); await videoRef.current.play() }
      detectorRef.current = detector; setCameraEngine("native"); setCameraStatus(t("pos.receive.camera_ready")); void cameraFrame()
    } catch (err) { stopCamera(); setCameraStatus(getCameraErrorMessage(err)) }
  }
  async function onCapture(e: ChangeEvent<HTMLInputElement>) {
    const file = e.currentTarget.files?.[0]; e.currentTarget.value = ""
    if (!file) return
    try { const bc = await detectBarcodeFromImageFile(file); if (!bc) { showToast(t("pos.receive.no_barcode_found"), "error"); return } scanCode(bc) }
    catch { showToast(t("pos.receive.scan_failed"), "error") }
  }
  function stopCamera() {
    if (frameRef.current) { window.cancelAnimationFrame(frameRef.current); frameRef.current = null }
    streamRef.current?.getTracks().forEach((tr) => tr.stop()); streamRef.current = null; detectorRef.current = null
    const s = html5Ref.current; html5Ref.current = null
    if (s) void s.stop().catch(() => undefined).finally(() => s.clear())
    if (videoRef.current) videoRef.current.srcObject = null
    setCameraEngine(null)
  }
  async function cameraFrame() {
    const d = detectorRef.current; const v = videoRef.current
    if (!d || !v) return
    try { const r = await d.detect(v); const bc = r[0]?.rawValue; if (bc) { scanCode(bc); setCameraStatus(""); stopCamera(); return } } catch { /* keep scanning */ }
    frameRef.current = window.requestAnimationFrame(() => void cameraFrame())
  }

  const lockedRows = new Set(pending && unresolved.some((u) => u.id === pending.submissionId) ? pending.rowIds : [])
  function rowState(r: BatchRow): { tone: Tone; text: string } {
    if (lockedRows.has(r.id)) return { tone: "err", text: t("inv.rcv.rec.row_unknown") }
    if (r.saveError) return { tone: "err", text: t("inv.rcv.not_saved", { reason: r.saveError }) }
    const { problems } = rowProblems(r, productFor(r))
    if (problems.length) return { tone: "warn", text: problems.map((p) => t(PROBLEM_KEY[p])).join(" · ") }
    if (r.mode === "matched") return { tone: "ok", text: t("inv.rcv.s.matched", { code: r.scannedBarcode || r.barcode }) }
    if (r.mode === "alias") return { tone: "info", text: t("inv.rcv.s.alias", { name: byId(r.targetProductId)?.name ?? "" }) }
    if (r.mode === "variant") return { tone: "info", text: t("inv.rcv.s.variant", { name: byId(r.parentProductId)?.name ?? "" }) }
    return { tone: "info", text: t("inv.rcv.s.new") }
  }

  if (loading) return <main className="mg2 mg2-bo min-h-0 flex-1 overflow-y-auto"><div className="mg2-wrap"><SkeletonRows /></div></main>

  return (
    <main className="mg2 mg2-bo min-h-0 flex-1 overflow-y-auto">
      <div className="mg2-wrap">
        <PageHeader eyebrow={t("inv.eyebrow")} title={t("inv.rcv.title")} actions={
          <button type="button" className="mg2-btn mg2-btn-ghost" onClick={clearDelivery} disabled={(started.length === 0 && !invoice) || !!pending}><RotateCcw size={16} />{t("inv.rcv.clear")}</button>
        } />
        <StockNav counts={{ receiving: started.length || undefined }} />

        {unresolved.map((u) => (
          <div key={u.id} id="rcv-unknown" tabIndex={-1} className="mg2-banner mg2-t-err" role="alert" style={{ marginBottom: 12, flexWrap: "wrap" }}>
            <div style={{ flex: "1 1 320px", color: "var(--text)" }}>
              <strong style={{ display: "block" }}>{t("inv.rcv.rec.unknown_title")}</strong>
              <span>{t("inv.rcv.rec.unknown_text", { n: u.rowIds.length, time: new Intl.DateTimeFormat(locale === "ar" ? "ar-LB" : "en-GB", { dateStyle: "medium", timeStyle: "short" }).format(new Date(u.startedAt)) })}</span>
            </div>
            <button type="button" className="mg2-btn mg2-btn-primary" onClick={() => setReviewId(u.id)}>{t("inv.rcv.fx.review")}</button>
          </div>
        ))}
        {financeIssues.map((f) => {
          const fin = f.finance!
          const poFailed = fin.purchaseOrder.status === "failed"
          return (
            <div key={f.id} className="mg2-banner mg2-t-warn" role="status" style={{ marginBottom: 12, flexWrap: "wrap" }}>
              <div style={{ flex: "1 1 320px", color: "var(--text)" }}>
                <strong style={{ display: "block" }}>{poFailed ? t("inv.rcv.fin.po_failed_title") : t("inv.rcv.fin.pay_failed_title", { number: fin.purchaseOrder.number ?? "" })}</strong>
                <span>{poFailed
                  ? t("inv.rcv.fin.po_failed_text", { units: formatNumber(f.summary?.units ?? 0), name: f.context?.supplierName ?? "", error: fin.purchaseOrder.error ?? "" })
                  : t("inv.rcv.fin.pay_failed_text", { amount: formatCurrency(fin.payment.amount), name: f.context?.supplierName ?? "", error: fin.payment.error ?? "" })}</span>
              </div>
              <button type="button" className="mg2-btn mg2-btn-primary" aria-busy={retrying === f.id || undefined} disabled={!!retrying} onClick={() => void retryFinance(f.id)}>
                {retrying === f.id ? <LoaderCircle size={16} className="animate-spin" aria-hidden="true" /> : <RotateCcw size={16} aria-hidden="true" />}
                {poFailed ? t("inv.rcv.fin.retry_po") : t("inv.rcv.fin.retry_pay")}
              </button>
            </div>
          )
        })}
        {recovery.kind === "committed" && (
          <div className="mg2-banner mg2-t-ok" role="status" style={{ marginBottom: 12 }}>
            <CheckCircle2 size={18} aria-hidden="true" />
            <span style={{ flex: 1, color: "var(--text)" }}>{t(recovery.rejected ? "inv.rcv.rec.recovered_some" : "inv.rcv.rec.recovered", { n: recovery.accepted, units: formatNumber(recovery.units), r: recovery.rejected })}</span>
            <Link to="/stock" className="mg2-btn" style={{ textDecoration: "none" }}>{t("inv.rcv.view_lots")}</Link>
            <button type="button" className="mg2-btn mg2-btn-ghost" onClick={() => setRecovery({ kind: "none" })}>{t("inv.rcv.rec.dismiss")}</button>
          </div>
        )}
        {draftRestored && started.length > 0 && unresolved.length === 0 && (
          <div className="mg2-banner mg2-t-info" role="status" style={{ marginBottom: 12 }}>
            <span style={{ flex: 1 }}>{t("inv.rcv.draft_restored", { n: started.length })}</span>
            <button type="button" className="mg2-btn" onClick={() => setDraftRestored(false)}>{t("inv.rcv.keep")}</button>
            <button type="button" className="mg2-btn mg2-btn-ghost" onClick={clearDelivery}>{t("inv.rcv.discard")}</button>
          </div>
        )}
        {lastSaved && (
          <div className="mg2-banner mg2-t-ok" role="status" style={{ marginBottom: 12 }}>
            <CheckCircle2 size={18} aria-hidden="true" />
            <dl className="mg2-outcomes" style={{ flex: 1, color: "var(--text)" }}>
              <div><dt>{t("inv.rcv.fin.receiving")}</dt><dd>{t("inv.rcv.saved_summary", { units: formatNumber(lastSaved.units), created: lastSaved.productsCreated, updated: lastSaved.productsUpdated, lots: lastSaved.batchesCreated })}</dd></div>
              {lastSaved.purchaseOrder.status !== "not_needed" && <div><dt>{t("inv.rcv.fin.po")}</dt><dd>{lastSaved.purchaseOrder.status === "recorded"
                ? <><span className="num" dir="ltr">{lastSaved.purchaseOrder.number}</span> · {formatCurrency(lastSaved.purchaseOrder.total ?? 0)}</>
                : <Badge tone="err">{t("inv.rcv.fin.not_recorded")}</Badge>}</dd></div>}
              {lastSaved.payment.status !== "not_needed" && <div><dt>{t("inv.rcv.fin.payment")}</dt><dd>{lastSaved.payment.status === "recorded"
                ? t("inv.rcv.fin.paid_with", { amount: formatCurrency(lastSaved.payment.amount), method: t(`inv.rcv.pay.${PAY_KEY[lastSaved.payment.method ?? ""] ?? "cash"}`) })
                : lastSaved.payment.status === "on_account" ? t("inv.rcv.fin.on_account", { amount: formatCurrency(lastSaved.purchaseOrder.total ?? 0) })
                : <Badge tone="err">{t("inv.rcv.fin.unpaid", { amount: formatCurrency(lastSaved.payment.amount) })}</Badge>}</dd></div>}
            </dl>
            {lastSaved.labels.length > 0 && <button type="button" className="mg2-btn" onClick={() => printLabels(lastSaved.labels)}><Printer size={16} />{t("inv.rcv.print_saved_labels")}</button>}
            <Link to="/stock" className="mg2-btn" style={{ textDecoration: "none" }}>{t("inv.rcv.view_lots")}</Link>
          </div>
        )}

        <div className="mg2-layout">
          <section className="mg2-card" aria-label={t("inv.rcv.delivery")}>
            <div style={{ padding: 12, display: "flex", gap: 8, flexWrap: "wrap", borderBottom: "1px solid var(--border)" }}>
              <div className="mg2-search" style={{ maxWidth: "none", flex: "1 1 320px" }}>
                <ScanLine size={18} aria-hidden="true" />
                <input ref={scanRef} className="mg2-input" style={{ minHeight: 48, fontSize: 16, borderColor: "var(--brand-border)" }} value={scan} onChange={(e) => setScan(e.target.value)} onKeyDown={onScanKey}
                  placeholder={t("inv.rcv.scan")} aria-label={t("inv.rcv.scan")} autoFocus />
              </div>
              <button type="button" className="mg2-btn" style={{ minHeight: 48 }} onClick={() => void startCamera()} aria-pressed={!!cameraEngine} aria-label={t("pos.scan")}><Camera size={18} /></button>
              <button type="button" className="mg2-btn" style={{ minHeight: 48 }} onClick={() => setPasteOpen(true)}><ClipboardPaste size={16} />{t("inv.rcv.paste")}</button>
              <button type="button" className="mg2-btn" style={{ minHeight: 48 }} onClick={() => { const r = createRow(); setRows((rs) => [...rs, r]); focusRow(r.id) }}><Plus size={16} />{t("inv.rcv.add_row")}</button>
              {scanStatus && <p className="mg2-cap" role="status" style={{ margin: 0, flexBasis: "100%" }}>{scanStatus}</p>}
              {cameraStatus && <p className="mg2-cap" style={{ margin: 0, flexBasis: "100%" }}>{cameraStatus}</p>}
              {cameraEngine && (
                <div style={{ flexBasis: "100%", borderRadius: 12, overflow: "hidden", border: "1.5px solid var(--brand)" }}>
                  <video ref={videoRef} muted playsInline className={`aspect-video w-full bg-zinc-950 object-cover ${cameraEngine === "native" ? "block" : "hidden"}`} />
                  <div id={CAMERA_READER_ID} className={cameraEngine === "html5" ? "block" : "hidden"} />
                </div>
              )}
            </div>

            <div style={{ overflowX: "auto" }}>
              <table className="mg2-table mg2-rgrid" style={{ minWidth: 860 }} aria-label={t("inv.rcv.rows")}>
                <thead>
                  <tr>
                    <th>{t("inv.rcv.col.item")}</th>
                    <th className="num" style={{ width: 80 }}>{t("inv.rcv.col.qty")}</th>
                    <th className="num" style={{ width: 104 }}>{t("inv.rcv.col.cost")}</th>
                    <th className="num" style={{ width: 104 }}>{t("inv.rcv.col.price")}</th>
                    <th style={{ width: 156 }}>{t("inv.rcv.col.expiry")}</th>
                    <th className="num" style={{ width: 72 }}>{t("inv.rcv.col.labels")}</th>
                    <th style={{ width: 136 }}><span className="sr-only">{t("inv.rcv.col.actions")}</span></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.flatMap((r) => {
                    const st = isBlankRow(r) ? null : rowState(r)
                    const { notices } = rowProblems(r, productFor(r))
                    const open = expanded.has(r.id) || pickerRowId === r.id
                    const fixed = r.mode === "matched" || r.mode === "alias" || r.mode === "variant"
                    const nameMatches = r.mode === "new" && r.name.trim() ? findProductsByExactName(r.name, products) : []
                    const code = r.scannedBarcode || r.barcode
                    const label = r.name || code || ""
                    const pickerResults = pickerRowId === r.id ? products.filter((p) => !p.archived && productMatchesSearch(p, pickerQuery)).slice(0, 20) : []
                    const main = (
                      <tr key={r.id} data-row={r.id} aria-selected={activeRowId === r.id} className={st?.tone === "err" ? "row-error" : st?.tone === "warn" ? "row-problem" : undefined} onFocus={() => setActiveRowId(r.id)}>
                        <td>
                          {fixed
                            ? <strong>{r.name}</strong>
                            : <input className="mg2-input" value={r.name} onChange={(e) => update(r.id, { name: e.target.value, decisionConfirmed: r.decisionConfirmed || !!e.target.value })} aria-label={t("inv.field.name")} placeholder={code ? t("inv.rcv.name_for", { code }) : t("inv.field.name")} />}
                          <span className="sub" style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center", marginTop: 4 }}>
                            {st ? <Badge tone={st.tone}>{st.text}</Badge> : <span className="mg2-cap">{t("inv.rcv.empty_row")}</span>}
                            {notices.map((n) => <Badge key={n.key} tone={n.key === "cost_over_price" ? "warn" : "info"}>{t(`inv.rcv.n.${n.key}`, { pct: Math.abs(n.pct ?? 0) })}</Badge>)}
                          </span>
                        </td>
                        <td><input className="mg2-input num" type="number" min="0" step="1" inputMode="numeric" dir="ltr" value={r.quantity || ""} onChange={(e) => update(r.id, { quantity: num(e.target.value) })} aria-label={t("inv.rcv.qty_for", { name: label })} aria-invalid={!isBlankRow(r) && !(r.quantity > 0) ? true : undefined} /></td>
                        <td><input className="mg2-input num" type="number" min="0" step="0.01" inputMode="decimal" dir="ltr" value={r.cost || ""} onChange={(e) => update(r.id, { cost: num(e.target.value) })} aria-label={t("inv.rcv.cost_for", { name: label })} /></td>
                        <td><input className="mg2-input num" type="number" min="0" step="0.01" inputMode="decimal" dir="ltr" value={r.price || ""} disabled={r.mode === "alias"} title={r.mode === "alias" ? t("inv.rcv.alias_price") : undefined} onChange={(e) => update(r.id, { price: num(e.target.value) })} aria-label={t("inv.rcv.price_for", { name: label })} /></td>
                        <td><input className="mg2-input" type="date" dir="ltr" value={r.expiryDate} onChange={(e) => update(r.id, { expiryDate: e.target.value })} aria-label={t("inv.rcv.expiry_for", { name: label })} /></td>
                        <td><input className="mg2-input num" type="number" min="0" step="1" dir="ltr" value={r.labels || ""} onChange={(e) => update(r.id, { labels: num(e.target.value) })} aria-label={t("inv.rcv.labels_for", { name: label })} /></td>
                        <td>
                          <div style={{ display: "flex", gap: 2, justifyContent: "flex-end" }}>
                            <button type="button" className="mg2-btn mg2-btn-ghost" style={{ width: 40, padding: 0 }} onClick={() => setExpanded((e) => { const n = new Set(e); if (n.has(r.id)) n.delete(r.id); else n.add(r.id); return n })} aria-expanded={open} aria-label={t("inv.rcv.details_for", { name: label })}>{open ? <ChevronUp size={16} /> : <ChevronDown size={16} />}</button>
                            <button type="button" className="mg2-btn mg2-btn-ghost" style={{ width: 40, padding: 0 }} onClick={() => duplicateRow(r)} aria-label={t("inv.rcv.duplicate")}><Copy size={15} /></button>
                            <button type="button" className="mg2-btn mg2-btn-ghost" style={{ width: 40, padding: 0 }} onClick={() => removeRow(r.id)} aria-label={t("inv.rcv.remove_row")}><Trash2 size={15} /></button>
                          </div>
                        </td>
                      </tr>
                    )
                    if (!open) return [main]
                    const detail = (
                      <tr key={`${r.id}-d`} className="detail" data-row-detail={r.id}>
                        <td colSpan={7}>
                          <div style={{ display: "flex", flexDirection: "column", gap: 10, padding: "6px 2px" }}>
                            {r.mode === "new" && code && !r.decisionConfirmed && !r.name.trim() && (
                              <div className="mg2-banner mg2-t-warn" style={{ padding: "8px 12px" }}>
                                <span style={{ flex: 1, color: "var(--text)" }}>{t("inv.rcv.unknown_choose", { code })}</span>
                                <button type="button" className="mg2-btn mg2-btn-primary" data-first onClick={() => chooseNew(r.id)}>{t("inv.rcv.new_product")}</button>
                                <button type="button" className="mg2-btn" onClick={() => { setPickerMode("alias"); setPickerRowId(r.id); setPickerQuery("") }}>{t("inv.rcv.add_to_existing")}</button>
                                <button type="button" className="mg2-btn" onClick={() => { setPickerMode("variant"); setPickerRowId(r.id); setPickerQuery("") }}>{t("inv.rcv.make_variant")}</button>
                              </div>
                            )}
                            {nameMatches.length > 0 && !r.decisionConfirmed && (
                              <div className="mg2-banner mg2-t-warn" style={{ padding: "8px 12px" }}>
                                <span style={{ flex: 1, color: "var(--text)" }}>{t("inv.rcv.name_exists", { name: nameMatches[0].name, code: nameMatches[0].barcode || "—" })}</span>
                                <button type="button" className="mg2-btn" onClick={() => { if (nameMatches.length === 1) stageAlias(r.id, nameMatches[0]); else { setPickerMode("alias"); setPickerRowId(r.id); setPickerQuery(r.name) } }}>{t("inv.rcv.add_to_existing")}</button>
                                <button type="button" className="mg2-btn mg2-btn-ghost" onClick={() => chooseNew(r.id)}>{t("inv.rcv.keep_new")}</button>
                              </div>
                            )}
                            {(r.mode === "alias" || r.mode === "variant") && (
                              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                                <Badge tone="info">{r.mode === "alias" ? t("inv.rcv.s.alias", { name: byId(r.targetProductId)?.name ?? "" }) : t("inv.rcv.s.variant", { name: byId(r.parentProductId)?.name ?? "" })}</Badge>
                                {r.mode === "variant" && <input className="mg2-input" data-first value={r.variantName ?? ""} onChange={(e) => setVariantName(r.id, e.target.value)} placeholder={t("inv.field.variant_name")} aria-label={t("inv.field.variant_name")} />}
                                <button type="button" className="mg2-btn mg2-btn-ghost" onClick={() => undoDecision(r.id)}>{t("inv.rcv.undo")}</button>
                              </div>
                            )}
                            {pickerRowId === r.id && (
                              <div className="mg2-card" style={{ padding: 10, display: "flex", flexDirection: "column", gap: 8 }}>
                                <span className="mg2-label" style={{ margin: 0 }}>{pickerMode === "variant" ? t("inv.rcv.pick_parent") : t("inv.rcv.pick_target")}</span>
                                <input className="mg2-input" data-first autoFocus value={pickerQuery} onChange={(e) => setPickerQuery(e.target.value)} placeholder={t("inv.products.search")} aria-label={t("inv.products.search")} />
                                <div style={{ maxHeight: 220, overflowY: "auto", display: "flex", flexDirection: "column" }}>
                                  {pickerResults.length === 0 ? <p className="mg2-cap" style={{ margin: 0, padding: 8 }}>{pickerQuery ? t("inv.products.no_match") : t("inv.rcv.type_to_search")}</p> : pickerResults.map((p) => (
                                    <button key={p.id} type="button" className="mg2-btn mg2-btn-ghost" style={{ justifyContent: "space-between" }} onClick={() => (pickerMode === "variant" ? stageVariant(r.id, p) : stageAlias(r.id, p))}>
                                      <span>{p.name}</span><span className="mg2-cap num" dir="ltr">{p.barcode || "—"} · {formatCurrency(p.price)} · {formatNumber(p.stock)}</span>
                                    </button>
                                  ))}
                                </div>
                                <button type="button" className="mg2-btn mg2-btn-ghost" style={{ alignSelf: "flex-start" }} onClick={() => setPickerRowId(null)}>{t("inv.cancel")}</button>
                              </div>
                            )}
                            {(() => { const sug = suggestions[code]; return sug && r.mode === "new" && !r.name && (
                              <button type="button" className="mg2-btn" style={{ alignSelf: "flex-start" }} onClick={() => update(r.id, { name: sug.name, category: sug.category, decisionConfirmed: true })}>
                                {t("inv.rcv.use_suggestion", { name: sug.name })}
                              </button>
                            ) })()}
                            {suggestions[code] === null && r.mode === "new" && code.length >= 8 && <span className="mg2-cap" role="status" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><LoaderCircle size={13} className="animate-spin" aria-hidden="true" />{t("inv.rcv.looking_up")}</span>}
                            <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", alignItems: "end" }}>
                              <label className="mg2-field"><span className="lbl">{t("inv.field.barcode")}</span>
                                <span style={{ display: "flex", gap: 6 }}>
                                  <input className="mg2-input num" dir="ltr" style={{ flex: 1 }} value={r.mode === "alias" || r.mode === "variant" ? r.scannedBarcode : r.barcode} disabled={r.mode === "alias" || r.mode === "variant"} onChange={(e) => rowBarcode(r, e.target.value)} />
                                  {r.mode === "new" && <button type="button" className="mg2-btn" style={{ padding: "0 10px" }} onClick={() => { update(r.id, { barcode: generateProductBarcode(), decisionConfirmed: true }); showToast(t("pos.receive.barcode_generated")) }} aria-label={t("inv.generate")}><Barcode size={16} /></button>}
                                </span>
                              </label>
                              {!fixed && <label className="mg2-field"><span className="lbl">{t("inv.field.category")}</span><input className="mg2-input" list="rcv-categories" value={r.category} onChange={(e) => update(r.id, { category: e.target.value })} /></label>}
                              <label className="mg2-field"><span className="lbl">{t("inv.field.reorder_point")}</span><input className="mg2-input num" type="number" min="0" dir="ltr" value={r.reorderPoint} onChange={(e) => update(r.id, { reorderPoint: num(e.target.value) })} /></label>
                              <label className="mg2-field"><span className="lbl">{t("inv.field.reorder_qty")}</span><input className="mg2-input num" type="number" min="0" dir="ltr" value={r.reorderQuantity} onChange={(e) => update(r.id, { reorderQuantity: num(e.target.value) })} /></label>
                              {r.cost > 0 && r.mode !== "alias" && (
                                <div style={{ display: "flex", gap: 6 }}>
                                  {[settings.profitPercent1, settings.profitPercent2].map((pct) => (
                                    <button key={pct} type="button" className="mg2-btn" onClick={() => update(r.id, { price: Math.round(r.cost * (1 + pct / 100) * 100) / 100 })}>{t("inv.rcv.price_plus", { pct })}</button>
                                  ))}
                                </div>
                              )}
                              {r.mode === "new" && (
                                <div className="mg2-field"><span className="lbl">{t("inv.rcv.image")}</span>
                                  <label className="mg2-btn" style={{ gap: 8, overflow: "hidden", minWidth: 0, justifyContent: "flex-start", paddingInlineStart: r.image ? 0 : undefined }}>
                                    {r.image ? <img src={r.image} alt="" style={{ width: 40, height: 40, objectFit: "cover", flex: "none" }} /> : <ImagePlus size={16} aria-hidden="true" style={{ flex: "none" }} />}<span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t("inv.image_pick")}</span>
                                    <input type="file" accept="image/*" className="sr-only" onChange={(e) => { const f = e.target.files?.[0]; if (f) fileToCompressedDataUrl(f).then((d) => update(r.id, { image: d })).catch(() => undefined); e.target.value = "" }} />
                                  </label>
                                </div>
                              )}
                              {(r.mode === "alias" ? r.scannedBarcode : r.barcode) && <span style={{ background: "#fff", borderRadius: 6, padding: 4, display: "inline-flex", justifySelf: "start" }} dangerouslySetInnerHTML={{ __html: renderCode128Svg(r.mode === "alias" ? r.scannedBarcode : r.barcode, 28, 1) }} />}
                            </div>
                          </div>
                        </td>
                      </tr>
                    )
                    return [main, detail]
                  })}
                </tbody>
              </table>
            </div>
            <datalist id="rcv-categories">{categories.map((c) => <option key={c} value={c} />)}</datalist>

            {problemRows.length > 0 && (problemBanner || ready.length > 0) && (
              <div className="mg2-banner mg2-t-warn" role={problemBanner ? "alert" : "status"} style={{ margin: 12 }}>
                <span style={{ flex: 1, color: "var(--text)" }}>{t("inv.rcv.problems", { n: problemRows.length })}</span>
                <button type="button" className="mg2-btn" onClick={() => focusRow(problemRows[0].id)}>{t("inv.rcv.go_to_row")}</button>
                {ready.length > 0 && <button type="button" className="mg2-btn" onClick={() => save(true)} disabled={saving || unresolved.length > 0}>{t("inv.rcv.save_ready_only", { n: ready.length })}</button>}
              </div>
            )}
          </section>

          <aside style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <section className="mg2-card mg2-card-body" style={{ display: "flex", flexDirection: "column", gap: 12 }} aria-label={t("inv.rcv.supplier_invoice")}>
              <h2 className="mg2-section-title">{t("inv.rcv.supplier_invoice")}</h2>
              {suppliers.length > 0 ? (
                <label className="mg2-field"><span className="lbl">{t("inv.field.supplier")}</span>
                  <select className="mg2-select" value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
                    <option value="">{t("inv.no_supplier")}</option>
                    {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </label>
              ) : <Link to="/suppliers" className="mg2-btn" style={{ textDecoration: "none" }}>{t("inv.rcv.add_supplier")}</Link>}
              <label className="mg2-field"><span className="lbl">{t("inv.rcv.invoice")}</span><input className="mg2-input" dir="ltr" value={invoice} onChange={(e) => setInvoice(e.target.value)} /></label>
              <div>
                <span className="mg2-label" id="rcv-pay-label">{t("inv.rcv.payment")}</span>
                <div className="mg2-seg" role="radiogroup" aria-labelledby="rcv-pay-label" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(112px, 1fr))" }}>
                  {PAYMENTS.map((m) => (
                    <label key={m}><input type="radio" name="rcv-pay" checked={payment === m} disabled={!supplier} onChange={() => setPayment(m)} /><CheckCircle2 size={14} className="mg2-chk" aria-hidden="true" />{t(`inv.rcv.pay.${PAY_KEY[m]}`)}</label>
                  ))}
                </div>
              </div>
              <p className="mg2-cap" style={{ margin: 0 }}>
                {!supplier ? t("inv.rcv.no_supplier_help") : payment === "On Account" ? t("inv.rcv.on_account_help", { amount: formatCurrency(cost), name: supplier.name }) : t("inv.rcv.paid_now_help", { amount: formatCurrency(cost), method: t(`inv.rcv.pay.${PAY_KEY[payment]}`) })}
              </p>
              <label className="mg2-field"><span className="lbl">{t("inv.rcv.note")}</span><textarea className="mg2-input" rows={2} style={{ paddingBlock: 8 }} value={note} onChange={(e) => setNote(e.target.value)} /></label>
            </section>

            <section className="mg2-card mg2-card-body" aria-label={t("inv.rcv.summary")}>
              <h2 className="mg2-section-title" style={{ marginBottom: 8 }}>{t("inv.rcv.summary")}</h2>
              <div className="mg2-sum"><span>{t("inv.rcv.ready_rows")}</span><strong>{t("inv.rcv.x_of_y", { x: ready.length, y: started.length })}</strong></div>
              <div className="mg2-sum"><span>{t("inv.rcv.units")}</span><strong>{formatNumber(units)}</strong></div>
              <div className="mg2-sum"><span>{t("inv.field.cost")}</span><strong>{formatCurrency(cost)}</strong></div>
              <div className="mg2-sum"><span>{t("inv.rcv.labels_to_print")}</span><strong>{formatNumber(labelsCount)}</strong></div>
              <button type="button" className="mg2-btn mg2-btn-primary" style={{ width: "100%", minHeight: 52, marginTop: 10 }} onClick={() => save(false)} aria-busy={saving || undefined} disabled={saving || unresolved.length > 0}>
                {saving ? <LoaderCircle size={18} className="animate-spin" aria-hidden="true" /> : <CheckCircle2 size={18} aria-hidden="true" />}{saving ? t("inv.rcv.saving") : t("inv.rcv.save")}
              </button>
              <p className="mg2-cap" style={{ margin: "8px 0 0" }}>{unresolved.length > 0 ? t("inv.rcv.rec.blocked") : problemRows.length ? t("inv.rcv.save_help_problems", { n: problemRows.length }) : t("inv.rcv.save_help")}</p>
            </section>

            <section className="mg2-card mg2-card-body" style={{ display: "flex", flexDirection: "column", gap: 10 }} aria-label={t("inv.rcv.labels")}>
              <h2 className="mg2-section-title">{t("inv.rcv.labels")}</h2>
              <div className="mg2-seg" role="radiogroup" aria-label={t("inv.rcv.label_size")} style={{ gridTemplateColumns: "repeat(3, 1fr)" }}>
                {(Object.keys(LABEL_SIZES) as LabelSize[]).map((s) => (
                  <label key={s}><input type="radio" name="rcv-label" checked={labelSize === s} onChange={() => setLabelSize(s)} /><span className="num" dir="ltr">{t(`pos.receive.label_${s}`)}</span></label>
                ))}
              </div>
              <button type="button" className="mg2-btn" disabled={labelsCount === 0} onClick={() => printLabels(rows.filter((r) => r.barcode.trim() && r.name.trim()).map((r) => ({ name: r.name, price: r.price, barcode: r.mode === "alias" ? r.scannedBarcode : r.barcode, n: r.labels })))}>
                <Printer size={16} />{t("inv.rcv.print_labels", { n: labelsCount })}
              </button>
            </section>
          </aside>
        </div>
      </div>

      <input ref={captureRef} type="file" accept="image/*" capture="environment" onChange={onCapture} hidden />
      <ReceiveRecoveryDrawer key={reviewId ?? "none"} submissionId={reviewId} onClose={() => setReviewId(null)} onSettled={onRecoverySettled} />
      <Drawer open={pasteOpen} title={t("inv.rcv.paste_title")} onClose={() => setPasteOpen(false)}
        footer={<>
          <button type="button" className="mg2-btn mg2-btn-primary" disabled={!pasteResult.rows.length} onClick={addPasted}>{t("inv.rcv.paste_add", { n: pasteResult.rows.length })}</button>
          <button type="button" className="mg2-btn mg2-btn-ghost" onClick={() => setPasteOpen(false)}>{t("inv.cancel")}</button>
        </>}>
        <p className="mg2-cap" style={{ margin: 0 }}>{t("inv.rcv.paste_help")}</p>
        <textarea className="mg2-input" dir="ltr" rows={10} style={{ paddingBlock: 8, fontFamily: "ui-monospace, monospace" }} value={pasteText} onChange={(e) => setPasteText(e.target.value)} aria-label={t("inv.rcv.paste_title")} data-autofocus />
        {pasteText.trim() && (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <Badge tone="ok">{t("inv.rcv.paste_preview", { n: pasteResult.rows.length, known: pasteResult.rows.filter((p) => findProductByBarcode(p.barcode)).length, fresh: pasteResult.rows.filter((p) => !findProductByBarcode(p.barcode)).length })}</Badge>
            {pasteResult.rejected.map((x) => <Badge key={x.index} tone="err">{t("inv.rcv.paste_rejected", { row: x.index, reason: x.reason })}</Badge>)}
          </div>
        )}
      </Drawer>
    </main>
  )
}

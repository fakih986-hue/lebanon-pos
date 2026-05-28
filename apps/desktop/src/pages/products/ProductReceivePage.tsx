import { useEffect, useMemo, useRef, useState } from "react"
import type { ChangeEvent } from "react"
import {
  Barcode,
  Banknote,
  Building2,
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

const purchasePaymentMethods: PurchasePaymentMethod[] = [
  "On Account",
  "Cash",
  "Card",
  "Bank Transfer",
  "Wallet",
]

const labelSizes: Record<LabelSize, { label: string; width: string; height: string }> =
  {
    "40x25": {
      label: "40 x 25 mm",
      width: "40mm",
      height: "25mm",
    },
    "50x30": {
      label: "50 x 30 mm",
      width: "50mm",
      height: "30mm",
    },
    "58x35": {
      label: "58 x 35 mm",
      width: "58mm",
      height: "35mm",
    },
  }

const accents: ProductAccent[] = [
  "emerald",
  "cyan",
  "amber",
  "rose",
  "violet",
  "indigo",
]

const RECEIVE_CAMERA_READER_ID = "lebanonpos-receive-camera-reader"

function createRow(defaults?: Partial<BatchRow>): BatchRow {
  const index = Math.floor(Math.random() * accents.length)

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
    accent: accents[index],
    ...defaults,
  }
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;")
}

function normalizeNumber(value: string) {
  const parsedValue = Number(value)

  return Number.isFinite(parsedValue) ? parsedValue : 0
}

function isRowReady(row: BatchRow) {
  return (
    row.name.trim().length > 0 &&
    row.category.trim().length > 0 &&
    row.barcode.trim().length > 0 &&
    row.quantity > 0 &&
    row.price >= 0 &&
    row.cost >= 0
  )
}

export default function ProductReceivePage() {
  const { t } = useI18n()
  const [products, setProducts] = useState<Product[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [suppliers, setSuppliers] =
    useState<SupplierLedger[]>(getSupplierLedger())
  const [rows, setRows] = useState<BatchRow[]>([createRow()])
  const [activeRowId, setActiveRowId] = useState(rows[0].id)
  const [scannerValue, setScannerValue] = useState("")
  const [cameraStatus, setCameraStatus] = useState(t("pos.receive.camera_idle"))
  const [cameraEngine, setCameraEngine] = useState<"native" | "html5" | null>(
    null
  )
  const [labelSize, setLabelSize] = useState<LabelSize>("50x30")
  const [lastReceivedTotal, setLastReceivedTotal] = useState(0)
  const [selectedSupplierId, setSelectedSupplierId] = useState("")
  const [purchasePaymentMethod, setPurchasePaymentMethod] =
    useState<PurchasePaymentMethod>("On Account")
  const [supplierInvoiceNumber, setSupplierInvoiceNumber] = useState("")
  const [supplierNote, setSupplierNote] = useState("")
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const scanCaptureInputRef = useRef<HTMLInputElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const frameRef = useRef<number | null>(null)
  const detectorRef = useRef<BrowserBarcodeDetector | null>(null)
  const html5ScannerRef = useRef<Html5QrcodeInstance | null>(null)

  useEffect(() => {
    let active = true

    getProducts().then((data) => {
      if (active) {
        setProducts(data)
        setIsLoading(false)
      }
    })

    const unsubscribeSuppliers = subscribeSuppliers(() =>
      setSuppliers(getSupplierLedger())
    )

    return () => {
      active = false
      unsubscribeSuppliers()
      stopCamera()
    }
  }, [])

  const categories = useMemo(
    () => Array.from(new Set(products.map((product) => product.category))),
    [products]
  )

  const readyRows = rows.filter(isRowReady)
  const totalUnits = readyRows.reduce((sum, row) => sum + row.quantity, 0)
  const totalCost = readyRows.reduce(
    (sum, row) => sum + row.quantity * row.cost,
    0
  )
  const selectedSupplier = suppliers.find(
    (supplier) => supplier.id === selectedSupplierId
  )
  const labelsToPrint = rows.reduce(
    (sum, row) => sum + (row.barcode.trim() ? Math.max(0, row.labels) : 0),
    0
  )

  function updateRow(id: string, patch: Partial<BatchRow>) {
    setRows((currentRows) =>
      currentRows.map((row) =>
        row.id === id
          ? {
              ...row,
              ...patch,
            }
          : row
      )
    )
  }

  function addRow(defaults?: Partial<BatchRow>) {
    const row = createRow(defaults)

    setRows((currentRows) => [...currentRows, row])
    setActiveRowId(row.id)
  }

  function removeRow(id: string) {
    setRows((currentRows) => {
      const nextRows = currentRows.filter((row) => row.id !== id)

      if (nextRows.length === 0) {
        const row = createRow()
        setActiveRowId(row.id)

        return [row]
      }

      if (activeRowId === id) {
        setActiveRowId(nextRows[0].id)
      }

      return nextRows
    })
  }

  function applyBarcodeToActiveRow(barcode: string) {
    const cleanBarcode = barcode.trim().replace(/\s+/g, "")

    if (!cleanBarcode) {
      return
    }

    const product = findProductByBarcode(cleanBarcode)

    setRows((currentRows) =>
      currentRows.map((row) => {
        if (row.id !== activeRowId) {
          return row
        }

        if (!product) {
          return {
            ...row,
            barcode: cleanBarcode,
          }
        }

        return {
          ...row,
          name: product.name,
          category: product.category,
          price: product.price,
          cost: product.cost,
          reorderPoint: product.reorderPoint ?? 10,
          reorderQuantity: product.reorderQuantity ?? 20,
          expiryDate: product.expiryDate ?? "",
          barcode: product.barcode,
          accent: product.accent,
        }
      })
    )

    setScannerValue("")
    showToast(
      product
        ? `Existing product loaded: ${product.name}.`
        : `New barcode captured: ${cleanBarcode}.`
    )
  }

  function generateBarcodeForRow(id: string) {
    updateRow(id, {
      barcode: generateProductBarcode(),
    })
    setActiveRowId(id)
    showToast(t("pos.receive.barcode_generated"))
  }

  function duplicateRow(row: BatchRow) {
    addRow({
      name: row.name,
      category: row.category,
      cost: row.cost,
      price: row.price,
      quantity: row.quantity,
      reorderPoint: row.reorderPoint,
      reorderQuantity: row.reorderQuantity,
      expiryDate: row.expiryDate,
      labels: row.labels,
      accent: row.accent,
      barcode: "",
    })
  }

  function saveBatch() {
    if (readyRows.length === 0) {
      showToast(t("pos.receive.no_ready_rows"), "error")
      return
    }

    receiveProducts(
      readyRows.map((row) => ({
        name: row.name,
        category: row.category,
        cost: row.cost,
        price: row.price,
        stock: row.quantity,
        barcode: row.barcode,
        accent: row.accent,
        reorderPoint: row.reorderPoint,
        reorderQuantity: row.reorderQuantity,
        expiryDate: row.expiryDate,
        supplierId: selectedSupplier?.id,
        supplierName: selectedSupplier?.name,
      }))
    )

    getProducts().then(setProducts)
    setLastReceivedTotal(totalUnits)
    let purchaseOrderNumber = ""
    let purchaseOrderError = ""

    if (selectedSupplier && totalCost > 0) {
      try {
        const purchaseOrder = recordPurchaseOrder({
          supplierId: selectedSupplier.id,
          supplierName: selectedSupplier.name,
          status: "Received",
          invoiceNumber: supplierInvoiceNumber,
          note: supplierNote,
          paymentMethod: purchasePaymentMethod,
          paidAmount:
            purchasePaymentMethod === "On Account" ? 0 : totalCost,
          items: readyRows.map((row) => ({
            name: row.name,
            barcode: row.barcode,
            quantity: row.quantity,
            unitCost: row.cost,
            unitPrice: row.price,
            total: row.quantity * row.cost,
          })),
        })

        purchaseOrderNumber = purchaseOrder.poNumber
        setSuppliers(getSupplierLedger())
      } catch (error) {
        purchaseOrderError =
          error instanceof Error
            ? error.message
            : t("pos.receive.po_not_recorded")
      }
    }

    recordAuditEvent({
      action: "inventory.receive",
      entity: "inventory",
      summary: `${formatNumber(totalUnits)} units received into inventory.`,
      metadata: {
        rows: readyRows.length,
        totalUnits,
        totalCost,
        supplierId: selectedSupplier?.id,
        purchaseOrderNumber,
      },
    })
    showToast(
      purchaseOrderError
        ? `${formatNumber(
            totalUnits
          )} units received. Purchase not recorded: ${purchaseOrderError}`
        : `${formatNumber(totalUnits)} units received${
            purchaseOrderNumber ? ` and ${purchaseOrderNumber} created` : ""
          }.`
    )
  }

  function resetBatch() {
    const row = createRow()

    setRows([row])
    setActiveRowId(row.id)
    setScannerValue("")
    setLastReceivedTotal(0)
    setSupplierInvoiceNumber("")
    setSupplierNote("")
    showToast(t("pos.receive.batch_cleared"))
  }

  async function startCamera() {
    if (cameraEngine) {
      stopCamera()
      setCameraStatus(t("pos.receive.camera_stopped"))
      return
    }

    const liveCameraIssue = getLiveCameraIssue()

    if (liveCameraIssue) {
      setCameraStatus(`${liveCameraIssue} Opening scanner capture instead.`)
      scanCaptureInputRef.current?.click()
      return
    }

    try {
      const detector = await createBarcodeDetector()

      if (!detector) {
        setCameraEngine("html5")
        setCameraStatus("Starting bundled camera scanner...")
        await new Promise<void>((resolve) =>
          window.requestAnimationFrame(() => resolve())
        )

        const scanner = await createHtml5Qrcode(RECEIVE_CAMERA_READER_ID)

        if (!scanner) {
          stopCamera()
          setCameraStatus(
            t("pos.receive.camera_engine_failed")
          )
          return
        }

        html5ScannerRef.current = scanner
        await scanner.start(
          {
            facingMode: "environment",
          },
          {
            fps: 12,
            qrbox: {
              width: 260,
              height: 160,
            },
            formatsToSupport: getHtml5QrcodeFormatCodes(),
          },
          (decodedText) => {
            applyBarcodeToActiveRow(decodedText)
            setCameraStatus(t("pos.receive.scanned", { barcode: decodedText }))
            stopCamera()
          }
        )
        setCameraStatus(t("pos.receive.camera_ready"))
        return
      }

      const stream = await navigator.mediaDevices.getUserMedia(
        getPreferredCameraConstraints()
      )

      streamRef.current = stream

      if (videoRef.current) {
        videoRef.current.srcObject = stream
        videoRef.current.muted = true
        videoRef.current.setAttribute("playsinline", "true")
        await videoRef.current.play()
      }

      detectorRef.current = detector
      setCameraEngine("native")
      setCameraStatus(t("pos.receive.camera_ready"))
      void scanCameraFrame()
    } catch (error) {
      stopCamera()
      setCameraStatus(
        t("pos.receive.camera_error_with_hint", { error: getCameraErrorMessage(error) })
      )
    }
  }

  async function handleScanCapture(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0]

    event.currentTarget.value = ""

    if (!file) {
      return
    }

    try {
      setCameraStatus(t("pos.receive.reading_barcode"))
      const barcode = await detectBarcodeFromImageFile(file)

      if (!barcode) {
        setCameraStatus(t("pos.receive.no_barcode_found"))
        return
      }

      applyBarcodeToActiveRow(barcode)
      setCameraStatus(t("pos.receive.scanned", { barcode }))
    } catch {
      setCameraStatus(t("pos.receive.scan_failed"))
    }
  }

  function stopCamera() {
    if (frameRef.current) {
      window.cancelAnimationFrame(frameRef.current)
      frameRef.current = null
    }

    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
    detectorRef.current = null
    const scanner = html5ScannerRef.current

    html5ScannerRef.current = null

    if (scanner) {
      void scanner.stop().catch(() => undefined).finally(() => scanner.clear())
    }

    if (videoRef.current) {
      videoRef.current.srcObject = null
    }

    setCameraEngine(null)
  }

  async function scanCameraFrame() {
    const detector = detectorRef.current
    const video = videoRef.current

    if (!detector || !video) {
      return
    }

    try {
      const results = await detector.detect(video)
      const detectedBarcode = results[0]?.rawValue

      if (detectedBarcode) {
        applyBarcodeToActiveRow(detectedBarcode)
        setCameraStatus(t("pos.receive.scanned", { barcode: detectedBarcode }))
        stopCamera()
        return
      }
    } catch {
      setCameraStatus("Scanning paused. Try better light or use USB scan.")
    }

    frameRef.current = window.requestAnimationFrame(() => {
      void scanCameraFrame()
    })
  }

  function printLabels() {
    const labels = rows
      .filter((row) => row.barcode.trim() && row.name.trim())
      .flatMap((row) =>
        Array.from({ length: Math.max(0, row.labels) }, () => ({
          name: row.name,
          price: row.price,
          barcode: row.barcode,
        }))
      )

    if (labels.length === 0) {
      showToast(t("pos.receive.print_labels_incomplete"), "error")
      return
    }

    const size = labelSizes[labelSize]
    const labelHtml = labels
      .map(
        (label) => `
          <section class="label">
            <div class="name">${escapeHtml(label.name)}</div>
            <div class="barcode">${renderCode128Svg(label.barcode, 54, 2)}</div>
            <div class="meta">
              <span>${escapeHtml(label.barcode)}</span>
              <strong>${escapeHtml(formatCurrency(label.price))}</strong>
            </div>
          </section>
        `
      )
      .join("")

    const printWindow = window.open("", "lebanonpos-label-print")

    if (!printWindow) {
      showToast(t("pos.receive.popup_blocked"), "error")
      return
    }

    printWindow.document.write(`
      <!doctype html>
      <html>
        <head>
          <title>{t("pos.receive.print_title")}</title>
          <style>
            @page {
              size: ${size.width} ${size.height};
              margin: 0;
            }

            * {
              box-sizing: border-box;
            }

            body {
              margin: 0;
              color: #000;
              font-family: Arial, Helvetica, sans-serif;
            }

            .label {
              width: ${size.width};
              height: ${size.height};
              page-break-after: always;
              padding: 2mm;
              display: flex;
              flex-direction: column;
              justify-content: space-between;
              overflow: hidden;
            }

            .name {
              font-size: 10px;
              line-height: 1.1;
              font-weight: 700;
              white-space: nowrap;
              overflow: hidden;
              text-overflow: ellipsis;
            }

            .barcode {
              height: 14mm;
            }

            .barcode svg {
              display: block;
              width: 100%;
              height: 100%;
            }

            .meta {
              display: flex;
              align-items: center;
              justify-content: space-between;
              gap: 2mm;
              font-size: 8px;
              line-height: 1;
            }
          </style>
        </head>
        <body>${labelHtml}</body>
      </html>
    `)
    printWindow.document.close()
    printWindow.focus()
    window.setTimeout(() => printWindow.print(), 250)
    showToast(`${formatNumber(labels.length)} barcode labels sent to print.`)
  }

  return (
    <main className="min-h-0 flex-1 overflow-y-auto bg-page p-3 sm:p-5 xl:p-6">
      {isLoading ? (
        <div className="flex min-h-[400px] items-center justify-center p-6">
          <Spinner label={t("pos.loading_products")} />
        </div>
      ) : (
      <>
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <section className="min-w-0 space-y-5">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <div className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
              <p className="text-sm font-medium text-zinc-500">{t("pos.receive.ready_rows")}</p>
              <p className="mt-2 text-2xl font-bold text-zinc-950">
                {formatNumber(readyRows.length)}
              </p>
            </div>

            <div className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
              <p className="text-sm font-medium text-zinc-500">{t("pos.receive.units")}</p>
              <p className="mt-2 text-2xl font-bold text-zinc-950">
                {formatNumber(totalUnits)}
              </p>
            </div>

            <div className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
              <p className="text-sm font-medium text-zinc-500">{t("pos.receive.cost_value")}</p>
              <p className="mt-2 text-2xl font-bold text-zinc-950">
                {formatCurrency(totalCost)}
              </p>
            </div>
          </div>

          <section className="rounded-lg border border-zinc-200 bg-white shadow-sm">
            <div className="flex flex-col gap-3 border-b border-zinc-200 p-4 xl:flex-row xl:items-center xl:justify-between">
              <div>
                <h2 className="text-xl font-bold text-zinc-950">
                  {t("pos.receive.title")}
                </h2>
                <p className="text-sm text-zinc-500">
                  {t("pos.receive.desc")}
                </p>
              </div>

              <div className="flex flex-col gap-2 sm:flex-row">
                <button
                  type="button"
                  onClick={() => addRow()}
                  className="flex h-11 items-center justify-center gap-2 rounded-lg border border-zinc-200 bg-white px-4 text-sm font-bold text-zinc-700 transition hover:bg-zinc-50"
                >
                  <Plus size={17} />
                  {t("pos.receive.add_row")}
                </button>

                <button
                  type="button"
                  onClick={saveBatch}
                  className="flex h-11 items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 text-sm font-bold text-white transition hover:bg-emerald-500"
                >
                  <ClipboardCheck size={17} />
                  {t("pos.receive.save_batch")}
                </button>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="min-w-[1120px] border-separate border-spacing-0 text-sm">
                <thead>
                  <tr className="text-start text-xs font-bold uppercase tracking-[0.14em] text-zinc-500">
                    <th className="border-b border-zinc-200 px-4 py-3">
                      {t("pos.receive.product_name")}
                    </th>
                    <th className="border-b border-zinc-200 px-4 py-3">
                      {t("pos.table.category")}
                    </th>
                    <th className="border-b border-zinc-200 px-4 py-3">
                      {t("pos.table.barcode")}
                    </th>
                    <th className="border-b border-zinc-200 px-4 py-3">
                      {t("pos.table.qty")}
                    </th>
                    <th className="border-b border-zinc-200 px-4 py-3">
                      {t("pos.receive.low_alert")}
                    </th>
                    <th className="border-b border-zinc-200 px-4 py-3">
                      {t("pos.receive.expiry")}
                    </th>
                    <th className="border-b border-zinc-200 px-4 py-3">
                      {t("pos.table.cost")}
                    </th>
                    <th className="border-b border-zinc-200 px-4 py-3">
                      {t("pos.table.price")}
                    </th>
                    <th className="border-b border-zinc-200 px-4 py-3">
                      {t("pos.receive.labels")}
                    </th>
                    <th className="border-b border-zinc-200 px-4 py-3">
                      {t("pos.table.actions")}
                    </th>
                  </tr>
                </thead>

                <tbody>
                  {rows.map((row, index) => {
                    const active = activeRowId === row.id

                    return (
                      <tr
                        key={row.id}
                        className={active ? "bg-emerald-50/60" : undefined}
                        onFocus={() => setActiveRowId(row.id)}
                      >
                        <td className="border-b border-zinc-100 px-4 py-3">
                          <input
                            value={row.name}
                            onChange={(event) =>
                              updateRow(row.id, { name: event.target.value })
                            }
                            placeholder={t("pos.receive.product_name")}
                            className="h-10 w-56 rounded-lg border border-zinc-200 bg-white px-3 outline-none focus:border-emerald-400 focus:ring-4 focus:ring-emerald-100"
                          />
                        </td>
                        <td className="border-b border-zinc-100 px-4 py-3">
                          <input
                            value={row.category}
                            list="product-categories"
                            onChange={(event) =>
                              updateRow(row.id, {
                                category: event.target.value,
                              })
                            }
                            className="h-10 w-36 rounded-lg border border-zinc-200 bg-white px-3 outline-none focus:border-emerald-400 focus:ring-4 focus:ring-emerald-100"
                          />
                        </td>
                        <td className="border-b border-zinc-100 px-4 py-3">
                          <div className="flex items-center gap-2">
                            <input
                              value={row.barcode}
                              onChange={(event) =>
                                updateRow(row.id, {
                                  barcode: event.target.value,
                                })
                              }
                              placeholder={t("pos.receive.scan_or_generate")}
                              className="h-10 w-44 rounded-lg border border-zinc-200 bg-white px-3 outline-none focus:border-emerald-400 focus:ring-4 focus:ring-emerald-100"
                            />
                            <button
                              type="button"
                              onClick={() => generateBarcodeForRow(row.id)}
                              className="flex h-10 w-10 items-center justify-center rounded-lg border border-zinc-200 text-zinc-600 transition hover:bg-zinc-50"
                              aria-label={t("pos.receive.gen_barcode", { row: index + 1 })}
                            >
                              <Barcode size={17} />
                            </button>
                          </div>
                        </td>
                        <td className="border-b border-zinc-100 px-4 py-3">
                          <input
                            type="number"
                            min="1"
                            value={row.quantity}
                            onChange={(event) =>
                              updateRow(row.id, {
                                quantity: normalizeNumber(event.target.value),
                                labels: normalizeNumber(event.target.value),
                              })
                            }
                            className="h-10 w-20 rounded-lg border border-zinc-200 bg-white px-3 text-end outline-none focus:border-emerald-400 focus:ring-4 focus:ring-emerald-100"
                          />
                        </td>
                        <td className="border-b border-zinc-100 px-4 py-3">
                          <input
                            type="number"
                            min="0"
                            value={row.reorderPoint}
                            onChange={(event) =>
                              updateRow(row.id, {
                                reorderPoint: normalizeNumber(
                                  event.target.value
                                ),
                                reorderQuantity: Math.max(
                                  row.reorderQuantity,
                                  normalizeNumber(event.target.value) * 2
                                ),
                              })
                            }
                            title={t("pos.receive.low_alert_title")}
                            className="h-10 w-24 rounded-lg border border-amber-200 bg-amber-50 px-3 text-end font-semibold text-amber-950 outline-none focus:border-amber-400 focus:ring-4 focus:ring-amber-100"
                          />
                        </td>
                        <td className="border-b border-zinc-100 px-4 py-3">
                          <input
                            type="date"
                            value={row.expiryDate}
                            onChange={(event) =>
                              updateRow(row.id, {
                                expiryDate: event.target.value,
                              })
                            }
                            title={t("pos.receive.expiry_title")}
                            className="h-10 w-36 rounded-lg border border-zinc-200 bg-white px-3 outline-none focus:border-emerald-400 focus:ring-4 focus:ring-emerald-100"
                          />
                        </td>
                        <td className="border-b border-zinc-100 px-4 py-3">
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            value={row.cost}
                            onChange={(event) =>
                              updateRow(row.id, {
                                cost: normalizeNumber(event.target.value),
                              })
                            }
                            className="h-10 w-24 rounded-lg border border-zinc-200 bg-white px-3 text-end outline-none focus:border-emerald-400 focus:ring-4 focus:ring-emerald-100"
                          />
                        </td>
                        <td className="border-b border-zinc-100 px-4 py-3">
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            value={row.price}
                            onChange={(event) =>
                              updateRow(row.id, {
                                price: normalizeNumber(event.target.value),
                              })
                            }
                            className="h-10 w-24 rounded-lg border border-zinc-200 bg-white px-3 text-end outline-none focus:border-emerald-400 focus:ring-4 focus:ring-emerald-100"
                          />
                        </td>
                        <td className="border-b border-zinc-100 px-4 py-3">
                          <input
                            type="number"
                            min="0"
                            value={row.labels}
                            onChange={(event) =>
                              updateRow(row.id, {
                                labels: normalizeNumber(event.target.value),
                              })
                            }
                            className="h-10 w-20 rounded-lg border border-zinc-200 bg-white px-3 text-end outline-none focus:border-emerald-400 focus:ring-4 focus:ring-emerald-100"
                          />
                        </td>
                        <td className="border-b border-zinc-100 px-4 py-3">
                          <div className="flex gap-2">
                            <button
                              type="button"
                              onClick={() => setActiveRowId(row.id)}
                              className={`flex h-10 w-10 items-center justify-center rounded-lg border transition ${
                                active
                                  ? "border-emerald-500 bg-emerald-50 text-emerald-700"
                                  : "border-zinc-200 text-zinc-600 hover:bg-zinc-50"
                              }`}
                              aria-label={t("pos.receive.use_row_scanner", { row: index + 1 })}
                            >
                              <ScanBarcode size={17} />
                            </button>
                            <button
                              type="button"
                              onClick={() => duplicateRow(row)}
                              className="flex h-10 w-10 items-center justify-center rounded-lg border border-zinc-200 text-zinc-600 transition hover:bg-zinc-50"
                              aria-label={t("pos.receive.duplicate_row", { row: index + 1 })}
                            >
                              <Copy size={17} />
                            </button>
                            <button
                              type="button"
                              onClick={() => removeRow(row.id)}
                              className="flex h-10 w-10 items-center justify-center rounded-lg border border-zinc-200 text-zinc-600 transition hover:bg-rose-50 hover:text-rose-600"
                              aria-label={t("pos.receive.remove_row", { row: index + 1 })}
                            >
                              <Trash2 size={17} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            <datalist id="product-categories">
              {categories.map((category) => (
                <option key={category} value={category} />
              ))}
            </datalist>
          </section>
        </section>

        <aside className="space-y-5">
          <section className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-sky-100 text-sky-700">
                <Building2 size={21} />
              </div>
              <div>
                <h2 className="text-lg font-bold text-zinc-950">
                  {t("pos.receive.supplier_purchase")}
                </h2>
                <p className="text-sm text-zinc-500">
                  {t("pos.receive.supplier_purchase_desc")}
                </p>
              </div>
            </div>

            <div className="mt-4 space-y-3">
              {suppliers.length > 0 ? (
                <select
                  value={selectedSupplierId}
                  onChange={(event) => setSelectedSupplierId(event.target.value)}
                  className="h-11 w-full rounded-lg border border-zinc-200 bg-zinc-50 px-3 outline-none focus:border-emerald-400 focus:bg-white focus:ring-4 focus:ring-emerald-100"
                >
                  <option value="">{t("pos.receive.no_supplier")}</option>
                  {suppliers.map((supplier) => (
                    <option key={supplier.id} value={supplier.id}>
                      {supplier.name} - {formatCurrency(supplier.balance)}
                    </option>
                  ))}
                </select>
              ) : (
                <Link
                  to="/suppliers"
                  className="flex h-11 items-center justify-center rounded-lg bg-zinc-950 px-3 text-sm font-bold text-white transition hover:bg-zinc-800"
                >
                  {t("pos.receive.add_supplier")}
                </Link>
              )}

              <input
                value={supplierInvoiceNumber}
                onChange={(event) =>
                  setSupplierInvoiceNumber(event.target.value)
                }
                placeholder={t("pos.receive.invoice_number")}
                className="h-11 w-full rounded-lg border border-zinc-200 bg-zinc-50 px-3 outline-none focus:border-emerald-400 focus:bg-white focus:ring-4 focus:ring-emerald-100"
              />

              <div className="grid grid-cols-2 gap-2">
                {purchasePaymentMethods.map((method) => {
                  const active = purchasePaymentMethod === method
                  const Icon =
                    method === "Cash"
                      ? Banknote
                      : method === "Card"
                        ? CreditCard
                        : method === "Bank Transfer"
                          ? Landmark
                          : method === "Wallet"
                            ? WalletCards
                            : ClipboardCheck

                  return (
                    <button
                      key={method}
                      type="button"
                      onClick={() => setPurchasePaymentMethod(method)}
                      className={`flex h-10 items-center justify-center gap-2 rounded-lg border text-sm font-bold transition ${
                        active
                          ? "border-sky-700 bg-sky-700 text-white"
                          : "border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-50"
                      }`}
                    >
                      <Icon size={15} />
                      {t(
                        method === "On Account"
                          ? "pos.receive.payment.on_account"
                          : method === "Bank Transfer"
                            ? "pos.receive.payment.bank_transfer"
                            : `pos.payment.${method.toLowerCase()}`
                      )}
                    </button>
                  )
                })}
              </div>

              <textarea
                value={supplierNote}
                onChange={(event) => setSupplierNote(event.target.value)}
                placeholder={t("pos.receive.purchase_note")}
                rows={3}
                className="w-full resize-none rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-3 outline-none focus:border-emerald-400 focus:bg-white focus:ring-4 focus:ring-emerald-100"
              />

              <div className="rounded-lg bg-zinc-50 p-3 text-sm">
                <div className="flex justify-between gap-3 text-zinc-600">
                  <span>{t("pos.receive.batch_cost")}</span>
                  <strong className="text-zinc-950">
                    {formatCurrency(totalCost)}
                  </strong>
                </div>
                <div className="mt-2 flex justify-between gap-3 text-zinc-600">
                  <span>{t("pos.table.supplier")}</span>
                  <strong className="truncate text-zinc-950">
                    {selectedSupplier?.name ?? "None"}
                  </strong>
                </div>
              </div>
            </div>
          </section>

          <section className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-zinc-950 text-white">
                <Keyboard size={21} />
              </div>
              <div>
                <h2 className="text-lg font-bold text-zinc-950">
                  {t("pos.receive.usb_scanner")}
                </h2>
                <p className="text-sm text-zinc-500">
                  {t("pos.receive.usb_scanner_desc")}
                </p>
              </div>
            </div>

            <input
              value={scannerValue}
              onChange={(event) => setScannerValue(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault()
                  applyBarcodeToActiveRow(scannerValue)
                }
              }}
              placeholder={t("pos.receive.scan_into_row")}
              className="mt-4 h-12 w-full rounded-lg border border-zinc-200 bg-zinc-50 px-3 outline-none focus:border-emerald-400 focus:bg-white focus:ring-4 focus:ring-emerald-100"
            />
          </section>

          <section className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-emerald-100 text-emerald-700">
                <ScanBarcode size={21} />
              </div>
              <div>
                <h2 className="text-lg font-bold text-zinc-950">
                  {t("pos.receive.barcode_scanner")}
                </h2>
                <p className="text-sm text-zinc-500">
                  {t("pos.receive.barcode_scanner_desc")}
                </p>
              </div>
            </div>

            <div className="mt-4 overflow-hidden rounded-lg border border-zinc-200 bg-zinc-950">
              <video
                ref={videoRef}
                className={`aspect-video w-full object-cover ${
                  cameraEngine === "html5" ? "hidden" : "block"
                }`}
                muted
                playsInline
              />
              <div
                id={RECEIVE_CAMERA_READER_ID}
                className={cameraEngine === "html5" ? "block" : "hidden"}
              />
            </div>
            <input
              ref={scanCaptureInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              onChange={handleScanCapture}
              className="hidden"
            />

            <p className="mt-3 text-sm font-medium text-zinc-600">
              {cameraStatus}
            </p>

            <div className="mt-4">
              <button
                type="button"
                onClick={startCamera}
                className={`flex h-11 w-full items-center justify-center gap-2 rounded-lg px-3 text-sm font-bold transition ${
                  cameraEngine
                    ? "border border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100"
                    : "bg-zinc-950 text-white hover:bg-zinc-800"
                }`}
              >
                <ScanBarcode size={17} />
                {cameraEngine ? t("pos.stop") : t("pos.scan")}
              </button>
            </div>
          </section>

          <section className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-amber-100 text-amber-700">
                <Printer size={21} />
              </div>
              <div>
                <h2 className="text-lg font-bold text-zinc-950">
                  {t("pos.receive.barcode_labels")}
                </h2>
                <p className="text-sm text-zinc-500">
                  {t("pos.receive.barcode_labels_desc")}
                </p>
              </div>
            </div>

            <label className="mt-4 block text-sm font-bold text-zinc-700">
              {t("pos.receive.label_size")}
              <select
                value={labelSize}
                onChange={(event) =>
                  setLabelSize(event.target.value as LabelSize)
                }
                className="mt-2 h-11 w-full rounded-lg border border-zinc-200 bg-zinc-50 px-3 outline-none focus:border-emerald-400 focus:bg-white focus:ring-4 focus:ring-emerald-100"
              >
                {Object.entries(labelSizes).map(([value]) => (
                  <option key={value} value={value}>
                    {t("pos.receive.label_" + value)}
                  </option>
                ))}
              </select>
            </label>

            <button
              type="button"
              onClick={printLabels}
              className="mt-4 flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-emerald-600 px-3 text-sm font-bold text-white transition hover:bg-emerald-500"
            >
              <Printer size={17} />
              {t("pos.receive.print_labels", { n: formatNumber(labelsToPrint) })}
            </button>
          </section>

          <section className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-indigo-100 text-indigo-700">
                <PackagePlus size={21} />
              </div>
              <div>
                <h2 className="text-lg font-bold text-zinc-950">{t("pos.receive.batch")}</h2>
                <p className="text-sm text-zinc-500">{t("pos.receive.batch_desc")}</p>
              </div>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={saveBatch}
                className="flex h-11 items-center justify-center gap-2 rounded-lg bg-emerald-600 px-3 text-sm font-bold text-white transition hover:bg-emerald-500"
              >
                <ClipboardCheck size={17} />
                {t("pos.save")}
              </button>
              <button
                type="button"
                onClick={resetBatch}
                className="flex h-11 items-center justify-center gap-2 rounded-lg border border-zinc-200 px-3 text-sm font-bold text-zinc-700 transition hover:bg-zinc-50"
              >
                <RotateCcw size={17} />
                {t("pos.clear")}
              </button>
            </div>

            {lastReceivedTotal > 0 ? (
              <Link
                to="/products"
                className="mt-4 flex h-11 items-center justify-center rounded-lg border border-zinc-200 text-sm font-bold text-zinc-700 transition hover:bg-zinc-50"
              >
                {t("pos.receive.view_inventory")}
              </Link>
            ) : null}
          </section>
        </aside>
      </div>
      </>
      )}
    </main>
  )
}

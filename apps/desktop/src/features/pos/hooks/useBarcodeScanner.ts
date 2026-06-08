import { useEffect, useRef, useState } from "react"
import type { ChangeEvent } from "react"
import { normalizeBarcode } from "../lib/pos.constants"
import {
  createBarcodeDetector,
  createHtml5Qrcode,
  detectBarcodeFromImageFile,
  getCameraErrorMessage,
  getHtml5QrcodeFormatCodes,
  getLiveCameraIssue,
  getPreferredCameraConstraints,
  loadHtml5Qrcode,
  type Html5QrcodeInstance,
} from "../lib/cameraScanner"
import { findProductByBarcode } from "../services/product.service"
import type { Product } from "../types/product"

// Preload html5-qrcode library early for faster camera startup
if (typeof window !== "undefined") setTimeout(() => loadHtml5Qrcode().catch(() => {}), 200)

const POS_CAMERA_READER_ID = "lebanonpos-pos-camera-reader"

export { useBarcodeScanner }

function useBarcodeScanner(
  onScannedProduct: (product: Product, source: string) => void
) {
  const [scanCode, setScanCode] = useState("")
  const [scannerStatus, setScannerStatus] = useState("Scanner ready.")
  const [cameraActive, setCameraActive] = useState(false)
  const [cameraEngine, setCameraEngine] = useState<"native" | "html5" | null>(null)
  const scanInputRef = useRef<HTMLInputElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const scanCaptureInputRef = useRef<HTMLInputElement>(null)
  const scannerStreamRef = useRef<MediaStream | null>(null)
  const cameraFrameRef = useRef<number | null>(null)
  const html5ScannerRef = useRef<Html5QrcodeInstance | null>(null)
  const lastDetectedRef = useRef<{ code: string; at: number }>({ code: "", at: 0 })
  const isMountedRef = useRef(true)

  useEffect(() => {
    isMountedRef.current = true
    return () => {
      isMountedRef.current = false
      if (cameraFrameRef.current) window.cancelAnimationFrame(cameraFrameRef.current)
      scannerStreamRef.current?.getTracks().forEach((t) => t.stop())
      const s = html5ScannerRef.current
      html5ScannerRef.current = null
      if (s) { void s.stop().catch(() => {}).finally(() => s.clear()) }
    }
  }, [])

  function handleScannedBarcode(value: string) {
    const barcode = normalizeBarcode(value)
    if (!barcode) { setScannerStatus("Scan a barcode first."); return }
    const product = findProductByBarcode(barcode)
    if (!product) { setScannerStatus(`Barcode ${barcode} not found.`); return }
    onScannedProduct(product, "barcode")
    setScannerStatus(`${product.name} added.`)
    setScanCode("")
    scanInputRef.current?.focus()
  }

  async function startCameraScanner() {
    if (cameraActive) { stopCameraScanner(); return }

    if (!navigator.mediaDevices?.getUserMedia) {
      setScannerStatus("📷 Camera not available. Tap to capture barcode photo.")
      scanCaptureInputRef.current?.click()
      return
    }

    // Preload library
    loadHtml5Qrcode().catch(() => {})

    // Try Native BarcodeDetector first (fastest, works on Chrome/Android)
    setScannerStatus("Starting camera…")
    try {
      const detector = await createBarcodeDetector()
      if (!isMountedRef.current) return

      if (detector) {
        // Native detector available — use getUserMedia + frame scanning
        const stream = await navigator.mediaDevices.getUserMedia(getPreferredCameraConstraints())
        if (!isMountedRef.current) { stream.getTracks().forEach((t) => t.stop()); return }
        const video = videoRef.current
        if (!video) { stream.getTracks().forEach((t) => t.stop()); return }
        scannerStreamRef.current = stream
        video.srcObject = stream
        video.setAttribute("playsinline", "true")
        video.muted = true
        await video.play()
        if (!isMountedRef.current) { stream.getTracks().forEach((t) => t.stop()); return }
        setCameraEngine("native")
        setCameraActive(true)
        setScannerStatus("📱 Live scanner active — point at barcode")

        const scanFrame = async () => {
          if (!videoRef.current || !scannerStreamRef.current) return
          try {
            const codes = await detector.detect(videoRef.current)
            const code = codes[0]?.rawValue
            const now = Date.now()
            if (code && (lastDetectedRef.current.code !== code || now - lastDetectedRef.current.at > 1500)) {
              lastDetectedRef.current = { code, at: now }
              handleScannedBarcode(code)
            }
          } catch { /* warming up */ }
          cameraFrameRef.current = window.requestAnimationFrame(scanFrame)
        }
        cameraFrameRef.current = window.requestAnimationFrame(scanFrame)
        return
      }
    } catch (e) {
      stopCameraScanner()
      if (e instanceof DOMException && (e.name === "SecurityError" || e.name === "NotAllowedError")) {
        setScannerStatus("❌ Camera permission denied. Allow camera access in browser settings.")
        return
      }
      // Fall through to html5-qrcode
    }

    // No native detector — use html5-qrcode live scanner
    if (!isMountedRef.current) return
    setCameraActive(true)
    setCameraEngine("html5")
    setScannerStatus("Starting camera scanner…")
    await new Promise<void>((r) => window.requestAnimationFrame(() => r()))
    if (!isMountedRef.current) return

    const scanner = await createHtml5Qrcode(POS_CAMERA_READER_ID)
    if (!isMountedRef.current) return
    if (!scanner) {
      stopCameraScanner()
      setScannerStatus("❌ Camera scanner could not load. Try photo capture instead.")
      scanCaptureInputRef.current?.click()
      return
    }
    html5ScannerRef.current = scanner
    if (!isMountedRef.current) return

    try {
      await scanner.start(
        { facingMode: "environment" },
        { fps: 12, qrbox: { width: 260, height: 160 }, formatsToSupport: getHtml5QrcodeFormatCodes() },
        (decodedText) => {
          const now = Date.now()
          if (decodedText && (lastDetectedRef.current.code !== decodedText || now - lastDetectedRef.current.at > 1500)) {
            lastDetectedRef.current = { code: decodedText, at: now }
            handleScannedBarcode(decodedText)
          }
        }
      )
      setScannerStatus("📱 Live scanner active — point at barcode")
    } catch (e) {
      stopCameraScanner()
      if (e instanceof DOMException && (e.name === "SecurityError" || e.name === "NotAllowedError")) {
        setScannerStatus("❌ Live camera blocked. Tap to capture barcode photo instead.")
        scanCaptureInputRef.current?.click()
        return
      }
      setScannerStatus(`⚠️ ${getCameraErrorMessage(e)} — try photo capture`)
      scanCaptureInputRef.current?.click()
    }
  }

  async function handleScanCapture(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0]
    event.currentTarget.value = ""
    if (!file) return
    try {
      setScannerStatus("🔍 Scanning barcode from photo…")
      const barcode = await detectBarcodeFromImageFile(file)
      if (!barcode) {
        setScannerStatus("❌ No barcode detected. Center the barcode and try again.")
        return
      }
      handleScannedBarcode(barcode)
    } catch {
      setScannerStatus("❌ Could not scan photo. Try better lighting or move closer.")
    }
  }

  function stopCameraScanner() {
    if (cameraFrameRef.current) { window.cancelAnimationFrame(cameraFrameRef.current); cameraFrameRef.current = null }
    scannerStreamRef.current?.getTracks().forEach((t) => t.stop())
    scannerStreamRef.current = null
    const s = html5ScannerRef.current
    html5ScannerRef.current = null
    if (s) { void s.stop().catch(() => {}).finally(() => s.clear()) }
    if (videoRef.current) videoRef.current.srcObject = null
    setCameraEngine(null)
    setCameraActive(false)
  }

  return {
    scanInputRef, scanCode, setScanCode,
    scannerStatus, setScannerStatus,
    cameraActive, cameraEngine,
    startCameraScanner, handleScanCapture, handleScannedBarcode,
    videoRef, scanCaptureInputRef,
  }
}

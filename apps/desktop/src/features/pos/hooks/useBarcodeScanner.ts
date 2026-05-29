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
  type Html5QrcodeInstance,
} from "../lib/cameraScanner"
import { findProductByBarcode } from "../services/product.service"
import type { Product } from "../types/product"

const POS_CAMERA_READER_ID = "lebanonpos-pos-camera-reader"

export function useBarcodeScanner(
  onScannedProduct: (product: Product, source: string) => void
) {
  const scanInputRef = useRef<HTMLInputElement>(null)
  const [scanCode, setScanCode] = useState("")
  const [scannerStatus, setScannerStatus] = useState("Scanner ready.")
  const [cameraActive, setCameraActive] = useState(false)
  const [cameraEngine, setCameraEngine] = useState<"native" | "html5" | null>(null)

  const videoRef = useRef<HTMLVideoElement | null>(null)
  const scanCaptureInputRef = useRef<HTMLInputElement | null>(null)
  const scannerStreamRef = useRef<MediaStream | null>(null)
  const html5ScannerRef = useRef<Html5QrcodeInstance | null>(null)
  const cameraFrameRef = useRef<number | null>(null)
  const lastDetectedRef = useRef({ code: "", at: 0 })

  useEffect(() => {
    return () => {
      if (cameraFrameRef.current) {
        window.cancelAnimationFrame(cameraFrameRef.current)
      }
      scannerStreamRef.current?.getTracks().forEach((track) => track.stop())
      const scanner = html5ScannerRef.current
      html5ScannerRef.current = null
      if (scanner) {
        void scanner.stop().catch(() => undefined).finally(() => scanner.clear())
      }
    }
  }, [])

  function handleScannedBarcode(value: string) {
    const barcode = normalizeBarcode(value)
    if (!barcode) {
      setScannerStatus("Scan a barcode first.")
      return
    }
    const product = findProductByBarcode(barcode)
    if (!product) {
      setScannerStatus(`Barcode ${barcode} was not found.`)
      return
    }
    onScannedProduct(product, "barcode")
  }

  async function startCameraScanner() {
    if (cameraActive) {
      stopCameraScanner()
      return
    }

    const liveCameraIssue = getLiveCameraIssue()
    if (liveCameraIssue) {
      setScannerStatus("📷 Point camera at barcode, then take a photo.")
      scanCaptureInputRef.current?.click()
      return
    }

    try {
      const detector = await createBarcodeDetector()
      if (!detector) {
        setCameraActive(true)
        setCameraEngine("html5")
        setScannerStatus("Starting bundled camera scanner...")
        await new Promise<void>((resolve) =>
          window.requestAnimationFrame(() => resolve())
        )
        const scanner = await createHtml5Qrcode(POS_CAMERA_READER_ID)
        if (!scanner) {
          stopCameraScanner()
          setScannerStatus(
            "Camera scanner engine could not load. Use USB scan or manual entry."
          )
          return
        }
        html5ScannerRef.current = scanner
        await scanner.start(
          { facingMode: "environment" },
          {
            fps: 12,
            qrbox: { width: 260, height: 160 },
            formatsToSupport: getHtml5QrcodeFormatCodes(),
          },
          (decodedText) => {
            const now = Date.now()
            if (
              decodedText &&
              (lastDetectedRef.current.code !== decodedText ||
                now - lastDetectedRef.current.at > 1500)
            ) {
              lastDetectedRef.current = { code: decodedText, at: now }
              handleScannedBarcode(decodedText)
            }
          }
        )
        setScannerStatus("Camera scanner active. Point at a barcode.")
        return
      }

      const stream = await navigator.mediaDevices.getUserMedia(
        getPreferredCameraConstraints()
      )
      const video = videoRef.current
      if (!video) {
        stream.getTracks().forEach((track) => track.stop())
        setScannerStatus("Camera preview is not ready.")
        return
      }
      scannerStreamRef.current = stream
      video.srcObject = stream
      video.setAttribute("playsinline", "true")
      video.muted = true
      await video.play()
      setCameraEngine("native")
      setCameraActive(true)
      setScannerStatus("Camera scanner active. Point at a barcode.")

      const scanFrame = async () => {
        const currentVideo = videoRef.current
        if (!currentVideo || !scannerStreamRef.current) return
        try {
          const codes = await detector.detect(currentVideo)
          const code = codes[0]?.rawValue
          const now = Date.now()
          if (
            code &&
            (lastDetectedRef.current.code !== code ||
              now - lastDetectedRef.current.at > 1500)
          ) {
            lastDetectedRef.current = { code, at: now }
            handleScannedBarcode(code)
          }
        } catch {
          // Some browsers throw while the video frame is still warming up.
        }
        cameraFrameRef.current = window.requestAnimationFrame(scanFrame)
      }
      cameraFrameRef.current = window.requestAnimationFrame(scanFrame)
    } catch (error) {
      stopCameraScanner()
      const isSecurityError =
        error instanceof DOMException &&
        (error.name === "SecurityError" || error.name === "NotAllowedError")
      if (isSecurityError) {
        setScannerStatus(
          "📷 Live camera needs HTTPS. Point camera at barcode and take a photo."
        )
        scanCaptureInputRef.current?.click()
      } else {
        setScannerStatus(
          `${getCameraErrorMessage(error)} Try USB scan or photo capture.`
        )
      }
    }
  }

  async function handleScanCapture(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0]
    event.currentTarget.value = ""
    if (!file) return
    try {
      setScannerStatus("🔍 Reading barcode from photo…")
      const barcode = await detectBarcodeFromImageFile(file)
      if (!barcode) {
        setScannerStatus(
          "❌ No barcode found. Hold phone steady, get closer, ensure good lighting, then tap Scan again."
        )
        return
      }
      handleScannedBarcode(barcode)
    } catch {
      setScannerStatus("❌ Could not read image. Try again with better lighting.")
    }
  }

  function stopCameraScanner() {
    if (cameraFrameRef.current) {
      window.cancelAnimationFrame(cameraFrameRef.current)
      cameraFrameRef.current = null
    }
    scannerStreamRef.current?.getTracks().forEach((track) => track.stop())
    scannerStreamRef.current = null
    const scanner = html5ScannerRef.current
    html5ScannerRef.current = null
    if (scanner) {
      void scanner.stop().catch(() => undefined).finally(() => scanner.clear())
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null
    }
    setCameraEngine(null)
    setCameraActive(false)
    setScannerStatus("Camera scanner stopped.")
  }

  return {
    scanInputRef,
    scanCode,
    setScanCode,
    scannerStatus,
    setScannerStatus,
    cameraActive,
    cameraEngine,
    startCameraScanner,
    handleScanCapture,
    handleScannedBarcode,
    videoRef,
    scanCaptureInputRef,
  }
}

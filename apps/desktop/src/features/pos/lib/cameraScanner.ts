export type BarcodeDetectionSource =
  | HTMLVideoElement
  | HTMLImageElement
  | HTMLCanvasElement
  | ImageBitmap

export type BrowserBarcodeDetector = {
  detect: (
    source: BarcodeDetectionSource
  ) => Promise<Array<{ rawValue: string }>>
}

type BarcodeDetectorConstructor = {
  new (options?: { formats?: string[] }): BrowserBarcodeDetector
  getSupportedFormats?: () => Promise<string[]>
}

export type Html5QrcodeInstance = {
  start: (
    cameraConfig: string | MediaTrackConstraints,
    configuration: {
      fps?: number
      qrbox?: number | { width: number; height: number }
      aspectRatio?: number
      disableFlip?: boolean
      formatsToSupport?: number[]
      videoConstraints?: MediaTrackConstraints
    },
    successCallback: (decodedText: string) => void,
    errorCallback?: () => void
  ) => Promise<void>
  stop: () => Promise<void>
  clear: () => void
  scanFile: (file: File, showImage?: boolean) => Promise<string>
}

type Html5QrcodeConstructor = {
  new (elementId: string, verbose?: boolean): Html5QrcodeInstance
}

declare global {
  interface Window {
    BarcodeDetector?: BarcodeDetectorConstructor
    Html5Qrcode?: Html5QrcodeConstructor
    Html5QrcodeSupportedFormats?: Record<string, number>
  }
}

export const barcodeFormats = [
  "aztec",
  "code_128",
  "code_39",
  "code_93",
  "codabar",
  "data_matrix",
  "ean_13",
  "ean_8",
  "itf",
  "pdf417",
  "qr_code",
  "upc_a",
  "upc_e",
]

const html5QrcodeScriptPath = "/vendor/html5-qrcode.min.js"
let html5QrcodeLoadPromise: Promise<void> | null = null

function isLocalHostname(hostname: string) {
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "::1" ||
    hostname.endsWith(".localhost")
  )
}

function getDetectorConstructor() {
  if (typeof window === "undefined") {
    return undefined
  }

  return window.BarcodeDetector
}

export function getLiveCameraIssue() {
  if (typeof window === "undefined" || typeof navigator === "undefined") {
    return "Camera is not available during server rendering."
  }

  if (!navigator.mediaDevices?.getUserMedia) {
    // No getUserMedia at all — must use file capture
    return "Live camera is not available in this browser. Use scanner capture or another browser."
  }

  // Note: we no longer block on HTTP. Many Android browsers allow getUserMedia
  // over local HTTP. If it fails, the caller catches the error and falls back.
  return ""
}

export function getBarcodeDetectorIssue() {
  return getDetectorConstructor()
    ? ""
    : "Native barcode detection is not available here. Trying the bundled scanner engine."
}

export function getHtml5QrcodeFormatCodes() {
  const formats = window.Html5QrcodeSupportedFormats

  if (!formats) {
    return undefined
  }

  return [
    "QR_CODE",
    "AZTEC",
    "CODABAR",
    "CODE_39",
    "CODE_93",
    "CODE_128",
    "DATA_MATRIX",
    "EAN_13",
    "EAN_8",
    "ITF",
    "PDF_417",
    "UPC_A",
    "UPC_E",
  ]
    .map((key) => formats[key])
    .filter((value): value is number => typeof value === "number")
}

export function getPreferredCameraConstraints(): MediaStreamConstraints {
  return {
    audio: false,
    video: {
      facingMode: {
        ideal: "environment",
      },
      width: {
        ideal: 1280,
      },
      height: {
        ideal: 720,
      },
    },
  }
}

export function getCameraErrorMessage(error: unknown) {
  if (error instanceof DOMException) {
    if (error.name === "NotAllowedError" || error.name === "SecurityError") {
      return "Camera permission was blocked."
    }

    if (error.name === "NotFoundError" || error.name === "DevicesNotFoundError") {
      return "No camera was found on this device."
    }

    if (error.name === "NotReadableError" || error.name === "TrackStartError") {
      return "The camera is already in use by another app."
    }

    if (error.name === "OverconstrainedError") {
      return "This camera does not match the requested settings."
    }
  }

  return "Camera could not start."
}

export async function createBarcodeDetector() {
  const Detector = getDetectorConstructor()

  if (!Detector) {
    return null
  }

  let formats = barcodeFormats

  if (Detector.getSupportedFormats) {
    try {
      const supportedFormats = await Detector.getSupportedFormats()
      const filteredFormats = barcodeFormats.filter((format) =>
        supportedFormats.includes(format)
      )

      if (filteredFormats.length > 0) {
        formats = filteredFormats
      }
    } catch {
      formats = barcodeFormats
    }
  }

  try {
    return new Detector({ formats })
  } catch {
    return new Detector()
  }
}

export async function loadHtml5Qrcode() {
  if (typeof window === "undefined") {
    return false
  }

  if (window.Html5Qrcode) {
    return true
  }

  if (!html5QrcodeLoadPromise) {
    html5QrcodeLoadPromise = new Promise((resolve, reject) => {
      const existingScript = document.querySelector<HTMLScriptElement>(
        `script[src="${html5QrcodeScriptPath}"]`
      )

      if (existingScript) {
        existingScript.addEventListener("load", () => resolve(), {
          once: true,
        })
        existingScript.addEventListener("error", () => reject(), {
          once: true,
        })
        return
      }

      const script = document.createElement("script")

      script.src = html5QrcodeScriptPath
      script.async = true
      script.onload = () => resolve()
      script.onerror = () => reject()
      document.head.appendChild(script)
    })
  }

  try {
    await html5QrcodeLoadPromise

    return Boolean(window.Html5Qrcode)
  } catch {
    return false
  }
}

export async function createHtml5Qrcode(elementId: string) {
  const loaded = await loadHtml5Qrcode()

  if (!loaded || !window.Html5Qrcode) {
    return null
  }

  return new window.Html5Qrcode(elementId, false)
}

function loadImageFromFile(file: File) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image()
    const objectUrl = URL.createObjectURL(file)

    image.onload = () => {
      URL.revokeObjectURL(objectUrl)
      resolve(image)
    }
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl)
      reject(new Error("Image could not be loaded."))
    }
    image.src = objectUrl
  })
}

export async function detectBarcodeFromImageFile(file: File) {
  const detector = await createBarcodeDetector()

  if (!detector) {
    return detectBarcodeFromImageFileWithHtml5(file)
  }

  try {
    if ("createImageBitmap" in window) {
      const bitmap = await createImageBitmap(file)

      try {
        const results = await detector.detect(bitmap)
        const barcode = results[0]?.rawValue ?? ""

        if (barcode) {
          return barcode
        }
      } finally {
        bitmap.close()
      }
    }

    const image = await loadImageFromFile(file)
    const results = await detector.detect(image)
    const barcode = results[0]?.rawValue ?? ""

    if (barcode) {
      return barcode
    }
  } catch {
    return detectBarcodeFromImageFileWithHtml5(file)
  }

  return detectBarcodeFromImageFileWithHtml5(file)
}

async function detectBarcodeFromImageFileWithHtml5(file: File) {
  const loaded = await loadHtml5Qrcode()

  if (!loaded || !window.Html5Qrcode) {
    return ""
  }

  const scannerElementId = "lebanonpos-photo-barcode-reader"
  let scannerElement = document.getElementById(scannerElementId)

  if (!scannerElement) {
    scannerElement = document.createElement("div")
    scannerElement.id = scannerElementId
    scannerElement.style.position = "fixed"
    scannerElement.style.left = "-10000px"
    scannerElement.style.top = "0"
    scannerElement.style.width = "320px"
    scannerElement.style.height = "240px"
    document.body.appendChild(scannerElement)
  }

  const scanner = new window.Html5Qrcode(scannerElementId, false)

  try {
    return await scanner.scanFile(file, false)
  } catch {
    return ""
  } finally {
    scanner.clear()
  }
}

// POS-PRODUCT-IMAGE-1: shared product-image capture. Extracted verbatim from
// ProductSetupForm so create/receive can reuse identical compression. A picked
// image file is downscaled to fit MAX×MAX and returned as a JPEG data URL —
// small enough to store on the Product row and sync inline (no upload/server
// round-trip, works offline). Images are always optional.

const MAX_DIMENSION = 300
const JPEG_QUALITY = 0.8

/**
 * Read an image File and return a compressed JPEG data URL (max 300×300, q0.8).
 * Rejects if the file can't be read/decoded. Never throws synchronously.
 */
export function fileToCompressedDataUrl(
  file: File,
  max: number = MAX_DIMENSION,
  quality: number = JPEG_QUALITY
): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error("Could not read image file"))
    reader.onload = (e) => {
      const dataUrl = e.target?.result as string
      const img = new Image()
      img.onerror = () => reject(new Error("Could not decode image"))
      img.onload = () => {
        const scale = Math.min(max / img.width, max / img.height, 1)
        const canvas = document.createElement("canvas")
        canvas.width = Math.round(img.width * scale)
        canvas.height = Math.round(img.height * scale)
        const ctx = canvas.getContext("2d")
        if (!ctx) {
          // No canvas support (e.g. headless) — fall back to the original data URL.
          resolve(dataUrl)
          return
        }
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
        resolve(canvas.toDataURL("image/jpeg", quality))
      }
      img.src = dataUrl
    }
    reader.readAsDataURL(file)
  })
}

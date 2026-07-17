import { getApiUrl, getAuthToken } from "./sync.service"
import type { Product } from "../types/product"

// POS-CATALOG-IMAGE-BATCH-1: fill missing product images fast. The server's
// /api/images/generate does the source-priority work (barcode catalog → AI →
// placeholder) in Node — no browser CORS/canvas — and returns a data URL. The
// client saves it locally by LOCAL product id (avoids hub/local id mismatch and
// syncs the image via the normal product.update op). Products that already have
// an image are never touched.

export type GeneratedImage = { image: string; source?: string }

/** Ask the server to produce an image for a product's name/category/barcode.
 *  Returns null when the request fails (network/route error). Throws only when
 *  the app isn't connected to a server yet. */
export async function generateImageViaApi(
  p: { name: string; category?: string; barcode?: string | null }
): Promise<GeneratedImage | null> {
  const apiUrl = getApiUrl()
  const token = getAuthToken()
  if (!apiUrl || !token) throw new Error("Connect to the server first (Settings → Devices & Sync).")
  const res = await fetch(`${apiUrl}/api/images/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ name: p.name, category: p.category, barcode: p.barcode ?? undefined }),
  })
  if (!res.ok) return null
  const data = await res.json().catch(() => null)
  return data?.image ? { image: data.image as string, source: data.source } : null
}

export type ImageBatchDeps = {
  /** produce an image for a product (injected for testability) */
  generate: (p: Product) => Promise<GeneratedImage | null>
  /** persist the image locally (e.g. updateProduct(id, { image })) */
  save: (id: number, image: string) => void
  onProgress?: (done: number, total: number) => void
  shouldStop?: () => boolean
}

export type ImageBatchResult = {
  total: number
  generated: number
  failed: number
  failures: Array<{ id: number; name: string }>
}

/** Generate images only for products that lack one (never overwrites an
 *  existing image). A per-product failure is recorded and does NOT stop the
 *  rest of the batch. */
export async function completeMissingImages(products: Product[], deps: ImageBatchDeps): Promise<ImageBatchResult> {
  const targets = products.filter((p) => !p.archived && !p.image)
  const result: ImageBatchResult = { total: targets.length, generated: 0, failed: 0, failures: [] }
  let done = 0
  for (const p of targets) {
    if (deps.shouldStop?.()) break
    try {
      const gen = await deps.generate(p)
      if (gen?.image) {
        deps.save(p.id, gen.image)
        result.generated++
      } else {
        result.failed++
        result.failures.push({ id: p.id, name: p.name })
      }
    } catch {
      result.failed++
      result.failures.push({ id: p.id, name: p.name })
    }
    done++
    deps.onProgress?.(done, targets.length)
  }
  return result
}

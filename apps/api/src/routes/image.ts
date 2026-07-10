import { Router } from "express"
import type { ServerResponse } from "node:http"
import https from "node:https"
import prisma from "../lib/prisma.js"
import { requireAuth, json, type AuthRequest } from "../middleware/auth.js"

const router = Router()

// Pollinations.ai — free image generation (Flux). No monthly credit limit, unlike
// Hugging Face's metered "Inference Providers" which this replaced. Anonymous access
// works but shares a small, easily-congested global queue; a free token from
// auth.pollinations.ai moves requests onto a much less contended tier and drops
// the forced watermark.
const IMG_HOST = "image.pollinations.ai"
const IMG_MODEL = process.env.POLLINATIONS_MODEL || "flux"
const IMG_SIZE = 640
const POLLINATIONS_TOKEN = (process.env.POLLINATIONS_TOKEN || "").trim()

// MyMemory — free, keyless translation. Product names typed in Arabic (or other
// non-Latin scripts) confuse the image model, which was trained mostly on Latin-script
// text — translate to English first so the model has something it understands.
const TRANSLATE_HOST = "api.mymemory.translated.net"

function generatePlaceholderSvg(productName: string): string {
  const encodedName = productName.replace(/[<>&"']/g, "").trim() || "Product"
  const hue = (productName.length * 31 + productName.charCodeAt(0) * 7) % 360
  const r = 150 + 80 * Math.sin(hue * Math.PI / 180)
  const g = 150 + 80 * Math.sin((hue + 120) * Math.PI / 180)
  const b = 150 + 80 * Math.sin((hue + 240) * Math.PI / 180)
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400" viewBox="0 0 400 400">
    <rect width="400" height="400" fill="rgb(${r|0},${g|0},${b|0})"/>
    <circle cx="200" cy="170" r="60" fill="rgba(255,255,255,0.15)"/>
    <text x="200" y="290" text-anchor="middle" fill="#fff" font-family="sans-serif" font-size="20" font-weight="bold">${encodedName}</text>
  </svg>`
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`
}

function httpGetBuffer(hostname: string, path: string, timeoutMs: number, headers: Record<string, string> = {}): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname,
      port: 443,
      path,
      method: "GET",
      headers: { "User-Agent": "lebanonpos/1.0", ...headers },
      timeout: timeoutMs,
    }, (res) => {
      const chunks: Buffer[] = []
      res.on("data", (c: Buffer) => chunks.push(c))
      res.on("end", () => {
        const buf = Buffer.concat(chunks)
        if (res.statusCode && res.statusCode >= 400) {
          reject(new Error(`${res.statusCode}: ${buf.toString("utf8").substring(0, 200)}`))
          return
        }
        resolve(buf)
      })
    })
    req.on("error", reject)
    req.on("timeout", () => { req.destroy(); reject(new Error("timeout")) })
    req.end()
  })
}

// Most product names on a Lebanese POS are Arabic or French. French is Latin-script
// and the model handles it fine; Arabic (or other non-Latin script) needs translating
// first or the model generates something unrelated to the product.
function isLatinScript(text: string): boolean {
  const arabicChars = text.match(/[؀-ۿݐ-ݿ]/g) || []
  return arabicChars.length < text.length * 0.3
}

async function translateToEnglish(text: string): Promise<string | null> {
  try {
    const path = `/get?q=${encodeURIComponent(text)}&langpair=ar%7Cen`
    const buffer = await httpGetBuffer(TRANSLATE_HOST, path, 8000)
    const data = JSON.parse(buffer.toString("utf8"))
    const translated = data?.responseData?.translatedText?.trim()
    return translated && translated.toLowerCase() !== text.toLowerCase() ? translated : null
  } catch (err) {
    console.error(`[images] translate error for "${text}":`, (err as Error).message)
    return null
  }
}

function buildPrompt(productName: string, category?: string | null): string {
  const subject = category ? `${productName}, category: ${category}` : productName
  return `Professional e-commerce product photo of ${subject}, centered, isolated on a pure white background, soft studio lighting, photorealistic, high detail, no text, no logo, no watermark`
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function fetchGeneratedImage(prompt: string): Promise<Buffer> {
  const seed = Math.floor(Math.random() * 1_000_000)
  const path = `/prompt/${encodeURIComponent(prompt)}?width=${IMG_SIZE}&height=${IMG_SIZE}&model=${IMG_MODEL}&nologo=true&private=true&seed=${seed}`
  const headers: Record<string, string> = POLLINATIONS_TOKEN ? { Authorization: `Bearer ${POLLINATIONS_TOKEN}` } : {}
  return httpGetBuffer(IMG_HOST, path, 30000, headers)
}

// The anonymous tier shares a small global queue that occasionally reports "queue
// full" under load — a short backoff before retrying gives it time to drain instead
// of immediately re-hitting the same congestion.
async function generateImage(productName: string, category?: string | null): Promise<{ image: string; generated: boolean }> {
  const promptSubject = isLatinScript(productName)
    ? productName
    : (await translateToEnglish(productName)) || productName
  const prompt = buildPrompt(promptSubject, category)

  const maxAttempts = 3
  const retryDelayMs = Number(process.env.IMAGE_RETRY_DELAY_MS ?? 4000)
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const buffer = await fetchGeneratedImage(prompt)
      const base64 = buffer.toString("base64")
      return { image: `data:image/jpeg;base64,${base64}`, generated: true }
    } catch (err) {
      console.error(`[images] generation error for "${productName}" (attempt ${attempt}/${maxAttempts}):`, (err as Error).message)
      if (attempt < maxAttempts) await sleep(retryDelayMs * attempt)
    }
  }
  return { image: generatePlaceholderSvg(productName), generated: false }
}

// Save a client-generated image for a single product
router.post("/save", requireAuth, async (req: AuthRequest, res: ServerResponse) => {
  try {
    const { productId, image } = (req as any).body ?? {}
    if (!productId || typeof image !== "string") {
      json(res, { error: "productId (number) and image (string) required" }, 400)
      return
    }
    const tenantId = req.auth!.tenantId
    const product = await prisma.product.findFirst({ where: { id: productId, tenantId } })
    if (!product) {
      json(res, { error: "Product not found" }, 404)
      return
    }
    await prisma.product.update({ where: { id: productId }, data: { image } })
    json(res, { ok: true })
  } catch (err) {
    console.error("Save image error:", err)
    json(res, { error: "Failed to save image" }, 500)
  }
})

// Save client-generated images for multiple products at once
router.post("/save-all", requireAuth, async (req: AuthRequest, res: ServerResponse) => {
  try {
    const { products } = (req as any).body ?? {}
    if (!Array.isArray(products)) {
      json(res, { error: "products array required" }, 400)
      return
    }
    const tenantId = req.auth!.tenantId
    let saved = 0
    for (const { productId, image } of products) {
      if (!productId || typeof image !== "string") continue
      const product = await prisma.product.findFirst({ where: { id: productId, tenantId } })
      if (product) {
        await prisma.product.update({ where: { id: productId }, data: { image } })
        saved++
      }
    }
    json(res, { saved, total: products.length })
  } catch (err) {
    console.error("Save all images error:", err)
    json(res, { error: "Failed to save images" }, 500)
  }
})

router.post("/generate", requireAuth, async (req: AuthRequest, res: ServerResponse) => {
  try {
    const { name, category } = (req as any).body ?? {}
    if (!name || typeof name !== "string") {
      json(res, { error: "Product name is required" }, 400)
      return
    }
    const result = await generateImage(name, typeof category === "string" ? category : null)
    json(res, result)
  } catch (err) {
    console.error("Generate image error:", err)
    json(res, { error: "Image generation failed" }, 500)
  }
})

router.post("/generate-product/:id", requireAuth, async (req: AuthRequest, res: ServerResponse) => {
  try {
    const productId = Number(req.params?.id)
    const tenantId = req.auth!.tenantId
    const product = await prisma.product.findFirst({
      where: { id: productId, tenantId },
      select: { id: true, name: true, category: true },
    })
    if (!product) {
      json(res, { error: "Product not found" }, 404)
      return
    }
    const { image, generated } = await generateImage(product.name, product.category)
    await prisma.product.update({ where: { id: product.id }, data: { image } })
    json(res, { image, generated })
  } catch (err) {
    console.error("Generate product image error:", err)
    json(res, { error: "Failed to generate product image" }, 500)
  }
})

router.post("/generate-all", requireAuth, async (req: AuthRequest, res: ServerResponse) => {
  try {
    const body = (req as any).body ?? {}
    // Admin JWT has empty tenantId — fall back to body parameter
    const tenantId = (body.tenantId as string) || req.auth!.tenantId
    const force = body.force === true

    if (!tenantId) {
      json(res, { error: "tenantId is required — pass in request body for admin users" }, 400)
      return
    }

    const where: Record<string, unknown> = { tenantId, isParent: false }
    if (!force) where.image = null

    const products = await prisma.product.findMany({
      where,
      select: { id: true, name: true, category: true },
      orderBy: { name: "asc" },
    })

    if (products.length === 0) {
      json(res, { generated: 0, placeholders: 0, total: 0, products: [] })
      return
    }

    type Result = { id: number; name: string; generated: boolean; placeholder: boolean; image?: string; error?: string }
    const results: Result[] = []

    for (const product of products) {
      try {
        const { image, generated } = await generateImage(product.name, product.category)
        await prisma.product.update({ where: { id: product.id }, data: { image } })
        results.push({ id: product.id, name: product.name, image, generated, placeholder: !generated })
      } catch (err) {
        results.push({ id: product.id, name: product.name, generated: false, placeholder: false, error: (err as Error).message })
      }
    }

    const generatedCount = results.filter(r => r.generated).length
    const placeholderCount = results.filter(r => r.placeholder).length
    const errorCount = results.filter(r => r.error).length
    console.log(`[images] generate-all: ${generatedCount} AI, ${placeholderCount} placeholders, ${errorCount} errors (${products.length} total)`)
    json(res, { generated: generatedCount, placeholders: placeholderCount, total: products.length, products: results })
  } catch (err) {
    console.error("Generate all images error:", err)
    json(res, { error: "Failed to generate images" }, 500)
  }
})

// Serve product image as raw binary (JWT required — use /api/delivery/public/image/:id for public access)
router.get("/serve/:id", requireAuth, async (req: AuthRequest, res: ServerResponse) => {
  try {
    const productId = Number((req as any).params?.id)
    if (isNaN(productId)) {
      res.writeHead(400, { "Content-Type": "application/json" })
      res.end(JSON.stringify({ error: "Invalid product ID" }))
      return
    }

    const product = await prisma.product.findFirst({
      where: { id: productId, tenantId: req.auth!.tenantId },
      select: { image: true },
    })

    if (!product?.image) {
      res.writeHead(404, { "Content-Type": "application/json" })
      res.end(JSON.stringify({ error: "No image found" }))
      return
    }

    const match = product.image.match(/^data:(image\/[\w+-]+);base64,(.+)$/)
    if (!match) {
      res.writeHead(500, { "Content-Type": "application/json" })
      res.end(JSON.stringify({ error: "Invalid image data" }))
      return
    }

    const mime = match[1]
    const buffer = Buffer.from(match[2], "base64")
    res.writeHead(200, {
      "Content-Type": mime,
      "Content-Length": buffer.length.toString(),
      "Cache-Control": "public, max-age=0, must-revalidate",
    })
    res.end(buffer)
  } catch (err) {
    console.error("Serve image error:", err)
    res.writeHead(500, { "Content-Type": "application/json" })
    res.end(JSON.stringify({ error: "Failed to serve image" }))
  }
})

// Debug: show product image status
router.get("/debug", requireAuth, async (req: AuthRequest, res: ServerResponse) => {
  try {
    const tenantId = req.auth!.tenantId
    const products = await prisma.product.findMany({
      where: { tenantId, isParent: false },
      select: { id: true, name: true, image: true },
      take: 5,
      orderBy: { name: "asc" },
    })
    const info = products.map(p => ({
      id: p.id,
      name: p.name,
      hasImage: p.image !== null,
      imageLength: p.image?.length ?? 0,
    }))
    json(res, info)
  } catch (err) {
    console.error("Image debug error:", err)
    json(res, { error: "Failed to load debug info" }, 500)
  }
})

export default router

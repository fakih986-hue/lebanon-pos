import { Router } from "express"
import type { IncomingMessage, ServerResponse } from "node:http"
import https from "node:https"
import dns from "node:dns"
import prisma from "../lib/prisma.js"
import { requireAuth, json, type AuthRequest } from "../middleware/auth.js"

const router = Router()

const HF_TOKEN = process.env.HUGGINGFACE_TOKEN || ""
const HF_MODEL = process.env.HF_IMAGE_MODEL || "stabilityai/stable-diffusion-xl-base-1.0"

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

async function generateImage(productName: string): Promise<{ image: string; generated: boolean }> {
  if (!HF_TOKEN) {
    return { image: generatePlaceholderSvg(productName), generated: false }
  }

  try {
    const prompt = `Professional product photo of ${productName}, white background, studio lighting, high quality, e-commerce`
    const body = JSON.stringify({ inputs: prompt })
    const buffer = await new Promise<Buffer>((resolve, reject) => {
      // Use public DNS to bypass Railway container DNS issues
      dns.setServers(["8.8.8.8", "1.1.1.1"])
      dns.resolve4("api-inference.huggingface.co", (dnsErr, ips) => {
        if (dnsErr) {
          // Fallback: try with hostname directly (might work with cached DNS)
          const req = https.request(`https://api-inference.huggingface.co/models/${HF_MODEL}`, {
            method: "POST",
            headers: {
              "Authorization": `Bearer ${HF_TOKEN}`,
              "Content-Type": "application/json",
              "Content-Length": Buffer.byteLength(body).toString(),
              "User-Agent": "lebanonpos/1.0",
            },
            timeout: 30000,
          }, (res) => {
            const chunks: Buffer[] = []
            res.on("data", (c: Buffer) => chunks.push(c))
            res.on("end", () => {
              const buf = Buffer.concat(chunks)
              if (res.statusCode && res.statusCode >= 400) {
                const errText = buf.toString("utf8").substring(0, 200)
                console.error(`[images] HF API error ${res.statusCode} for "${productName}": ${errText}`)
                reject(new Error(`HTTP ${res.statusCode}`))
                return
              }
              resolve(buf)
            })
          })
          req.on("error", (e) => reject(e))
          req.on("timeout", () => { req.destroy(); reject(new Error("timeout")) })
          req.write(body)
          req.end()
          return
        }
        const host = ips[0]
        const opts = {
          hostname: host,
          port: 443,
          path: `/models/${HF_MODEL}`,
          method: "POST",
          headers: {
            "Authorization": `Bearer ${HF_TOKEN}`,
            "Content-Type": "application/json",
            "Content-Length": Buffer.byteLength(body).toString(),
            "User-Agent": "lebanonpos/1.0",
            "Host": "api-inference.huggingface.co",
          },
          timeout: 30000,
        }
        const req = https.request(opts, (res) => {
          const chunks: Buffer[] = []
          res.on("data", (c: Buffer) => chunks.push(c))
          res.on("end", () => {
            const buf = Buffer.concat(chunks)
            if (res.statusCode && res.statusCode >= 400) {
              const errText = buf.toString("utf8").substring(0, 200)
              console.error(`[images] HF API error ${res.statusCode} for "${productName}": ${errText}`)
              reject(new Error(`HTTP ${res.statusCode}`))
              return
            }
            resolve(buf)
          })
        })
        req.on("error", (e) => reject(e))
        req.on("timeout", () => { req.destroy(); reject(new Error("timeout")) })
        req.write(body)
        req.end()
      })
    })
    const base64 = buffer.toString("base64")
    return { image: `data:image/jpeg;base64,${base64}`, generated: true }
  } catch (err) {
    console.error(`[images] HF exception for "${productName}":`, (err as Error).message)
    return { image: generatePlaceholderSvg(productName), generated: false }
  }
}

router.post("/generate", async (req: IncomingMessage, res: ServerResponse) => {
  const { name } = (req as any).body ?? {}

  if (!name || typeof name !== "string") {
    json(res, { error: "Product name is required" }, 400)
    return
  }

  const result = await generateImage(name)
  json(res, result)
})

router.post("/generate-product/:id", requireAuth, async (req: AuthRequest, res: ServerResponse) => {
  try {
    const productId = Number(req.params?.id)
    const tenantId = req.auth!.tenantId

    const product = await prisma.product.findFirst({
      where: { id: productId, tenantId },
      select: { id: true, name: true },
    })

    if (!product) {
      json(res, { error: "Product not found" }, 404)
      return
    }

    const { image, generated } = await generateImage(product.name)

    await prisma.product.update({
      where: { id: product.id },
      data: { image },
    })

    json(res, { image, generated })
  } catch (err) {
    console.error("Generate product image error:", err)
    json(res, { error: "Failed to generate product image" }, 500)
  }
})

router.post("/generate-all", requireAuth, async (req: AuthRequest, res: ServerResponse) => {
  try {
    const tenantId = req.auth!.tenantId
    const body = (req as any).body ?? {}
    const force = body.force === true

    const where: Record<string, unknown> = { tenantId, isParent: false }
    if (!force) where.image = null

    const products = await prisma.product.findMany({
      where,
      select: { id: true, name: true },
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
        const { image, generated } = await generateImage(product.name)
        await prisma.product.update({
          where: { id: product.id },
          data: { image },
        })
        results.push({ id: product.id, name: product.name, image, generated, placeholder: !generated })
      } catch (err) {
        results.push({ id: product.id, name: product.name, generated: false, placeholder: false, error: (err as Error).message })
      }
    }

    const generatedCount = results.filter(r => r.generated).length
    const placeholderCount = results.filter(r => r.placeholder).length
    const errorCount = results.filter(r => r.error).length
    console.log(`[images] generate-all: ${generatedCount} AI, ${placeholderCount} placeholders, ${errorCount} errors (${products.length} total)`)
    json(res, { generated: generatedCount, placeholders: placeholderCount, total: products.length, tokenMissing: !HF_TOKEN, products: results })
  } catch (err) {
    console.error("Generate all images error:", err)
    json(res, { error: "Failed to generate images" }, 500)
  }
})

// Serve product image as raw binary (no auth — public for ordering app)
router.get("/serve/:id", async (req: IncomingMessage, res: ServerResponse) => {
  try {
    const productId = Number((req as any).params?.id)
    if (isNaN(productId)) {
      res.writeHead(400, { "Content-Type": "application/json" })
      res.end(JSON.stringify({ error: "Invalid product ID" }))
      return
    }

    const product = await prisma.product.findUnique({
      where: { id: productId },
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
      "Cache-Control": "public, max-age=31536000, immutable",
    })
    res.end(buffer)
  } catch (err) {
    console.error("Serve image error:", err)
    res.writeHead(500, { "Content-Type": "application/json" })
    res.end(JSON.stringify({ error: "Failed to serve image" }))
  }
})

// Debug: show first product's image status
router.get("/debug", requireAuth, async (req: AuthRequest, res: ServerResponse) => {
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
    imageStartsWith: p.image ? p.image.substring(0, 50) : null,
  }))
  json(res, info)
})

export default router

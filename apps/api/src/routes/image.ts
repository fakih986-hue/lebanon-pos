import { Router } from "express"
import type { IncomingMessage, ServerResponse } from "node:http"
import prisma from "../lib/prisma.js"
import { requireAuth, json, type AuthRequest } from "../middleware/auth.js"

const router = Router()

const HF_TOKEN = process.env.HUGGINGFACE_TOKEN || ""
const HF_MODEL = process.env.HF_IMAGE_MODEL || "black-forest-labs/FLUX.1-schnell"

function generatePlaceholderSvg(productName: string): string {
  const encodedName = productName.replace(/[<>&"']/g, "")
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400" viewBox="0 0 400 400">
    <defs>
      <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" style="stop-color:#667eea"/>
        <stop offset="100%" style="stop-color:#764ba2"/>
      </linearGradient>
    </defs>
    <rect width="400" height="400" fill="url(#bg)"/>
    <circle cx="200" cy="160" r="60" fill="rgba(255,255,255,0.2)"/>
    <text x="200" y="280" text-anchor="middle" fill="white" font-family="Arial,sans-serif" font-size="18" font-weight="bold">${encodedName}</text>
    <text x="200" y="310" text-anchor="middle" fill="rgba(255,255,255,0.7)" font-family="Arial,sans-serif" font-size="12">Generated Image</text>
  </svg>`
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`
}

async function generateImage(productName: string): Promise<{ image: string; generated: boolean }> {
  if (!HF_TOKEN) {
    return { image: generatePlaceholderSvg(productName), generated: false }
  }

  try {
    const prompt = `Professional product photo of ${productName}, white background, studio lighting, high quality, e-commerce`
    const hfRes = await fetch(
      `https://api-inference.huggingface.co/models/${HF_MODEL}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${HF_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ inputs: prompt }),
      }
    )

    if (!hfRes.ok) {
      return { image: generatePlaceholderSvg(productName), generated: false }
    }

    const blob = await hfRes.arrayBuffer()
    const base64 = Buffer.from(blob).toString("base64")
    return { image: `data:image/jpeg;base64,${base64}`, generated: true }
  } catch {
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

    const products = await prisma.product.findMany({
      where: { tenantId, isParent: false, image: null },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    })

    if (products.length === 0) {
      json(res, { generated: 0, products: [] })
      return
    }

    const results: Array<{ id: number; name: string; generated: boolean; error?: string }> = []

    for (const product of products) {
      try {
        const { image, generated } = await generateImage(product.name)
        await prisma.product.update({
          where: { id: product.id },
          data: { image },
        })
        results.push({ id: product.id, name: product.name, generated })
      } catch (err) {
        results.push({ id: product.id, name: product.name, generated: false, error: (err as Error).message })
      }
    }

    json(res, { generated: results.filter(r => r.generated).length, products: results })
  } catch (err) {
    console.error("Generate all images error:", err)
    json(res, { error: "Failed to generate images" }, 500)
  }
})

export default router

import { Router, type Request, type Response } from "express"
import prisma from "../lib/prisma.js"
import { requireAuth, type AuthRequest } from "../middleware/auth.js"

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

router.post("/generate", async (req: Request, res: Response) => {
  const { name } = (req.body as { name?: string }) ?? {}

  if (!name || typeof name !== "string") {
    res.status(400).json({ error: "Product name is required" })
    return
  }

  const result = await generateImage(name)
  res.json(result)
})

router.post("/generate-product/:id", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const productId = Number(req.params.id)
    const tenantId = req.auth!.tenantId

    const product = await prisma.product.findFirst({
      where: { id: productId, tenantId },
      select: { id: true, name: true },
    })

    if (!product) {
      res.status(404).json({ error: "Product not found" })
      return
    }

    const { image, generated } = await generateImage(product.name)

    await prisma.product.update({
      where: { id: product.id },
      data: { image },
    })

    res.json({ image, generated })
  } catch (err) {
    console.error("Generate product image error:", err)
    res.status(500).json({ error: "Failed to generate product image" })
  }
})

router.post("/generate-all", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const tenantId = req.auth!.tenantId

    const products = await prisma.product.findMany({
      where: { tenantId, isParent: false, image: null },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    })

    if (products.length === 0) {
      res.json({ generated: 0, products: [] })
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

    res.json({ generated: results.filter(r => r.generated).length, products: results })
  } catch (err) {
    console.error("Generate all images error:", err)
    res.status(500).json({ error: "Failed to generate images" })
  }
})

export default router

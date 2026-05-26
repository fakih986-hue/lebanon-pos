import { Router } from "express"
import type { IncomingMessage, ServerResponse } from "node:http"

const router = Router()

type Req = IncomingMessage & { body?: unknown; query: Record<string, string | string[] | undefined> }

const HF_TOKEN = process.env.HUGGINGFACE_TOKEN || ""
const HF_MODEL = process.env.HF_IMAGE_MODEL || "black-forest-labs/FLUX.1-schnell"

function generatePlaceholderSvg(productName: string): string {
  const encodedName = productName.replace(/[<>&"']/g, "")
  const gradient = `linear-gradient(135deg, #667eea 0%, #764ba2 100%)`
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

router.post("/generate", async (req: Req, res: ServerResponse) => {
  const { name } = (req.body as { name?: string }) ?? {}

  if (!name || typeof name !== "string") {
    res.statusCode = 400
    res.setHeader("Content-Type", "application/json")
    res.end(JSON.stringify({ error: "Product name is required" }))
    return
  }

  if (!HF_TOKEN) {
    const placeholder = generatePlaceholderSvg(name)
    res.setHeader("Content-Type", "application/json")
    res.end(JSON.stringify({ image: placeholder, generated: false }))
    return
  }

  try {
    const prompt = `Professional product photo of ${name}, white background, studio lighting, high quality, e-commerce`
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
      const placeholder = generatePlaceholderSvg(name)
      res.setHeader("Content-Type", "application/json")
      res.end(JSON.stringify({ image: placeholder, generated: false }))
      return
    }

    const blob = await hfRes.arrayBuffer()
    const base64 = Buffer.from(blob).toString("base64")
    const image = `data:image/jpeg;base64,${base64}`

    res.setHeader("Content-Type", "application/json")
    res.end(JSON.stringify({ image, generated: true }))
  } catch {
    const placeholder = generatePlaceholderSvg(name)
    res.setHeader("Content-Type", "application/json")
    res.end(JSON.stringify({ image: placeholder, generated: false }))
  }
})

export default router

import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { Router } from "express"
import type { IncomingMessage, ServerResponse } from "node:http"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const router = Router()

const MANIFEST_PATH = path.join(__dirname, "..", "public", "releases", "manifest.json")

router.get("/manifest", (_req: IncomingMessage, res: ServerResponse) => {
  try {
    if (!fs.existsSync(MANIFEST_PATH)) {
      res.statusCode = 404
      res.setHeader("Content-Type", "application/json")
      res.end(JSON.stringify({ error: "manifest not found" }))
      return
    }

    const data = fs.readFileSync(MANIFEST_PATH, "utf-8")
    res.setHeader("Content-Type", "application/json")
    res.setHeader("Cache-Control", "no-cache")
    res.statusCode = 200
    res.end(data)
  } catch {
    res.statusCode = 500
    res.setHeader("Content-Type", "application/json")
    res.end(JSON.stringify({ error: "internal error" }))
  }
})

export default router

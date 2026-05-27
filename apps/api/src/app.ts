import express from "express"
import type { IncomingMessage, ServerResponse } from "node:http"
import path from "node:path"
import fs from "node:fs"
import { fileURLToPath } from "node:url"
type Req = IncomingMessage & { body?: unknown; query: Record<string, string | string[] | undefined>; params?: Record<string, string> }
type Res = ServerResponse

function json(res: ServerResponse, data: unknown, statusCode = 200) {
  res.statusCode = statusCode
  res.setHeader("Content-Type", "application/json")
  res.end(JSON.stringify(data))
}
import cors from "cors"
import authRoutes from "./routes/auth.js"
import syncRoutes from "./routes/sync.js"
import dashboardRoutes from "./routes/dashboard.js"
import deliveryRoutes from "./routes/delivery.js"
import imageRoutes from "./routes/image.js"
import { errorHandler } from "./middleware/errorHandler.js"
import {
  getCorsOptions,
  rateLimit,
  securityHeaders,
} from "./middleware/security.js"

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const app = express()

app.disable("x-powered-by")
app.use(securityHeaders)
app.use(cors(getCorsOptions()))
app.use(express.json({ limit: "10mb" }))

app.use("/api/auth", rateLimit({ windowMs: 60_000, max: 30, bucket: "auth" }))
app.use("/api/sync", rateLimit({ windowMs: 60_000, max: 240, bucket: "sync" }))

app.use("/api/auth", authRoutes)
app.use("/api/sync", syncRoutes)
app.use("/api/dashboard", dashboardRoutes)
app.use("/api/delivery", deliveryRoutes)
app.use("/api/images", imageRoutes)

app.get("/api/health", (_req: Req, res: Res) => {
  json(res, { status: "ok", timestamp: new Date().toISOString() })
})

app.use(express.static("public", { extensions: ["html"] }))

function serveHtml(relativePath: string) {
  const html = fs.readFileSync(path.join(__dirname, relativePath), "utf-8")
  return (_req: Req, res: Res) => {
    res.setHeader("Content-Type", "text/html")
    res.end(html)
  }
}

// Admin SPA
const adminHtml = fs.readFileSync(
  path.join(__dirname, "..", "public", "admin", "index.html"),
  "utf-8"
)
app.get(/^\/admin(?:\/.*)?$/, (_req: Req, res: Res) => {
  res.setHeader("Content-Type", "text/html")
  res.end(adminHtml)
})

// Driver mobile app (no-auth, name-based)
app.get(/^\/driver(?:\/.*)?$/, serveHtml("../public/driver/index.html"))

// Customer ordering page (no-auth, public)
app.get(/^\/order(?:\/.*)?$/, serveHtml("../public/order/index.html"))

app.use(errorHandler)

export default app

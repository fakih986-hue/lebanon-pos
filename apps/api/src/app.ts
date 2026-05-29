import express from "express"
import type { IncomingMessage, ServerResponse } from "node:http"
import path from "node:path"
import fs from "node:fs"
import { fileURLToPath } from "node:url"
import { json } from "./middleware/auth.js"
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
// Customer-facing delivery endpoints: order creation + account signup/login
app.use("/api/delivery/order", rateLimit({ windowMs: 60_000, max: 10, bucket: "delivery-order" }))
app.use("/api/delivery/customer/signup", rateLimit({ windowMs: 60_000, max: 5, bucket: "customer-signup" }))
app.use("/api/delivery/customer/login", rateLimit({ windowMs: 60_000, max: 10, bucket: "customer-login" }))

app.use("/api/auth", authRoutes)
app.use("/api/sync", syncRoutes)
app.use("/api/dashboard", dashboardRoutes)
app.use("/api/delivery", deliveryRoutes)
app.use("/api/images", imageRoutes)

app.get("/api/health", (_req: IncomingMessage, res: ServerResponse) => {
  json(res, { status: "ok", timestamp: new Date().toISOString() })
})

app.use(express.static("public"))

function spaHandler(publicDir: string) {
  return (_req: IncomingMessage, res: ServerResponse) => {
    try {
      const html = fs.readFileSync(
        path.join(__dirname, "..", "public", publicDir, "index.html"),
        "utf-8"
      )
      res.setHeader("Content-Type", "text/html")
      res.end(html)
    } catch {
      json(res, { error: `${publicDir} app not found` }, 503)
    }
  }
}

// Redirect /favicon.ico to the SVG favicon (browsers auto-request .ico regardless of <link>)
app.get("/favicon.ico", (_req: IncomingMessage, res: ServerResponse) => {
  res.statusCode = 302
  res.setHeader("Location", "/favicon.svg")
  res.end()
})

// Redirect legacy driver routes (without /driver prefix) to the find-store page
const driverRoutes = ["/login", "/orders"]
app.use(driverRoutes, (_req: IncomingMessage, res: ServerResponse) => {
  res.statusCode = 302
  res.setHeader("Location", "/driver/")
  res.end()
})

// SPA routes — match only paths without file extensions (assets are served by express.static)
app.get(/^\/admin(?:\/[^.]*)?$/, spaHandler("admin"))
app.get(/^\/driver(?:\/[^.]*)?$/, spaHandler("driver"))
app.get(/^\/order(?:\/[^.]*)?$/, spaHandler("order"))

app.use(errorHandler)

export default app

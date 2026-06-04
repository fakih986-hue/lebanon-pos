import express from "express"
import type { IncomingMessage, ServerResponse } from "node:http"
import path from "node:path"
import fs from "node:fs"
import { fileURLToPath } from "node:url"
import { json } from "./middleware/auth.js"
import { Decimal } from "@prisma/client/runtime/library"
import cors from "cors"

// Ensure Express's res.json() also converts Prisma Decimals → numbers
// (some routes use res.json() directly instead of the json() helper)
function decimalReplacer(_key: string, value: unknown): unknown {
  return value instanceof Decimal ? value.toNumber() : value
}
import authRoutes from "./routes/auth.js"
import syncRoutes from "./routes/sync.js"
import setupRoutes from "./routes/setup.js"
import dashboardRoutes from "./routes/dashboard.js"
import deliveryRoutes from "./routes/delivery.js"
import imageRoutes from "./routes/image.js"
import adminRoutes from "./routes/admin.js"
import reportsRoutes from "./routes/reports.js"
import { errorHandler } from "./middleware/errorHandler.js"
import {
  getCorsOptions,
  rateLimit,
  securityHeaders,
} from "./middleware/security.js"

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const app = express()

// Trust Railway/nginx reverse proxy for correct IP in rate limiting and logs
app.set("trust proxy", 1)

app.disable("x-powered-by")
app.set("json replacer", decimalReplacer)  // converts Prisma Decimals → numbers in res.json()
app.use(securityHeaders)
app.use(cors(getCorsOptions()))
app.use(express.json({ limit: "10mb" }))

// Auth + sync (high-frequency, calibrated limits)
app.use("/api/auth", rateLimit({ windowMs: 60_000, max: 30, bucket: "auth" }))
app.use("/api/sync", rateLimit({ windowMs: 60_000, max: 240, bucket: "sync" }))
// Customer-facing delivery endpoints
app.use("/api/delivery/order", rateLimit({ windowMs: 60_000, max: 10, bucket: "delivery-order" }))
app.use("/api/delivery/customer/signup", rateLimit({ windowMs: 60_000, max: 5, bucket: "customer-signup" }))
app.use("/api/delivery/customer/login", rateLimit({ windowMs: 60_000, max: 10, bucket: "customer-login" }))
// Previously unprotected route groups
app.use("/api/dashboard", rateLimit({ windowMs: 60_000, max: 120, bucket: "dashboard" }))
app.use("/api/setup", rateLimit({ windowMs: 60_000, max: 20, bucket: "setup" }))
app.use("/api/images", rateLimit({ windowMs: 60_000, max: 60, bucket: "images" }))
app.use("/api/admin", rateLimit({ windowMs: 60_000, max: 60, bucket: "admin" }))
app.use("/api/reports", rateLimit({ windowMs: 60_000, max: 60, bucket: "reports" }))
app.use("/api/delivery", rateLimit({ windowMs: 60_000, max: 120, bucket: "delivery" }))

app.use("/api/auth", authRoutes)
app.use("/api/sync", syncRoutes)
app.use("/api/setup", setupRoutes)
app.use("/api/dashboard", dashboardRoutes)
app.use("/api/delivery", deliveryRoutes)
app.use("/api/images", imageRoutes)
app.use("/api/admin", adminRoutes)
app.use("/api/reports", reportsRoutes)

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
app.get(/^\/owner(?:\/[^.]*)?$/, spaHandler("owner"))
app.get(/^\/driver(?:\/[^.]*)?$/, spaHandler("driver"))
app.get(/^\/order(?:\/[^.]*)?$/, spaHandler("order"))

// POS SPA at root — must be last to not catch more specific SPA routes above
app.get(/^\/(?:[^.]*)?$/, spaHandler(""))

app.use(errorHandler)

export default app

import express from "express"
import type { IncomingMessage, ServerResponse } from "node:http"
import path from "node:path"
import fs from "node:fs"
import { fileURLToPath } from "node:url"
import { json } from "./middleware/auth.js"
import { requireAuth, type AuthRequest } from "./middleware/auth.js"
import prisma from "./lib/prisma.js"
import { Decimal } from "./generated/prisma/runtime/library.js"
import cors from "cors"
import morgan from "morgan"

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
import releasesRoutes from "./routes/releases.js"
import deviceRoutes from "./routes/device.js"
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
app.use(morgan(process.env.NODE_ENV === "production" ? "combined" : "dev"))
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
app.use("/api/admin/login", rateLimit({ windowMs: 60_000, max: 5, bucket: "admin-login" }))
app.use("/api/admin", rateLimit({ windowMs: 60_000, max: 60, bucket: "admin" }))
app.use("/api/reports", rateLimit({ windowMs: 60_000, max: 60, bucket: "reports" }))
app.use("/api/delivery", rateLimit({ windowMs: 60_000, max: 120, bucket: "delivery" }))
app.use("/api/health", rateLimit({ windowMs: 60_000, max: 30, bucket: "health" }))

app.use("/api/auth", authRoutes)
app.use("/api/sync", syncRoutes)
app.use("/api/setup", setupRoutes)
app.use("/api/dashboard", dashboardRoutes)
app.use("/api/delivery", deliveryRoutes)
app.use("/api/images", imageRoutes)
app.use("/api/admin", adminRoutes)
app.use("/api/reports", reportsRoutes)
app.use("/api/releases", releasesRoutes)
app.use("/api", deviceRoutes)

app.get("/api/health", async (_req: IncomingMessage, res: ServerResponse) => {
  try {
    await prisma.$queryRaw`SELECT 1`
    json(res, { status: "ok", timestamp: new Date().toISOString() })
  } catch {
    json(res, { status: "error", timestamp: new Date().toISOString() }, 503)
  }
})

app.get("/api/products", requireAuth, async (req: AuthRequest, res: ServerResponse) => {
  try {
    const tenantId = (req.query.tenantId as string) || req.auth!.tenantId
    const search = (req.query.search as string) || ""
    const skip = parseInt(req.query.skip as string) || 0
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 200)

    const where: any = { tenantId }
    if (search) {
      where.OR = [
        { name: { contains: search, mode: "insensitive" } },
        { barcode: { contains: search, mode: "insensitive" } },
        { category: { contains: search, mode: "insensitive" } },
      ]
    }

    const products = await prisma.product.findMany({
      where,
      orderBy: { name: "asc" },
      skip,
      take: limit,
    })

    json(res, products)
  } catch (err) {
    console.error("[products] List error:", err)
    json(res, { error: "Failed to list products" }, 500)
  }
})

app.get("/api/customers", requireAuth, async (req: AuthRequest, res: ServerResponse) => {
  try {
    const tenantId = (req.query.tenantId as string) || req.auth!.tenantId
    const search = (req.query.search as string) || ""
    const skip = parseInt(req.query.skip as string) || 0
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 200)

    const where: any = { tenantId }
    if (search) {
      where.OR = [
        { name: { contains: search, mode: "insensitive" } },
        { mobile: { contains: search, mode: "insensitive" } },
      ]
    }

    const customers = await prisma.customer.findMany({
      where,
      orderBy: { name: "asc" },
      skip,
      take: limit,
    })

    json(res, customers)
  } catch (err) {
    console.error("[customers] List error:", err)
    json(res, { error: "Failed to list customers" }, 500)
  }
})

app.get("/api/sales", requireAuth, async (req: AuthRequest, res: ServerResponse) => {
  try {
    const tenantId = (req.query.tenantId as string) || req.auth!.tenantId
    const search = (req.query.search as string) || ""
    const skip = parseInt(req.query.skip as string) || 0
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 200)

    const where: any = { tenantId }
    if (search) {
      where.OR = [
        { saleNumber: { contains: search, mode: "insensitive" } },
        { cashier: { contains: search, mode: "insensitive" } },
        { customerName: { contains: search, mode: "insensitive" } },
      ]
    }

    const sales = await prisma.sale.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
      include: { items: true },
    })

    json(res, sales)
  } catch (err) {
    console.error("[sales] List error:", err)
    json(res, { error: "Failed to list sales" }, 500)
  }
})

app.use(express.static("public"))

function spaHandler(publicDir: string) {
  return (_req: IncomingMessage, res: ServerResponse) => {
    const paths = [
      path.join(__dirname, "..", "public", publicDir, "index.html"),
      path.join(__dirname, "public", publicDir, "index.html"),
    ]
    for (const p of paths) {
      if (fs.existsSync(p)) {
        try {
          const html = fs.readFileSync(p, "utf-8")
          res.setHeader("Content-Type", "text/html")
          res.end(html)
          return
        } catch { /* try next */ }
      }
    }
    json(res, { error: `${publicDir} app not found` }, 503)
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
app.get(/^\/(?!api\/|admin|owner|driver|order)[^.]*$/, spaHandler(""))

app.use(errorHandler)

export default app

/**
 * Setup API Routes
 *
 * Used by the Electron first-run wizard and docker-compose first-boot.
 * No JWT required — these endpoints are either read-only or protected by
 * the X-Cloud-Key header (same shared secret as the sync bridge).
 *
 * Routes:
 *   GET  /api/setup/check           — system health: DB connected, tenant exists, admin exists
 *   POST /api/setup/pull-from-cloud — force a full pull from Railway (clears lastPullAt)
 */

import fs   from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { timingSafeEqual, createHash } from "node:crypto"
import { Router } from "express"
import type { Response } from "express"
import type { IncomingMessage } from "node:http"
import jwt from "jsonwebtoken"
import bcrypt from "bcryptjs"
import prisma from "../lib/prisma.js"
import { triggerFullPull, saveCloudConfig, getCloudStatus } from "../services/cloudSync.js"
import { generateCloudApiKey } from "../lib/cloudKey.js"

interface AuthPayload { userId: string; tenantId: string; role: string }
type Req = IncomingMessage & { body?: unknown }

const router = Router()

const JWT_SECRET = process.env.JWT_SECRET!

const __dirname  = path.dirname(fileURLToPath(import.meta.url))
const DATA_DIR   = path.resolve(__dirname, "../../data")
const STATE_FILE = path.join(DATA_DIR, "sync-state.json")

// ─── Helpers ─────────────────────────────────────────────────────────────────

function requireCloudKey(req: Req, res: Response): boolean {
  const expectedKey = process.env.CLOUD_API_KEY
  const incomingKey = req.headers["x-cloud-key"]

  if (!expectedKey || typeof incomingKey !== "string" || !safeEqual(incomingKey, expectedKey)) {
    res.status(401).json({ error: "Missing or invalid X-Cloud-Key header" })
    return false
  }
  return true
}

/** True if the request originates from the local machine (the hub itself). */
function isLocalRequest(req: Req): boolean {
  const addr = req.socket?.remoteAddress ?? ""
  return addr === "127.0.0.1" || addr === "::1" || addr === "::ffff:127.0.0.1"
}

/** Constant-time comparison tolerant of length mismatch. */
function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a)
  const bb = Buffer.from(b)
  return ab.length === bb.length && timingSafeEqual(ab, bb)
}

/** Accept X-Cloud-Key header OR a valid JWT (Bearer token) */
async function requireCloudKeyOrJwt(req: Req, res: Response): Promise<boolean> {
  const expectedKey = process.env.CLOUD_API_KEY
  const incomingKey = req.headers["x-cloud-key"]
  const tenantId = req.headers["x-tenant-id"] as string | undefined

  if (incomingKey && tenantId) {
    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { cloudApiKey: true },
    })
    if (tenant?.cloudApiKey && safeEqual(String(incomingKey), tenant.cloudApiKey)) {
      return true
    }
  }

  if (expectedKey && typeof incomingKey === "string" && safeEqual(incomingKey, expectedKey)) return true

  const header = req.headers.authorization
  if (!header?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Missing X-Cloud-Key or Authorization header" })
    return false
  }
  try {
    const payload = jwt.verify(header.slice(7), JWT_SECRET) as AuthPayload
    if (!payload.tenantId) {
      res.status(401).json({ error: "Invalid token" })
      return false
    }
    return true
  } catch {
    res.status(401).json({ error: "Invalid or expired token" })
    return false
  }
}

// ─── GET /api/setup/check ────────────────────────────────────────────────────
// No auth — safe to call from Electron before any credentials exist.

router.get("/check", async (_req: Req, res: Response) => {
  try {
    await prisma.$queryRaw`SELECT 1`
    const tenantCount = await prisma.tenant.count()
    const adminCount  = tenantCount > 0
      ? await prisma.staffUser.count({ where: { role: "Admin", active: true } })
      : 0

    res.json({
      dbConnected:   true,
      tenantExists:  tenantCount > 0,
      adminExists:   adminCount  > 0,
      tenantCount,
    })
  } catch (err) {
    console.error("[setup] /check error:", err)
    res.status(503).json({
      dbConnected:  false,
      tenantExists: false,
      adminExists:  false,
    })
  }
})

// ─── POST /api/setup/pull-from-cloud ─────────────────────────────────────────
// Accepts X-Cloud-Key header or JWT (Bearer token). Triggers an immediate full
// pull from Railway so data is available right away (instead of waiting 30s for
// the next bridge cycle). Used by the desktop connect flow.

router.post("/pull-from-cloud", async (req: Req, res: Response) => {
  if (!(await requireCloudKeyOrJwt(req, res))) return

  try {
    await triggerFullPull()
    res.json({ ok: true, message: "Full pull from Railway completed" })
  } catch (err) {
    console.error("[setup] pull-from-cloud error:", err)
    res.status(500).json({ error: "Pull from cloud failed" })
  }
})

// ─── GET /api/setup/tenant-info ──────────────────────────────────────────────
// Requires X-Cloud-Key + X-Tenant-Id.
// Returns the tenant name and subdomain — used by the cloud sync bridge on
// local servers to create the correct tenant row in the local database.

router.get("/tenant-info", async (req: Req, res: Response) => {
  if (!(await requireCloudKeyOrJwt(req, res))) return

  const tenantId = req.headers["x-tenant-id"] as string | undefined
  if (!tenantId) {
    res.status(400).json({ error: "X-Tenant-Id header required" })
    return
  }

  try {
    const tenant = await prisma.tenant.findUnique({
      where:  { id: tenantId },
      select: { id: true, name: true, subdomain: true },
    })

    if (!tenant) {
      res.status(404).json({ error: "Tenant not found" })
      return
    }

    res.json(tenant)
  } catch (err) {
    console.error("[setup] tenant-info error:", err)
    res.status(500).json({ error: "Failed to load tenant info" })
  }
})

// ─── POST /api/setup/discover ────────────────────────────────────────────────
// Auto-discovery: given a subdomain + admin PIN, returns the tenant ID + cloud
// API key. Used by the desktop activation wizard so the user only needs to type
// two things instead of three technical values.
// No auth required — this is the first step in the setup flow.
// Rate limited: 5 attempts per minute per IP (PIN brute-force protection).

const discoverAttempts = new Map<string, { count: number; resetAt: number }>()
const DISCOVER_MAX_ATTEMPTS = 5
const DISCOVER_WINDOW_MS = 60_000

function getDiscoverRateLimit(ip: string): { allowed: boolean; retryAfter?: number } {
  const now = Date.now()
  const entry = discoverAttempts.get(ip)
  if (!entry || now > entry.resetAt) {
    discoverAttempts.set(ip, { count: 1, resetAt: now + DISCOVER_WINDOW_MS })
    return { allowed: true }
  }
  if (entry.count >= DISCOVER_MAX_ATTEMPTS) {
    return { allowed: false, retryAfter: Math.ceil((entry.resetAt - now) / 1000) }
  }
  entry.count++
  return { allowed: true }
}

// Clean up expired entries every 5 minutes
setInterval(() => {
  const now = Date.now()
  for (const [ip, entry] of discoverAttempts.entries()) {
    if (now > entry.resetAt) discoverAttempts.delete(ip)
  }
}, 5 * 60_000)

router.post("/discover", async (req: Req, res: Response) => {
  // Rate limit check
  const ip = req.socket?.remoteAddress ?? "unknown"
  const limit = getDiscoverRateLimit(ip)
  if (!limit.allowed) {
    res.status(429).json({ error: `Too many attempts. Try again in ${limit.retryAfter} seconds.` })
    return
  }

  const { subdomain, pin } =
    (req.body as { subdomain?: string; pin?: string }) || {}

  if (!subdomain || !pin) {
    res.status(400).json({ error: "subdomain and pin are required" })
    return
  }

  const isLocalHub = ["true", "1"].includes(process.env.IS_LOCAL_SERVER || "")
  const cloudApiUrl = process.env.CLOUD_API_URL?.replace(/\/+$/, "")

  try {
    // A hub's local Postgres is only ever a partial mirror, populated by
    // whatever's synced down so far — a brand-new (or not-yet-linked) hub
    // has no tenant/admin rows at all, so a purely local subdomain+PIN lookup
    // can never succeed for the "link this hub to my existing cloud store"
    // flow this endpoint exists for. Hubs must ask the authoritative cloud
    // to do the actual discovery, then mirror the result locally.
    if (isLocalHub && cloudApiUrl) {
      let cloudRes: globalThis.Response
      try {
        cloudRes = await fetch(`${cloudApiUrl}/api/setup/discover`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ subdomain, pin }),
          signal: AbortSignal.timeout(15_000),
        })
      } catch (err) {
        console.error("[setup] cloud discover request failed:", (err as Error).message)
        res.status(502).json({ error: "Could not reach the cloud server. Check your internet connection and try again." })
        return
      }

      const cloudData = (await cloudRes.json().catch(() => ({}))) as {
        tenantId?: string; tenantName?: string; subdomain?: string; cloudApiKey?: string; error?: string
      }

      if (!cloudRes.ok) {
        res.status(cloudRes.status).json({ error: cloudData.error || "Discovery failed" })
        return
      }
      if (!cloudData.tenantId || !cloudData.cloudApiKey) {
        console.error("[setup] cloud discover returned an incomplete response:", cloudData)
        res.status(502).json({ error: "The cloud server returned an unexpected response. Try again." })
        return
      }

      // Mirror the tenant locally so it exists as an FK target before the
      // first full pull runs — same placeholder pattern cloudSync.ts already
      // uses when it meets an unfamiliar tenantId during a regular pull.
      await prisma.tenant.upsert({
        where: { id: cloudData.tenantId },
        update: { cloudApiKey: cloudData.cloudApiKey },
        create: {
          id: cloudData.tenantId,
          name: cloudData.tenantName || "Synced Store",
          subdomain: cloudData.subdomain || subdomain.trim().toLowerCase(),
          cloudApiKey: cloudData.cloudApiKey,
        },
      })

      res.json({
        tenantId: cloudData.tenantId,
        tenantName: cloudData.tenantName,
        subdomain: cloudData.subdomain,
        cloudApiKey: cloudData.cloudApiKey,
      })
      return
    }

    // Not a hub (running directly against Railway, or a standalone non-hub
    // deployment) — we ARE the authoritative record, so look up locally.
    const tenant = await prisma.tenant.findUnique({
      where: { subdomain: subdomain.trim().toLowerCase() },
      select: { id: true, name: true, subdomain: true, cloudApiKey: true, suspended: true },
    })

    if (!tenant) {
      res.status(404).json({ error: "Store not found. Check the subdomain." })
      return
    }

    if (tenant.suspended) {
      res.status(403).json({ error: "This store has been suspended." })
      return
    }

    // Find an admin user in this tenant and verify the PIN
    const adminUser = await prisma.staffUser.findFirst({
      where: { tenantId: tenant.id, role: "Admin", active: true },
      select: { id: true, name: true, pin: true },
    })

    if (!adminUser) {
      res.status(404).json({ error: "No admin user found for this store." })
      return
    }

    const pinMatches = adminUser.pin.startsWith("$2")
      ? await bcrypt.compare(pin, adminUser.pin)
      : adminUser.pin === createHash("sha256").update(pin).digest("base64")

    if (!pinMatches) {
      res.status(401).json({ error: "Incorrect PIN. Check with the store owner." })
      return
    }

    // Tenants created before the cloudApiKey column was added (migration
    // 20260604193053) were backfilled with an empty string, not a real key.
    // Discovery is already PIN-authenticated, so it's a safe place to self-heal
    // that once — otherwise activation silently forwards "" to /cloud-config,
    // which rejects it with a generic "tenantId and apiKey are required" that
    // gives the pilot user no way to know their store's key was never set.
    let cloudApiKey = tenant.cloudApiKey
    if (!cloudApiKey) {
      cloudApiKey = generateCloudApiKey()
      await prisma.tenant.update({ where: { id: tenant.id }, data: { cloudApiKey } })
      console.log(`[setup] backfilled missing cloudApiKey for tenant ${tenant.id} (${tenant.subdomain})`)
    }

    res.json({
      tenantId: tenant.id,
      tenantName: tenant.name,
      subdomain: tenant.subdomain,
      cloudApiKey,
    })
  } catch (err) {
    console.error("[setup] discover error:", err)
    res.status(500).json({ error: "Discovery failed" })
  }
})

// ─── GET /api/setup/cloud-config ─────────────────────────────────────────────
// Localhost-only. Returns current cloud connection status (no secrets).

router.get("/cloud-config", (req: Req, res: Response) => {
  if (!isLocalRequest(req)) {
    res.status(403).json({ error: "Only available on the hub machine" })
    return
  }
  res.json(getCloudStatus())
})

// ─── POST /api/setup/cloud-config ────────────────────────────────────────────
// Localhost-only + admin password. Persists the tenant ID + per-tenant API key,
// restarts the sync bridge, and triggers an immediate full pull.
// Body: { tenantId, apiKey, adminPassword }

router.post("/cloud-config", async (req: Req, res: Response) => {
  if (!isLocalRequest(req)) {
    res.status(403).json({ error: "Only available on the hub machine" })
    return
  }

  const { tenantId, apiKey, adminPassword } =
    (req.body as { tenantId?: string; apiKey?: string; adminPassword?: string }) || {}

  const master = process.env.ADMIN_PASSWORD ?? ""
  const masterHash = process.env.ADMIN_PASSWORD_HASH ?? ""

  let passwordValid = false
  if (masterHash) {
    passwordValid = master.length > 0 && adminPassword === master ? await bcrypt.compare(adminPassword, masterHash) : false
  } else {
    passwordValid = master.length > 0 && adminPassword === master
  }
  if (!passwordValid) {
    res.status(401).json({ error: "Invalid admin password" })
    return
  }
  if (!tenantId || !apiKey) {
    res.status(400).json({ error: "tenantId and apiKey are required — re-run Store Setup, or check the store's API key under Cloud Sync settings." })
    return
  }

  try {
    saveCloudConfig(tenantId.trim(), apiKey.trim())
    // Give the restarted bridge a moment, then force a full pull
    let pullError: string | null = null
    try {
      await triggerFullPull()
    } catch (err) {
      pullError = (err as Error).message
      console.error("[cloud-config] bridge pull failed:", pullError)
    }
    res.json({ ok: true, pullError, ...getCloudStatus() })
  } catch (err) {
    console.error("[setup] cloud-config error:", err)
    res.status(500).json({ error: "Failed to save cloud config" })
  }
})

// ─── POST /api/setup/auto-login ──────────────────────────────────────────────
// Localhost-only. Mints a hub JWT scoped to the CONFIGURED tenant so the hub SPA
// can pull local data into IndexedDB without a manual login. The SPA calls this
// on every launch (token is re-minted each time), so a long life is fine and the
// always-on hub never hits a mid-day 401. Returns 409 if cloud isn't configured.

router.post("/auto-login", (req: Req, res: Response) => {
  if (!isLocalRequest(req)) {
    res.status(403).json({ error: "Only available on the hub machine" })
    return
  }
  const { tenantId } = getCloudStatus()
  if (!tenantId) {
    res.status(409).json({ error: "Cloud not configured yet" })
    return
  }
  const token = jwt.sign(
    { userId: "__admin__", tenantId, role: "Admin" },
    JWT_SECRET,
    { expiresIn: "30d" }
  )
  res.json({ token, tenantId })
})

// Admin diagnostics — protected, returns system info without secrets
router.get("/diagnostics", async (req: Req, res: Response) => {
  try {
    const dbConnected = await prisma.$queryRaw`SELECT 1`.then(() => true).catch(() => false)
    const tenantCount = dbConnected ? await prisma.tenant.count() : null
    const syncPending = dbConnected ? await prisma.syncOperation.count({ where: { status: "Pending" } }) : null
    const syncFailed = dbConnected ? await prisma.syncOperation.count({ where: { status: "Failed" } }) : null

    res.json({
      timestamp: new Date().toISOString(),
      app: "Titan POS API",
      dbConnected,
      tenantCount,
      syncPending,
      syncFailed,
      nodeVersion: process.version,
      platform: process.platform,
      env: process.env.NODE_ENV || "development",
      cloudConfig: getCloudStatus(),
    })
  } catch (err) {
    console.error("[diagnostics] Error:", err)
    res.status(500).json({ error: "Diagnostics failed" })
  }
})

export default router

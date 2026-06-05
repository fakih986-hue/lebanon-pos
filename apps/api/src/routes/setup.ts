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
import { timingSafeEqual } from "node:crypto"
import { Router } from "express"
import type { Response } from "express"
import type { IncomingMessage } from "node:http"
import jwt from "jsonwebtoken"
import prisma from "../lib/prisma.js"
import { triggerFullPull, saveCloudConfig, getCloudStatus } from "../services/cloudSync.js"

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

  if (!expectedKey || incomingKey !== expectedKey) {
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
  if (expectedKey && incomingKey === expectedKey) return true

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
    res.status(503).json({
      dbConnected:  false,
      tenantExists: false,
      adminExists:  false,
      error:        (err as Error).message,
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
    res.status(500).json({ error: (err as Error).message })
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
    res.status(500).json({ error: (err as Error).message })
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
  if (!master || !adminPassword || !safeEqual(adminPassword, master)) {
    res.status(401).json({ error: "Invalid admin password" })
    return
  }
  if (!tenantId || !apiKey) {
    res.status(400).json({ error: "tenantId and apiKey are required" })
    return
  }

  try {
    saveCloudConfig(tenantId.trim(), apiKey.trim())
    // Give the restarted bridge a moment, then force a full pull
    await triggerFullPull().catch(() => { /* first pull may lag — bridge will retry */ })
    // No token here — the SPA obtains one from /api/setup/auto-login (single path)
    res.json({ ok: true, ...getCloudStatus() })
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
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

export default router

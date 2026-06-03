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
import { Router } from "express"
import type { Response } from "express"
import type { IncomingMessage } from "node:http"
import prisma from "../lib/prisma.js"

type Req = IncomingMessage & { body?: unknown }

const router = Router()

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
// Requires X-Cloud-Key. Clears lastPullAt so the cloud bridge triggers a full
// pull on its next cycle. Useful for:
//   • Restoring a crashed local server
//   • Onboarding a new local server to existing Railway data

router.post("/pull-from-cloud", (req: Req, res: Response) => {
  if (!requireCloudKey(req, res)) return

  try {
    // Clear lastPullAt → next bridge pull cycle will do a full pull
    const current: Record<string, unknown> = (() => {
      try { return JSON.parse(fs.readFileSync(STATE_FILE, "utf-8")) } catch { return {} }
    })()

    delete current.lastPullAt

    fs.mkdirSync(DATA_DIR, { recursive: true })
    fs.writeFileSync(STATE_FILE, JSON.stringify(current, null, 2))

    res.json({ ok: true, message: "lastPullAt cleared — next bridge cycle will do a full pull from Railway" })
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

export default router

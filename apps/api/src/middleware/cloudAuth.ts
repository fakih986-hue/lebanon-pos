/**
 * Cloud Auth Middleware
 *
 * Extends the standard JWT auth to also accept a PER-TENANT API key for
 * server-to-server calls from the local cloud sync bridge.
 *
 * The bridge sends:
 *   X-Cloud-Key: <the tenant's own cloudApiKey>
 *   X-Tenant-Id: <tenant UUID>
 *
 * The key is validated against that tenant's stored `cloudApiKey` (not a single
 * global secret). A leaked key only exposes ONE store. Falls back to standard
 * JWT Bearer auth for all other requests.
 *
 * Legacy: if CLOUD_API_KEY env var is set, it is still accepted as a global
 * master key for backward compatibility / server-to-server admin tooling.
 */

import type { IncomingMessage, ServerResponse } from "node:http"
import { timingSafeEqual } from "node:crypto"
import { requireAuth, type AuthRequest } from "./auth.js"
import prisma from "../lib/prisma.js"

type Handler = (
  req: IncomingMessage,
  res: ServerResponse,
  next: (err?: unknown) => void
) => void

/** Constant-time string comparison that tolerates length mismatch. */
function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a)
  const bb = Buffer.from(b)
  return ab.length === bb.length && timingSafeEqual(ab, bb)
}

export const requireCloudOrJwtAuth: Handler = async (req, res, next) => {
  const incomingKey = (req.headers as Record<string, string | undefined>)["x-cloud-key"]
  const tenantId    = (req.headers as Record<string, string | undefined>)["x-tenant-id"]

  if (incomingKey && tenantId) {
    try {
      // 1. Per-tenant key: validate against the tenant's own stored cloudApiKey
      const tenant = await prisma.tenant.findUnique({
        where: { id: tenantId },
        select: { cloudApiKey: true },
      })
      const perTenantOk = !!tenant?.cloudApiKey && safeEqual(incomingKey, tenant.cloudApiKey)

      // 2. Legacy global key (optional, backward compatibility)
      const globalKey = process.env.CLOUD_API_KEY
      const globalOk  = !!globalKey && safeEqual(incomingKey, globalKey)

      if (perTenantOk || globalOk) {
        ;(req as AuthRequest).auth = { userId: "cloud-bridge", tenantId, role: "Admin" }
        next()
        return
      }
    } catch (err) {
      console.error("[cloudAuth] tenant key lookup failed:", err)
      // fall through to JWT auth
    }
  }

  // Fall back to standard JWT auth
  requireAuth(req as any, res, next)
}

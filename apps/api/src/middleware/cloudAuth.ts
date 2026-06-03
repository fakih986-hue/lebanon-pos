/**
 * Cloud Auth Middleware
 *
 * Extends the standard JWT auth to also accept a shared API key for
 * server-to-server calls from the local cloud sync bridge.
 *
 * The bridge sends:
 *   X-Cloud-Key: <CLOUD_API_KEY env var value>
 *   X-Tenant-Id: <tenant UUID>
 *
 * If the key matches and a tenant ID is present, auth is injected directly.
 * Falls back to standard JWT Bearer auth for all other requests.
 *
 * If CLOUD_API_KEY env var is unset, the cloud key path is disabled entirely.
 */

import type { IncomingMessage, ServerResponse } from "node:http"
import { requireAuth, type AuthRequest } from "./auth.js"

type Handler = (
  req: IncomingMessage,
  res: ServerResponse,
  next: (err?: unknown) => void
) => void

export const requireCloudOrJwtAuth: Handler = (req, res, next) => {
  const expectedKey = process.env.CLOUD_API_KEY
  const incomingKey = (req.headers as Record<string, string | undefined>)["x-cloud-key"]
  const tenantId    = (req.headers as Record<string, string | undefined>)["x-tenant-id"]

  // Cloud key path: only active when CLOUD_API_KEY is configured
  if (expectedKey && incomingKey === expectedKey && tenantId) {
    ;(req as AuthRequest).auth = {
      userId:   "cloud-bridge",
      tenantId,
      role:     "Admin",
    }
    next()
    return
  }

  // Fall back to standard JWT auth
  requireAuth(req as any, res, next)
}

import type { IncomingMessage, ServerResponse } from "node:http"
import jwt, { type SignOptions } from "jsonwebtoken"
import { Decimal } from "../generated/prisma/runtime/library.js"

/**
 * Recursively convert Prisma Decimal values to plain JS numbers.
 * Prisma's Decimal.toJSON() returns a string — this ensures the API
 * always sends numbers (not strings) to the desktop and ordering apps.
 */
function serializeDecimals(value: unknown): unknown {
  if (value instanceof Decimal) return value.toNumber()
  // Fallback: Decimal-like object from Prisma that instanceof misses (ESM module duplication)
  if (value !== null && typeof value === "object" && !Array.isArray(value) && "s" in value && "d" in value && (value as any).toNumber) {
    return (value as any).toNumber()
  }
  // Date objects — serialize to ISO string (before generic object branch that strips them)
  if (value instanceof Date) return value.toISOString()
  if (Array.isArray(value)) return value.map(serializeDecimals)
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, serializeDecimals(v)])
    )
  }
  return value
}

// Read lazily at call time — NOT at module load. The .env may not be loaded into
// process.env yet when this module is first imported (load-order safety).
function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET
  if (!secret) throw new Error("JWT_SECRET is not set")
  return secret
}
const JWT_EXPIRES_IN = (process.env.JWT_EXPIRES_IN ||
  "30d") as SignOptions["expiresIn"]

export interface AuthPayload {
  userId: string
  tenantId: string
  role: string
  tokenVersion?: number
}

export interface AuthRequest extends IncomingMessage {
  auth?: AuthPayload
  body?: unknown
  query: Record<string, string | string[] | undefined>
  params?: Record<string, string>
}

type Handler = (
  req: AuthRequest,
  res: ServerResponse,
  next: (err?: unknown) => void
) => void

export function json(res: ServerResponse, data: unknown, statusCode = 200) {
  res.statusCode = statusCode
  res.setHeader("Content-Type", "application/json")
  // serializeDecimals handles most cases; JSON.stringify replacer catches any missed
  res.end(JSON.stringify(serializeDecimals(data), (key: string, value: unknown) => {
    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      if (value instanceof Decimal) return value.toNumber()
      if ("toNumber" in value && typeof (value as any).toNumber === "function") return (value as any).toNumber()
    }
    return value
  }))
}

export const requireAuth: Handler = async (req, res, next) => {
  const header = req.headers.authorization
  if (!header?.startsWith("Bearer ")) {
    json(res, { error: "Missing or invalid authorization header" }, 401)
    return
  }

  try {
    const token = header.slice(7)
    const payload = jwt.verify(token, getJwtSecret()) as AuthPayload
    // Check tokenVersion for revocation support
    if (payload.tokenVersion) {
      const prisma = (await import("../lib/prisma.js")).default
      const user = await prisma.staffUser.findUnique({
        where: { id: payload.userId },
        select: { tokenVersion: true, active: true },
      })
      if (!user || !user.active) {
        json(res, { error: "Invalid or expired token" }, 401)
        return
      }
      if (user.tokenVersion !== payload.tokenVersion) {
        json(res, { error: "Session revoked — please sign in again" }, 401)
        return
      }
    }
    req.auth = payload
    next()
  } catch {
    json(res, { error: "Invalid or expired token" }, 401)
  }
}

export function signToken(payload: AuthPayload): string {
  return jwt.sign(payload, getJwtSecret(), { expiresIn: JWT_EXPIRES_IN })
}

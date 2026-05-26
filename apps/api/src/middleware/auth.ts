import type { IncomingMessage, ServerResponse } from "node:http"
import jwt, { type SignOptions } from "jsonwebtoken"

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-in-production"
const JWT_EXPIRES_IN = (process.env.JWT_EXPIRES_IN ||
  "30d") as SignOptions["expiresIn"]

if (
  process.env.NODE_ENV === "production" &&
  JWT_SECRET === "dev-secret-change-in-production"
) {
  throw new Error("JWT_SECRET must be configured in production")
}

export interface AuthPayload {
  userId: string
  tenantId: string
  role: string
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

export const requireAuth: Handler = (req, res, next) => {
  const header = req.headers.authorization
  if (!header?.startsWith("Bearer ")) {
    res.statusCode = 401
    res.setHeader("Content-Type", "application/json")
    res.end(JSON.stringify({ error: "Missing or invalid authorization header" }))
    return
  }

  try {
    const token = header.slice(7)
    const payload = jwt.verify(token, JWT_SECRET) as AuthPayload
    req.auth = payload
    next()
  } catch {
    res.statusCode = 401
    res.setHeader("Content-Type", "application/json")
    res.end(JSON.stringify({ error: "Invalid or expired token" }))
  }
}

export function signToken(payload: AuthPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN })
}

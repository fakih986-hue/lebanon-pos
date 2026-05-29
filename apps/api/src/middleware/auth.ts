import type { IncomingMessage, ServerResponse } from "node:http"
import jwt, { type SignOptions } from "jsonwebtoken"

const JWT_SECRET = process.env.JWT_SECRET!
const JWT_EXPIRES_IN = (process.env.JWT_EXPIRES_IN ||
  "30d") as SignOptions["expiresIn"]

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

export function json(res: ServerResponse, data: unknown, statusCode = 200) {
  res.statusCode = statusCode
  res.setHeader("Content-Type", "application/json")
  res.end(JSON.stringify(data))
}

export const requireAuth: Handler = (req, res, next) => {
  const header = req.headers.authorization
  if (!header?.startsWith("Bearer ")) {
    json(res, { error: "Missing or invalid authorization header" }, 401)
    return
  }

  try {
    const token = header.slice(7)
    const payload = jwt.verify(token, JWT_SECRET) as AuthPayload
    req.auth = payload
    next()
  } catch {
    json(res, { error: "Invalid or expired token" }, 401)
  }
}

export function signToken(payload: AuthPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN })
}

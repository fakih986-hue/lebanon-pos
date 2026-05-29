import { type Request, type Response, type NextFunction } from "express"
import jwt, { type SignOptions } from "jsonwebtoken"

const JWT_SECRET = process.env.JWT_SECRET!
const JWT_EXPIRES_IN = (process.env.JWT_EXPIRES_IN ||
  "30d") as SignOptions["expiresIn"]

export interface AuthPayload {
  userId: string
  tenantId: string
  role: string
}

export interface AuthRequest extends Request {
  auth?: AuthPayload
}

export const requireAuth = (req: AuthRequest, res: Response, next: NextFunction) => {
  const header = req.headers.authorization
  if (!header?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Missing or invalid authorization header" })
    return
  }

  try {
    const token = header.slice(7)
    const payload = jwt.verify(token, JWT_SECRET) as AuthPayload
    req.auth = payload
    next()
  } catch {
    res.status(401).json({ error: "Invalid or expired token" })
  }
}

export function signToken(payload: AuthPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN })
}

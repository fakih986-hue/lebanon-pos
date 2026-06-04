import type { IncomingMessage, ServerResponse } from "node:http"
import type { CorsOptions } from "cors"

type Handler = (
  req: IncomingMessage,
  res: ServerResponse,
  next: (err?: unknown) => void
) => void

type RateLimitOptions = {
  windowMs: number
  max: number
  bucket?: string
}

type RateLimitState = {
  count: number
  resetAt: number
}

const rateLimitBuckets = new Map<string, RateLimitState>()

// Prune expired rate limit entries every 5 minutes to prevent unbounded growth
setInterval(() => {
  const now = Date.now()
  for (const [key, state] of rateLimitBuckets) {
    if (state.resetAt <= now) rateLimitBuckets.delete(key)
  }
}, 5 * 60 * 1000).unref()

function parseOriginList(value?: string) {
  return (value ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean)
}

export function getCorsOptions(): CorsOptions {
  const allowedOrigins = parseOriginList(
    process.env.CORS_ORIGINS ?? process.env.CORS_ORIGIN
  )

  return {
    credentials: true,
    origin(origin, callback) {
      // No origin = same-origin request (server-side, curl, etc.) — always allow
      if (!origin) {
        callback(null, true)
        return
      }

      // If no allowlist configured, deny all cross-origin requests
      if (allowedOrigins.length === 0) {
        callback(new Error("CORS: no origins configured — set CORS_ORIGINS env var"))
        return
      }

      callback(null, allowedOrigins.includes(origin))
    },
  }
}

export const securityHeaders: Handler = (_req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff")
  res.setHeader("X-Frame-Options", "DENY")
  res.setHeader("Referrer-Policy", "no-referrer")
  res.setHeader("Cross-Origin-Resource-Policy", "same-site")
  res.setHeader(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=(), payment=()"
  )
  res.setHeader(
    "Content-Security-Policy",
    [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline'",  // unsafe-inline needed for Vite-built SPAs
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "img-src 'self' data: blob:",
      "font-src 'self' data: https://fonts.gstatic.com",
      "connect-src 'self' ws: wss:",
      "frame-ancestors 'none'",
    ].join("; ")
  )

  if (process.env.NODE_ENV === "production") {
    res.setHeader(
      "Strict-Transport-Security",
      "max-age=31536000; includeSubDomains"
    )
  }

  next()
}

export function rateLimit({ windowMs, max, bucket = "api" }: RateLimitOptions) {
  return (req: IncomingMessage, res: ServerResponse, next: (err?: unknown) => void) => {
    const now = Date.now()
    // Prefer X-Forwarded-For (set by Railway/nginx) over socket address
    const forwarded = (req.headers as Record<string, string | string[] | undefined>)["x-forwarded-for"]
    const ip = (Array.isArray(forwarded) ? forwarded[0] : forwarded?.split(",")[0])?.trim()
      ?? req.socket.remoteAddress
      ?? "unknown"
    const key = `${bucket}:${ip}`
    const current = rateLimitBuckets.get(key)

    if (!current || current.resetAt <= now) {
      rateLimitBuckets.set(key, { count: 1, resetAt: now + windowMs })
      next()
      return
    }

    if (current.count >= max) {
      res.setHeader("Retry-After", Math.ceil((current.resetAt - now) / 1000))
      res.statusCode = 429
      res.setHeader("Content-Type", "application/json")
      res.end(JSON.stringify({ error: "Too many requests. Try again shortly." }))
      return
    }

    current.count += 1
    next()
  }
}

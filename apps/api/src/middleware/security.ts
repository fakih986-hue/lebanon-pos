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
      if (!origin || allowedOrigins.length === 0) {
        callback(null, true)
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
    const key = `${bucket}:${req.socket.remoteAddress ?? "unknown"}`
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

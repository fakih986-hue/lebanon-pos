import type { IncomingMessage, ServerResponse } from "node:http"
import type { CorsOptions } from "cors"
import prisma from "../lib/prisma.js"

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
const PRUNE_INTERVAL = 10 * 60 * 1000
setInterval(persistPrune, PRUNE_INTERVAL).unref()


// Helper: fire-and-forget DB writes — never crash on missing model
function persistUpsert(bucket: string, key: string, count: number, resetAtMs: number) {
  if (!(prisma as any).rateLimitEntry) return
  prisma.rateLimitEntry.upsert({
    where: { bucket_key: { bucket, key } },
    create: { bucket, key, count, resetAt: new Date(resetAtMs) },
    update: { count, resetAt: new Date(resetAtMs) },
  }).catch(() => {})
}
function persistUpdate(bucket: string, key: string, count: number) {
  if (!(prisma as any).rateLimitEntry) return
  prisma.rateLimitEntry.update({
    where: { bucket_key: { bucket, key } },
    data: { count },
  }).catch(() => {})
}
function persistPrune() {
  if (!(prisma as any).rateLimitEntry) return
  prisma.rateLimitEntry.deleteMany({
    where: { resetAt: { lte: new Date() } },
  }).catch(() => {})
}

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

  // Local/LAN origins: localhost dev servers AND private-network IPs (LAN hub clients).
  // The hub serves the SPA to other devices at http://192.168.x.x:3001 — those clients
  // send an Origin header on POSTs, so they must be allowed without manual config.
  const localOrInternal =
    /^https?:\/\/(localhost|127\.0\.0\.1|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)(:\d+)?$/

  return {
    credentials: true,
    origin(origin, callback) {
      // No origin = same-origin request (server-side, curl, etc.) — always allow
      if (!origin) {
        callback(null, true)
        return
      }

      // Always allow localhost + private LAN origins (the offline hub topology)
      if (localOrInternal.test(origin)) { callback(null, true); return }

      // Allow null origin (data: / file: URLs used by Electron activation window)
      if (origin === "null") { callback(null, true); return }

      // Otherwise require an explicit allowlist (cloud / public deployments)
      if (allowedOrigins.length === 0) {
        callback(new Error("CORS: origin not allowed — set CORS_ORIGINS env var"))
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
  return async (req: IncomingMessage, res: ServerResponse, next: (err?: unknown) => void) => {
    const now = Date.now()
    const forwarded = (req.headers as Record<string, string | string[] | undefined>)["x-forwarded-for"]
    const ip = (Array.isArray(forwarded) ? forwarded[0] : forwarded?.split(",")[0])?.trim()
      ?? req.socket.remoteAddress
      ?? "unknown"
    const key = `${bucket}:${ip}`
    const current = rateLimitBuckets.get(key)

    if (!current || current.resetAt <= now) {
      rateLimitBuckets.set(key, { count: 1, resetAt: now + windowMs })
      persistUpsert(bucket, key, 1, now + windowMs)
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
    persistUpdate(bucket, key, current.count)
    next()
  }
}

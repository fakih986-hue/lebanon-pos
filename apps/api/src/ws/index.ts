import { WebSocketServer, WebSocket } from "ws"
import type { Server, IncomingMessage } from "node:http"
import jwt from "jsonwebtoken"
import type { AuthPayload } from "../middleware/auth.js"

// Read lazily at use time — process.env may not be populated at module-load.
function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET
  if (!secret) throw new Error("JWT_SECRET is not set")
  return secret
}

interface ClientInfo {
  ws: WebSocket
  userId?: string
  tenantId?: string
  role?: string
  /** The raw JWT token — re-verified on subscribe to catch expiry */
  token?: string
  subscribedChannels: Set<string>
}

const clients = new Map<WebSocket, ClientInfo>()

function isOriginAllowed(origin: string | undefined): boolean {
  const allowedOrigins = (process.env.CORS_ORIGINS ?? process.env.CORS_ORIGIN ?? "")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean)

  // No origin = server-side / same-origin request — allow
  if (!origin) return true
  // No allowlist configured — deny all cross-origin WS connections
  if (allowedOrigins.length === 0) return false
  return allowedOrigins.includes(origin)
}

export function setupWebSocket(server: Server) {
  const wss = new WebSocketServer({
    server,
    path: "/ws",
    verifyClient: ({ req }: { req: IncomingMessage }) => {
      const origin = req.headers.origin
      if (!isOriginAllowed(origin)) {
        console.warn(`[ws] rejected connection from origin: ${origin}`)
        return false
      }
      return true
    },
  })

  wss.on("connection", (ws: WebSocket) => {
    const info: ClientInfo = { ws, subscribedChannels: new Set() }
    clients.set(ws, info)

    ws.on("message", (raw: Buffer) => {
      try {
        const msg = JSON.parse(raw.toString())
        handleMessage(ws, info, msg)
      } catch {
        send(ws, { type: "error", data: { message: "Invalid message" } })
      }
    })

    ws.on("close", () => {
      clients.delete(ws)
    })

    ws.on("error", () => {
      clients.delete(ws)
    })

    send(ws, { type: "connected", data: { message: "Connected to WebSocket" } })
  })

  return wss
}

function handleMessage(ws: WebSocket, info: ClientInfo, msg: any) {
  switch (msg.type) {
    case "auth":
      try {
        const payload = jwt.verify(msg.token, getJwtSecret()) as AuthPayload
        info.userId = payload.userId
        info.tenantId = payload.tenantId
        info.role = payload.role
        info.token = msg.token  // store for re-validation on subscribe
        send(ws, { type: "auth:ok", data: { userId: payload.userId, role: payload.role } })
      } catch {
        send(ws, { type: "auth:error", data: { message: "Invalid or expired token" } })
        ws.close()
      }
      break

    case "subscribe":
      if (msg.channel) {
        // Re-verify token on every subscribe to catch expiry between auth and subscribe
        if (info.token) {
          try {
            jwt.verify(info.token, getJwtSecret())
          } catch {
            send(ws, { type: "auth:error", data: { message: "Token expired — reconnect to refresh" } })
            ws.close()
            break
          }
        }
        if (!canSubscribe(info, msg.channel)) {
          send(ws, { type: "subscribe:error", data: { channel: msg.channel, message: "Channel not allowed" } })
          break
        }
        info.subscribedChannels.add(msg.channel)
        send(ws, { type: "subscribed", data: { channel: msg.channel } })
      }
      break

    case "unsubscribe":
      if (msg.channel) {
        info.subscribedChannels.delete(msg.channel)
      }
      break

    case "ping":
      send(ws, { type: "pong" })
      break
  }
}

function canSubscribe(info: ClientInfo, channel: unknown) {
  if (typeof channel !== "string" || !info.userId || !info.tenantId) {
    return false
  }

  if (channel === `tenant:${info.tenantId}`) {
    return true
  }

  if (channel === `user:${info.userId}`) {
    return true
  }

  return false
}

function send(ws: WebSocket, data: any) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data))
  }
}

export function broadcast(channel: string, event: string, data: any) {
  for (const [, info] of clients) {
    if (info.subscribedChannels.has(channel)) {
      send(info.ws, { type: event, data })
    }
  }
}

export function broadcastToTenant(tenantId: string, event: string, data: any) {
  broadcast(`tenant:${tenantId}`, event, data)
}

export function broadcastToUser(userId: string, event: string, data: any) {
  broadcast(`user:${userId}`, event, data)
}

export function getConnectedDrivers(tenantId: string): string[] {
  const drivers: string[] = []
  for (const [, info] of clients) {
    if (info.role === "Driver" && info.tenantId === tenantId && info.userId) {
      drivers.push(info.userId)
    }
  }
  return drivers
}

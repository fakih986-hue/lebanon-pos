import { WebSocketServer, WebSocket } from "ws"
import type { Server } from "node:http"
import jwt from "jsonwebtoken"
import type { AuthPayload } from "../middleware/auth.js"

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-in-production"

interface ClientInfo {
  ws: WebSocket
  userId?: string
  tenantId?: string
  role?: string
  subscribedChannels: Set<string>
}

const clients = new Map<WebSocket, ClientInfo>()

export function setupWebSocket(server: Server) {
  const wss = new WebSocketServer({ server, path: "/ws" })

  wss.on("connection", (ws: WebSocket) => {
    const info: ClientInfo = { ws, subscribedChannels: new Set() }
    clients.set(ws, info)

    ws.on("message", (raw) => {
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
        const payload = jwt.verify(msg.token, JWT_SECRET) as AuthPayload
        info.userId = payload.userId
        info.tenantId = payload.tenantId
        info.role = payload.role
        send(ws, { type: "auth:ok", data: { userId: payload.userId, role: payload.role } })
      } catch {
        send(ws, { type: "auth:error", data: { message: "Invalid token" } })
      }
      break

    case "subscribe":
      if (msg.channel) {
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

import { describe, it, expect, vi, beforeAll, afterAll } from "vitest"

// Must be set before app/ws imports
process.env.JWT_SECRET = "test-secret"
process.env.CORS_ORIGINS = "http://localhost:5173"

import http from "node:http"
import jwt from "jsonwebtoken"
import { WebSocket } from "ws"
import app from "../src/app.js"
import { setupWebSocket, broadcast } from "../src/ws/index.js"

describe("WebSocket", () => {
  const server = http.createServer(app)
  const wss = setupWebSocket(server)
  let port: number
  const token = jwt.sign(
    { userId: "u1", tenantId: "t1", role: "Staff" },
    "test-secret"
  )

  beforeAll(() => new Promise<void>((resolve) => {
    server.listen(0, () => {
      port = (server.address() as any).port
      resolve()
    })
  }))

  afterAll(() => {
    wss.close()
    server.close()
  })

  it("connects and receives connected message", () =>
    new Promise<void>((done) => {
      const ws = new WebSocket(`ws://localhost:${port}/ws`)
      ws.on("message", (raw: Buffer) => {
        const msg = JSON.parse(raw.toString())
        expect(msg.type).toBe("connected")
        ws.close()
        done()
      })
    }))

  it("authenticates with valid token", () =>
    new Promise<void>((done) => {
      const ws = new WebSocket(`ws://localhost:${port}/ws`)
      ws.on("open", () => {
        ws.send(JSON.stringify({ type: "auth", token }))
      })
      ws.on("message", (raw: Buffer) => {
        const msg = JSON.parse(raw.toString())
        if (msg.type === "connected") return
        expect(msg.type).toBe("auth:ok")
        expect(msg.data.userId).toBe("u1")
        ws.close()
        done()
      })
    }))

  it("rejects invalid token", () =>
    new Promise<void>((done) => {
      const ws = new WebSocket(`ws://localhost:${port}/ws`)
      ws.on("open", () => {
        ws.send(JSON.stringify({ type: "auth", token: "bad" }))
      })
      let receivedError = false
      ws.on("message", (raw: Buffer) => {
        const msg = JSON.parse(raw.toString())
        if (msg.type === "connected") return
        receivedError = true
        expect(msg.type).toBe("auth:error")
        ws.close()
      })
      ws.on("close", () => {
        expect(receivedError).toBe(true)
        done()
      })
    }))

  it("ping/pong", () =>
    new Promise<void>((done) => {
      const ws = new WebSocket(`ws://localhost:${port}/ws`)
      ws.on("open", () => {
        ws.send(JSON.stringify({ type: "ping" }))
      })
      ws.on("message", (raw: Buffer) => {
        const msg = JSON.parse(raw.toString())
        if (msg.type === "connected") return
        expect(msg.type).toBe("pong")
        ws.close()
        done()
      })
    }))

  it("subscribe and broadcast to tenant", () =>
    new Promise<void>((done) => {
      const ws = new WebSocket(`ws://localhost:${port}/ws`)
      let steps: string[] = []
      ws.on("open", () => {
        ws.send(JSON.stringify({ type: "auth", token }))
      })
      ws.on("message", (raw: Buffer) => {
        const msg = JSON.parse(raw.toString())
        if (msg.type === "connected") return
        steps.push(msg.type)
        if (msg.type === "auth:ok") {
          ws.send(JSON.stringify({ type: "subscribe", channel: "tenant:t1" }))
        } else if (msg.type === "subscribed") {
          expect(msg.data.channel).toBe("tenant:t1")
          broadcast("tenant:t1", "test:event", { foo: "bar" })
        } else if (msg.type === "test:event") {
          expect(msg.data.foo).toBe("bar")
          ws.close()
          done()
        }
      })
    }))

  it("rejects subscribe to unauthorized channel", () =>
    new Promise<void>((done) => {
      const ws = new WebSocket(`ws://localhost:${port}/ws`)
      ws.on("open", () => {
        ws.send(JSON.stringify({ type: "auth", token }))
      })
      ws.on("message", (raw: Buffer) => {
        const msg = JSON.parse(raw.toString())
        if (msg.type === "connected") return
        if (msg.type === "auth:ok") {
          ws.send(JSON.stringify({ type: "subscribe", channel: "tenant:other" }))
          return
        }
        expect(msg.type).toBe("subscribe:error")
        expect(msg.data.channel).toBe("tenant:other")
        ws.close()
        done()
      })
    }))
})

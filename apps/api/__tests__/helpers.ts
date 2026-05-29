import { vi } from "vitest"

vi.hoisted(() => {
  process.env.JWT_SECRET = "test-secret"
})

import http from "http"
import type { AddressInfo } from "net"
import app from "../src/app"

export { app }

let server: http.Server | null = null
let baseUrl = ""

export async function startServer() {
  return new Promise<void>((resolve) => {
    server = http.createServer(app)
    server.listen(0, () => {
      baseUrl = `http://localhost:${(server!.address() as AddressInfo).port}`
      resolve()
    })
  })
}

export async function stopServer() {
  return new Promise<void>((resolve, reject) => {
    if (server) {
      server.close((err) => (err ? reject(err) : resolve()))
      server = null
    } else {
      resolve()
    }
  })
}

export async function request(
  method: string,
  path: string,
  opts?: { body?: unknown; token?: string }
) {
  const headers: Record<string, string> = {}
  if (opts?.token) headers["Authorization"] = `Bearer ${opts.token}`
  if (opts?.body !== undefined) headers["Content-Type"] = "application/json"

  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: opts?.body !== undefined ? JSON.stringify(opts.body) : undefined,
  })

  const body = res.headers.get("content-type")?.includes("json")
    ? await res.json()
    : await res.text()

  return { status: res.status, body }
}

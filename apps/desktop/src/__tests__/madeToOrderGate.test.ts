// SPRINT-1: before taking payment for made-to-order (untracked) items, the till checks that its
// server (hub or cloud) can record them. An older server refuses them up front, not after payment.
import { beforeEach, describe, expect, it, vi } from "vitest"

beforeEach(() => {
  vi.resetModules()
  localStorage.clear()
  localStorage.setItem("lebanonpos.api-url", "http://hub.test")
})
const health = (body: unknown) => vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(body), { status: 200 })))

describe("serverSupportsMadeToOrder", () => {
  it("a current hub/cloud (syncSchema 3) is supported", async () => {
    health({ status: "ok", syncSchema: 3 })
    expect(await (await import("../features/pos/services/sync.service")).serverSupportsMadeToOrder()).toBe(true)
  })
  it("an older hub (1.0.50: no syncSchema in its health answer) is refused", async () => {
    health({ status: "ok", timestamp: "2026-10-29T00:00:00Z" })
    expect(await (await import("../features/pos/services/sync.service")).serverSupportsMadeToOrder()).toBe(false)
  })
  it("offline: uses the last answer (supported once confirmed; refused if never confirmed)", async () => {
    const s = await import("../features/pos/services/sync.service")
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("offline") }))
    expect(await s.serverSupportsMadeToOrder()).toBe(false)
    health({ status: "ok", syncSchema: 3 })
    expect(await s.serverSupportsMadeToOrder()).toBe(true)
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("offline") }))
    expect(await s.serverSupportsMadeToOrder()).toBe(true)
  })
})

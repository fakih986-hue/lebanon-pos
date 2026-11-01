// A register on a local server whose sync token is refused asks /api/setup/auto-login for a new
// one. Found in the Phase C browser test: a server configured for ANOTHER store answered, the
// register adopted that store's token, pushed its queued offline sale into that store and pulled
// that store's data. The register must only accept a token for the store it already holds.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// The IndexedDB mirror is fire-and-forget; jsdom has no IndexedDB, so each write would fail after the
// test ended. This file tests the token, not storage: the mirror is an in-memory no-op here.
vi.mock("../features/pos/services/db", () => ({
  getAll: async () => [], getById: async () => undefined, put: async () => {}, putMany: async () => {},
  del: async () => {}, clear: async () => {}, count: async () => 0,
}))

type Sync = typeof import("../features/pos/services/sync.service")
let sync: Sync | undefined

const API = "http://127.0.0.1:3998"
const tokenFor = (tenantId: string, fresh = false) => `h.${btoa(JSON.stringify({ userId: "__admin__", tenantId, typ: "hub-local", ...(fresh ? { fresh: 1 } : {}) })).replace(/=+$/, "")}.s`
const OLD = `Bearer ${tokenFor("store-a")}` // the register's token, refused by the restarted server

function server(autoLoginTenant: string) {
  const pushes: string[] = []
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit = {}) => {
    const auth = new Headers(init.headers ?? {}).get("authorization") ?? ""
    if (String(url).endsWith("/api/setup/auto-login")) return new Response(JSON.stringify({ token: tokenFor(autoLoginTenant, true) }), { status: 200 })
    if (String(url).endsWith("/api/sync/push")) {
      pushes.push(auth)
      if (auth === OLD) return new Response("{}", { status: 401 })
      const body = JSON.parse(String(init.body))
      return new Response(JSON.stringify({ results: body.operations.map((o: any) => ({ id: o.id, status: "ok" })) }), { status: 200 })
    }
    return new Response("{}", { status: 200 })
  }))
  return pushes
}

// Each test imports a fresh sync module. Adopting a token starts background sync (a flush, then a
// full pull): wait for it while the fetch stub is still in place, then stop its timers and socket,
// so no flush, pull or fetch runs after the test.
afterEach(async () => {
  await sync?.backgroundSyncSettled()
  sync?.stopBackgroundSync()
  sync = undefined
  vi.unstubAllGlobals()
})

beforeEach(() => {
  localStorage.clear()
  vi.unstubAllGlobals()
  localStorage.setItem("lebanonpos.api-url", API)
  localStorage.setItem("lebanonpos.auth-token", tokenFor("store-a"))
  localStorage.setItem("lebanonpos.tenant-id.v1", "store-a")
})

describe("local-server token refresh", () => {
  it("a token for another store is refused: the register keeps its store and its queued work goes nowhere else", async () => {
    const pushes = server("store-b")
    vi.resetModules()
    sync = await import("../features/pos/services/sync.service")
    const op = await sync!.enqueueSyncOperation({ entity: "expense", action: "create", summary: "x", payload: { id: "e1" } })
    await sync!.flushSyncQueue()
    expect(localStorage.getItem("lebanonpos.auth-token")).toBe(tokenFor("store-a"))
    expect(sync!.getCurrentTenantId()).toBe("store-a")
    expect(pushes.length).toBeGreaterThan(0)
    expect(pushes.every((a) => a === OLD)).toBe(true) // never sent as store B
    expect(sync!.getSyncQueue().find((o) => o.id === op!.id)?.status).not.toBe("Synced") // kept, not delivered elsewhere
  })

  it("a token for the same store is adopted (the hub restarted)", async () => {
    server("store-a")
    vi.resetModules()
    sync = await import("../features/pos/services/sync.service")
    await sync!.enqueueSyncOperation({ entity: "expense", action: "create", summary: "x", payload: { id: "e2" } })
    await sync!.flushSyncQueue()
    expect(sync!.getCurrentTenantId()).toBe("store-a")
    expect(localStorage.getItem("lebanonpos.auth-token")).toBe(tokenFor("store-a", true))
    expect(sync!.getSyncQueue().every((o) => o.status === "Synced")).toBe(true)
  })
})

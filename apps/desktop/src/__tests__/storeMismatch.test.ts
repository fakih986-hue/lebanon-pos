// One store check for every token a local hub offers on its own (startup and refresh). A device
// that already holds a store never switches silently: on a mismatch nothing is sent or downloaded,
// pending work stays, and only an explicit store switch (or the hub offering this store again) ends it.
import { beforeEach, describe, expect, it, vi } from "vitest"

const API = "http://localhost:39151" // not the hub port: a hub running on this machine must not answer this test
const tokenFor = (tenantId: string, n = 0) => `h.${btoa(JSON.stringify({ userId: "__admin__", tenantId, typ: "hub-local", n })).replace(/=+$/, "")}.s`
type Call = { url: string; auth: string | null }

function hub() {
  const calls: Call[] = []
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit = {}) => {
    calls.push({ url: String(url), auth: new Headers(init.headers ?? {}).get("authorization") })
    if (String(url).includes("/api/sync/push")) {
      const body = JSON.parse(String(init.body))
      return new Response(JSON.stringify({ results: body.operations.map((o: any) => ({ id: o.id, status: "ok" })) }), { status: 200 })
    }
    return new Response(JSON.stringify({ items: [], ok: true }), { status: 200 })
  }))
  return calls
}
async function fresh() {
  vi.resetModules()
  return import("../features/pos/services/sync.service")
}
const sent = (calls: Call[]) => calls.filter((c) => c.url.includes("/api/sync/"))

beforeEach(() => {
  localStorage.clear()
  vi.unstubAllGlobals()
  localStorage.setItem("lebanonpos.api-url", API)
})

describe("tokens a local hub offers on its own", () => {
  it("a device with no store yet adopts the offered store (first setup)", async () => {
    const sync = await fresh()
    expect(sync.adoptOfferedHubToken(tokenFor("store-b"))).toBe(true)
    expect(sync.getCurrentTenantId()).toBe("store-b")
    expect(sync.getStoreMismatch()).toBeNull()
  })

  it("a device holding store A adopts a store-A token (the same store, e.g. after a restart)", async () => {
    localStorage.setItem("lebanonpos.auth-token", tokenFor("store-a"))
    const sync = await fresh()
    expect(sync.adoptOfferedHubToken(tokenFor("store-a", 1))).toBe(true)
    expect(localStorage.getItem("lebanonpos.auth-token")).toBe(tokenFor("store-a", 1))
  })

  it("a device holding store A refuses store B: token kept, mismatch recorded", async () => {
    localStorage.setItem("lebanonpos.auth-token", tokenFor("store-a"))
    localStorage.setItem("lebanonpos.tenant-id.v1", "store-a")
    const sync = await fresh()
    expect(sync.adoptOfferedHubToken(tokenFor("store-b"))).toBe(false)
    expect(localStorage.getItem("lebanonpos.auth-token")).toBe(tokenFor("store-a"))
    expect(sync.getStoreMismatch()).toMatchObject({ heldTenantId: "store-a", offeredTenantId: "store-b" })
  })

  it("a device whose token was cleared still holds its store (stored tenant id) and refuses another", async () => {
    localStorage.setItem("lebanonpos.tenant-id.v1", "store-a")
    const sync = await fresh()
    expect(sync.adoptOfferedHubToken(tokenFor("store-b"))).toBe(false)
    expect(localStorage.getItem("lebanonpos.auth-token")).toBeNull()
  })
})

describe("while paused (the hub serves another store)", () => {
  async function paused() {
    localStorage.setItem("lebanonpos.auth-token", tokenFor("store-a"))
    localStorage.setItem("lebanonpos.tenant-id.v1", "store-a")
    localStorage.setItem("lebanonpos.products.v1", JSON.stringify([{ id: 1, name: "Store A product", stock: 7 }]))
    const calls = hub()
    const sync = await fresh()
    sync.adoptOfferedHubToken(tokenFor("store-b"))
    calls.length = 0
    return { sync, calls }
  }

  it("new and pending work is kept, and nothing is sent", async () => {
    const { sync, calls } = await paused()
    const op = await sync.enqueueSyncOperation({ entity: "held-sale", action: "create", summary: "parked", payload: { id: "h1" } })
    await sync.flushSyncQueue()
    expect(sent(calls)).toEqual([])
    expect(sync.getSyncQueue().find((o) => o.id === op!.id)?.status).toBe("Pending")
  })

  it("nothing is downloaded over this store's data", async () => {
    const { sync, calls } = await paused()
    await sync.pullFromServer(true)
    await sync.pullFromServer(false)
    expect(sent(calls)).toEqual([])
    expect(JSON.parse(localStorage.getItem("lebanonpos.products.v1")!)).toEqual([{ id: 1, name: "Store A product", stock: 7 }])
  })

  it("a checkout is refused before payment, with the explanation", async () => {
    const { sync, calls } = await paused()
    const r = await sync.commitSaleToHub({ id: "s1", saleNumber: "S-1" })
    expect(r).toMatchObject({ status: "rejected" })
    expect((r as { error: string }).error).toMatch(/^STORE_MISMATCH/)
    expect(sent(calls)).toEqual([])
  })

  it("the hub offering this store again ends the pause; the kept work is then sent as store A", async () => {
    const { sync, calls } = await paused()
    const op = await sync.enqueueSyncOperation({ entity: "held-sale", action: "create", summary: "parked", payload: { id: "h2" } })
    expect(sync.adoptOfferedHubToken(tokenFor("store-a", 2))).toBe(true)
    expect(sync.getStoreMismatch()).toBeNull()
    await sync.flushSyncQueue()
    // adopting the token restarts background sync, which may own this flush: wait for it
    for (let i = 0; i < 50 && sync.getSyncQueue().find((o) => o.id === op!.id)?.status !== "Synced"; i++) await new Promise((r) => setTimeout(r, 20))
    const pushes = sent(calls).filter((c) => c.url.includes("/api/sync/push"))
    expect(pushes.length).toBeGreaterThan(0)
    expect(pushes.every((c) => c.auth === `Bearer ${tokenFor("store-a", 2)}`)).toBe(true)
    expect(sync.getSyncQueue().find((o) => o.id === op!.id)?.status).toBe("Synced")
  })

  it("an explicit store switch (clearStoreData) ends the pause", async () => {
    const { sync } = await paused()
    await sync.clearStoreData()
    expect(sync.getStoreMismatch()).toBeNull()
  })
})

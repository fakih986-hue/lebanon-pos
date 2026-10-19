// AUTH-SUBDOMAIN — on the multi-store cloud a PIN reset in the owner portal must unlock the
// register. The server answers 400 "Store subdomain is required" to a bare PIN; the lock screen
// must name the store the device connected to. Reproduces the live failure (2026-10-19): the
// subdomain lived only in the known-stores list, the settings pulled from the server carry none.
import { beforeEach, describe, expect, it, vi } from "vitest"

const API = "https://pos.example.test"
const ADMIN = { id: "u-admin", name: "Admin", role: "Admin", tenantId: "t-fakih", tenantName: "fakih", pinVersion: 8 }

/** A multi-store server: needs the subdomain, accepts PIN 1111 for store "fakih" only. */
function cloud() {
  const calls: Array<Record<string, unknown>> = []
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    if (!String(url).endsWith("/api/auth/login")) return new Response("{}", { status: 404 })
    const body = JSON.parse(String(init?.body ?? "{}"))
    calls.push(body)
    if (!body.tenantSubdomain) return new Response(JSON.stringify({ error: "Store subdomain is required" }), { status: 400 })
    if (String(body.tenantSubdomain).trim().toLowerCase() === "fakih" && body.pin === "1111") return new Response(JSON.stringify({ token: "t", user: ADMIN }), { status: 200 })
    return new Response(JSON.stringify({ error: "Invalid credentials" }), { status: 401 })
  }))
  return calls
}
function connectedDevice() {
  // As production leaves a device after Connect + pull: server URL, known store, settings without a
  // subdomain, and the admin's server-side (bcrypt) PIN with an older version than the reset.
  localStorage.setItem("lebanonpos.api-url", API)
  localStorage.setItem("lebanonpos.known-stores.v1", JSON.stringify([{ name: "fakih", apiUrl: API, subdomain: "fakih" }]))
  localStorage.setItem("lebanonpos.settings.v1", JSON.stringify({ tenantId: "t-fakih", storeName: "fakih" }))
  localStorage.setItem("lebanonpos.users.v1", JSON.stringify([{ id: "u-admin", name: "Admin", role: "Admin", pin: "$2a$12$serverhash", pinVersion: 7, active: true, permissions: [], createdAt: "2026-01-01T00:00:00.000Z" }]))
}

beforeEach(() => {
  vi.restoreAllMocks()
  vi.resetModules()
  localStorage.clear()
})

describe("unlock on the multi-store cloud after an owner-portal PIN reset", () => {
  it("a device connected before the fix (known store only) names its store and unlocks", async () => {
    const calls = cloud()
    connectedDevice()
    const security = await import("../features/pos/services/security.service")
    const user = await security.unlockWithPin("1111")
    expect(calls.at(-1)).toMatchObject({ pin: "1111", tenantSubdomain: "fakih" })
    expect(user?.id).toBe("u-admin")
  })

  it("Connect records the store; unlock uses it even with several stores known for the server", async () => {
    const calls = cloud()
    connectedDevice()
    localStorage.setItem("lebanonpos.known-stores.v1", JSON.stringify([{ name: "fakih", apiUrl: API, subdomain: "fakih" }, { name: "other", apiUrl: API, subdomain: "other" }]))
    const sync = await import("../features/pos/services/sync.service")
    sync.setStoreSubdomain(" Fakih ")
    const security = await import("../features/pos/services/security.service")
    expect((await security.unlockWithPin("1111"))?.id).toBe("u-admin")
    expect(calls.at(-1)?.tenantSubdomain).toBe("fakih")
  })

  it("the wrong PIN is still refused by the server", async () => {
    cloud()
    connectedDevice()
    const security = await import("../features/pos/services/security.service")
    expect(await security.unlockWithPin("9999")).toBeNull()
  })
})

// SPRINT-2 Phase C (till, observe mode): per-person staff sessions on an enrolled register. The
// connection token never changes; each person gets their own session only after the server checks
// THEIR PIN; switching drops the previous session; every operation keeps the evidence it was
// created under, even when it is pushed later by someone else.
import { beforeEach, describe, expect, it, vi } from "vitest"

const USERS = "lebanonpos.users.v1"
const API = "http://hub.test"
type Call = { url: string; headers: Record<string, string>; body: any }

async function seed(users: Array<Record<string, unknown>>) {
  const { hashPin } = await import("../features/pos/services/security.service")
  const rows = await Promise.all(users.map(async (u) => ({ permissions: [], active: true, pinVersion: 1, lastVerifiedPinVersion: 1, ...u, pin: await hashPin(String(u.pin)) })))
  localStorage.setItem(USERS, JSON.stringify(rows))
}

/** A server that accepts PINs 1111 (owner), 2222 (rana), 3333 (sami); `down` simulates no network. */
function server(opts: { down?: boolean; enrolledOk?: boolean } = {}) {
  const calls: Call[] = []
  const ids: Record<string, { id: string; name: string }> = { "1111": { id: "owner", name: "Owner" }, "2222": { id: "rana", name: "Rana" }, "3333": { id: "sami", name: "Sami" } }
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit = {}) => {
    if (opts.down) throw new TypeError("Failed to fetch")
    const headers = Object.fromEntries(new Headers(init.headers ?? {}).entries())
    const body = init.body ? JSON.parse(String(init.body)) : null
    calls.push({ url: String(url), headers, body })
    const ok = (b: unknown) => new Response(JSON.stringify(b), { status: 200 })
    if (String(url).endsWith("/api/auth/login")) {
      const u = ids[body.pin]
      return u ? ok({ token: `conn-${u.id}`, user: { ...u, pinVersion: 1 } }) : new Response("{}", { status: 401 })
    }
    if (String(url).endsWith("/api/auth/staff-session")) {
      if (opts.enrolledOk === false) return new Response(JSON.stringify({ code: "DEVICE_NOT_ENROLLED" }), { status: 401 })
      const u = ids[body.pin]
      return ok({ session: `S-${u.id}-${calls.length}`, sessionId: `sid-${calls.length}`, authTime: "2026-10-31T08:00:00.000Z", expiresAt: "2026-10-31T20:00:00.000Z", staff: u })
    }
    if (String(url).endsWith("/api/sync/push")) return ok({ results: (body.operations as any[]).map((o) => ({ id: o.id, status: "ok" })) })
    return ok({ ok: true })
  }))
  return calls
}

async function fresh() {
  vi.resetModules()
  const sec = await import("../features/pos/services/security.service")
  const sync = await import("../features/pos/services/sync.service")
  const cred = await import("../features/pos/lib/deviceCredentials")
  return { sec, sync, cred }
}
const enroll = (cred: typeof import("../features/pos/lib/deviceCredentials"), apiUrl = API) =>
  cred.setDeviceEnrollment({ credential: "DEVICE-CRED", enrolledDeviceId: "dev-1", tenantId: "t1", apiUrl, enrolledAt: "2026-10-31T07:00:00.000Z" })

beforeEach(async () => {
  localStorage.clear()
  vi.unstubAllGlobals()
  localStorage.setItem("lebanonpos.api-url", API)
  localStorage.setItem("lebanonpos.auth-token", "conn-owner") // the register was connected with the owner's PIN
  await seed([{ id: "owner", name: "Owner", role: "Admin", pin: "1111" }, { id: "rana", name: "Rana", role: "Cashier", pin: "2222" }, { id: "sami", name: "Sami", role: "Manager", pin: "3333" }])
})

describe("staff sessions on an enrolled register", () => {
  it("an online unlock opens a session for THAT person with the device credential; the connection token is not changed", async () => {
    const calls = server()
    const { sec, cred } = await fresh()
    enroll(cred)
    expect((await sec.unlockWithPin("2222"))?.id).toBe("rana")
    const open = calls.find((c) => c.url.endsWith("/api/auth/staff-session"))!
    expect([open.headers["x-device-credential"], open.body.staffId, open.body.pin]).toEqual(["DEVICE-CRED", "rana", "2222"])
    expect(cred.getStaffSession()?.staffId).toBe("rana")
    expect(localStorage.getItem("lebanonpos.auth-token")).toBe("conn-owner")
  })

  it("a register that is not enrolled opens no session (and sends no PIN to the session endpoint)", async () => {
    const calls = server()
    const { sec, cred } = await fresh()
    await sec.unlockWithPin("2222")
    expect(calls.some((c) => c.url.endsWith("/api/auth/staff-session"))).toBe(false)
    expect(cred.captureEnvelope(API)).toEqual({ v: 1 })
  })

  it("locking drops the session; the next person needs their own PIN and gets their own session", async () => {
    server()
    const { sec, cred } = await fresh()
    enroll(cred)
    await sec.unlockWithPin("2222")
    const ranaSession = cred.getStaffSession()!.session
    sec.lockSession()
    expect(cred.getStaffSession()).toBeNull()
    expect(cred.captureEnvelope(API)).toBeUndefined() // locked: nobody's evidence
    await sec.unlockWithPin("3333")
    expect(cred.getStaffSession()?.staffId).toBe("sami")
    expect(cred.getStaffSession()?.session).not.toBe(ranaSession)
  })

  it("switching the operator without a PIN (setCurrentUser) carries no session", async () => {
    server()
    const { sec, cred } = await fresh()
    enroll(cred)
    await sec.unlockWithPin("2222")
    sec.setCurrentUser("sami")
    expect(cred.getStaffSession()).toBeNull()
    expect(cred.captureEnvelope(API)).toBeUndefined()
  })

  it("an unlock by the register's own verifier (server unreachable) is marked as a local PIN, without a session", async () => {
    server({ down: true })
    const { sec, cred } = await fresh()
    enroll(cred)
    expect((await sec.unlockWithPin("2222"))?.id).toBe("rana")
    expect(cred.getStaffSession()).toBeNull()
    expect(cred.captureEnvelope(API)).toEqual({ v: 1, offline: true })
  })

  it("a revoked device: the session request is refused and the register shows it must be enrolled again", async () => {
    server({ enrolledOk: false })
    const { sec, cred } = await fresh()
    enroll(cred)
    expect((await sec.unlockWithPin("2222"))?.id).toBe("rana") // the unlock itself is not blocked
    expect(cred.getDeviceEnrollment()?.revoked).toBe(true)
    expect(cred.deviceCredentialFor(API)).toBeNull()
  })
})

describe("operations keep the evidence they were created under", () => {
  it("Rana's queued work is pushed later (after Sami signed in) still carrying Rana's session; each push sends the device credential separately from the connection token", async () => {
    const calls = server()
    const { sec, sync, cred } = await fresh()
    enroll(cred)
    await sec.unlockWithPin("2222")
    const ranaSession = cred.getStaffSession()!.session
    localStorage.removeItem("lebanonpos.auth-token") // offline-ish: queued, not written through
    const a = await sync.enqueueSyncOperation({ entity: "expense", action: "create", summary: "Rana's expense", payload: { id: "e1" } })
    sec.lockSession()
    await sec.unlockWithPin("3333")
    const samiSession = cred.getStaffSession()!.session
    const b = await sync.enqueueSyncOperation({ entity: "expense", action: "create", summary: "Sami's expense", payload: { id: "e2" } })
    localStorage.setItem("lebanonpos.auth-token", "conn-owner")
    await sync.flushSyncQueue()
    const push = calls.filter((c) => c.url.endsWith("/api/sync/push")).pop()!
    const sent = Object.fromEntries((push.body.operations as any[]).map((o) => [o.id, o.ev]))
    expect(sent[a!.id]).toEqual({ v: 1, session: ranaSession })
    expect(sent[b!.id]).toEqual({ v: 1, session: samiSession })
    expect(push.headers.authorization).toBe("Bearer conn-owner")
    expect(push.headers["x-device-credential"]).toBe("DEVICE-CRED")
  })

  it("the device credential is only sent to the server that issued it", async () => {
    const calls = server()
    const { sec, sync, cred } = await fresh()
    enroll(cred, "http://other-hub.test")
    await sec.unlockWithPin("2222")
    await sync.enqueueSyncOperation({ entity: "expense", action: "create", summary: "x", payload: { id: "e3" } })
    await sync.flushSyncQueue()
    const pushes = calls.filter((c) => c.url.endsWith("/api/sync/push"))
    expect(pushes.length).toBeGreaterThan(0)
    expect(pushes.every((p) => p.headers["x-device-credential"] === undefined)).toBe(true)
  })

  it("completed offline work stays queued with its local-PIN evidence (never dropped for lacking a session)", async () => {
    server({ down: true })
    const { sec, sync, cred } = await fresh()
    enroll(cred)
    await sec.unlockWithPin("2222")
    const op = await sync.enqueueSyncOperation({ entity: "expense", action: "create", summary: "offline", payload: { id: "e4" } })
    await sync.flushSyncQueue()
    const kept = sync.getSyncQueue().find((o) => o.id === op!.id)
    expect(kept?.ev).toEqual({ v: 1, offline: true })
    expect(kept?.status).not.toBe("Synced")
  })
})

describe("enforce-checkout on the register: stop before payment, never block offline work", () => {
  const gate = async () => (await import("../features/pos/services/deviceSession.service")).checkoutIdentityGate()
  it("the store's mode comes from the server's status; observe never blocks", async () => {
    server()
    const { sec, sync, cred } = await fresh()
    await sec.unlockWithPin("2222") // not enrolled: no session
    expect(await gate()).toBeNull()
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ suspended: false, staffSessionMode: "enforce-checkout" }), { status: 200 })))
    await sync.checkTenantStatus()
    expect(cred.getStoreIdentityMode()).toBe("enforce-checkout")
    expect(await gate()).toBe("not-enrolled")
  })

  it("enforcing: a server-checked session sells; an enrolled register without one must sign in again", async () => {
    server()
    const { sec, cred } = await fresh()
    enroll(cred)
    cred.setStoreIdentityMode("enforce-checkout")
    await sec.unlockWithPin("2222")
    expect(await gate()).toBeNull()
    cred.setStaffSession(null) // e.g. the session request failed
    expect(await gate()).toBe("sign-in-again")
  })

  it("enforcing: signed in with the register's own PIN — sells while the server is unreachable, must sign in again once it is back", async () => {
    server({ down: true })
    const { sec, cred } = await fresh()
    enroll(cred)
    cred.setStoreIdentityMode("enforce-checkout")
    await sec.unlockWithPin("2222")
    expect(await gate()).toBeNull() // offline sale: allowed, recorded as offline-claimed
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 200 })))
    expect(await gate()).toBe("sign-in-again")
  })
})

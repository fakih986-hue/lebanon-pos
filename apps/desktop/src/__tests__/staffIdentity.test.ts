// CONTAINMENT (till): the acting staff member is the person who unlocked — never a fallback to
// "the first active user" — and a PIN shared by several people is refused, online and offline.
import { beforeEach, describe, expect, it, vi } from "vitest"

const USERS = "lebanonpos.users.v1"
const CURRENT = "lebanonpos.current-user.v1"

async function freshModules() {
  vi.resetModules()
  return import("../features/pos/services/security.service")
}
async function seed(users: Array<Record<string, unknown>>) {
  const { hashPin } = await import("../features/pos/services/security.service")
  const rows = await Promise.all(users.map(async (u) => ({ permissions: [], active: true, pinVersion: 1, lastVerifiedPinVersion: 1, ...u, pin: await hashPin(String(u.pin)) })))
  localStorage.setItem(USERS, JSON.stringify(rows))
}

beforeEach(() => {
  localStorage.clear()
  vi.unstubAllGlobals()
})

describe("current staff member", () => {
  it("a deactivated current user means nobody is signed in — not the first active user", async () => {
    await seed([{ id: "owner", name: "Owner", role: "Admin", pin: "1111" }, { id: "rana", name: "Rana", role: "Cashier", pin: "2222", active: false }])
    localStorage.setItem(CURRENT, "rana")
    const s = await freshModules()
    expect(s.getCurrentUser()).toBeNull()
    expect(() => s.requireCurrentUser()).toThrow(/No staff member is signed in/)
  })
  it("no current user recorded: nobody, not users[0]", async () => {
    await seed([{ id: "owner", name: "Owner", role: "Admin", pin: "1111" }])
    const s = await freshModules()
    expect(s.getCurrentUser()).toBeNull()
  })
})

describe("ambiguous PIN", () => {
  it("offline: two people with the same PIN are refused, never resolved to the higher role", async () => {
    await seed([{ id: "owner", name: "Owner", role: "Admin", pin: "4444" }, { id: "rana", name: "Rana", role: "Cashier", pin: "4444" }])
    const s = await freshModules()
    expect(await s.unlockWithPin("4444")).toBeNull()
    expect(s.getLastUnlockProblem()).toBe("ambiguous")
    expect(localStorage.getItem(CURRENT)).toBeNull()
  })
  it("offline: a unique PIN still unlocks", async () => {
    await seed([{ id: "owner", name: "Owner", role: "Admin", pin: "4444" }, { id: "rana", name: "Rana", role: "Cashier", pin: "5555" }])
    const s = await freshModules()
    expect((await s.unlockWithPin("5555"))?.id).toBe("rana")
    expect(s.getLastUnlockProblem()).toBeNull()
  })
  it("online: the server's ambiguity answer (409) is refused — no fall back to a local match", async () => {
    await seed([{ id: "owner", name: "Owner", role: "Admin", pin: "4444" }, { id: "rana", name: "Rana", role: "Cashier", pin: "6666" }])
    localStorage.setItem("lebanonpos.api-url", "http://hub.test")
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "ambiguous", code: "AMBIGUOUS_PIN" }), { status: 409 })))
    const s = await freshModules()
    // the local verifier alone would match Owner; the server said the PIN is shared — refused
    expect(await s.unlockWithPin("4444")).toBeNull()
    expect(s.getLastUnlockProblem()).toBe("ambiguous")
  })
})

// STAFF-AUTH (device side): an ordinary staff edit never sends authentication fields; a PIN change
// is its own operation naming the PIN version it was made on, and this device keeps accepting the
// new PIN offline.
import { beforeEach, describe, expect, it, vi } from "vitest"

const USERS = "lebanonpos.users.v1"
const QUEUE = "lebanonpos.sync-queue.v1"
const staffOps = () => (JSON.parse(localStorage.getItem(QUEUE) ?? "[]") as Array<{ entity: string; action: string; payload: Record<string, unknown> }>).filter((o) => o.entity === "staff")

beforeEach(() => {
  vi.resetModules()
  localStorage.clear()
  vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("offline in this test"))))
  localStorage.setItem(USERS, JSON.stringify([
    { id: "u-owner", name: "Owner", role: "Admin", pin: "HASH-OWNER", active: true, permissions: [], createdAt: "2026-01-01T00:00:00.000Z" },
    { id: "u-cash", name: "Rami", mobile: "70", role: "Cashier", pin: "$2a$12$serverhash", pinVersion: 3, lastVerifiedPinVersion: 3, roleVersion: 5, tokenVersion: 7, active: true, permissions: [], createdAt: "2026-01-01T00:00:00.000Z" },
  ]))
  localStorage.setItem("lebanonpos.current-user.v1", "u-owner")
})

describe("staff sync payloads", () => {
  it("a rename sends profile only, with the access version of its copy", async () => {
    const s = await import("../features/pos/services/security.service")
    await s.updateUser("u-cash", { name: "Rami K." })
    const [op] = staffOps()
    expect(op).toMatchObject({ action: "update", payload: { id: "u-cash", name: "Rami K.", roleVersion: 5 } })
    for (const k of ["pin", "pinVersion", "lastVerifiedPinVersion", "tokenVersion", "pinChanged"]) expect(op.payload).not.toHaveProperty(k)
  })

  it("a role change sends the version it was made on; a second change before syncing builds on it", async () => {
    const s = await import("../features/pos/services/security.service")
    await s.updateUser("u-cash", { role: "Manager" })
    await s.updateUser("u-cash", { active: false })
    const ops = staffOps()
    expect(ops.map((o) => o.payload.roleVersion).sort()).toEqual([5, 6]) // the queue is stored newest first
  })

  it("a PIN change is its own operation on the current PIN version; the new PIN unlocks offline here", async () => {
    const s = await import("../features/pos/services/security.service")
    await s.updateUser("u-cash", { pin: "8642" })
    const ops = staffOps()
    expect(ops).toHaveLength(1) // no profile update for a PIN-only change
    expect(ops[0]).toMatchObject({ action: "pin", payload: { id: "u-cash", basePinVersion: 3 } })
    expect(typeof ops[0].payload.pin).toBe("string")
    const unlocked = await s.unlockWithPin("8642") // offline (fetch rejects): local check
    expect(unlocked?.id).toBe("u-cash")
  })
})

describe("the store's admin (device side)", () => {
  it("cannot be demoted or deactivated here; nothing is queued", async () => {
    const s = await import("../features/pos/services/security.service")
    await expect(s.updateUser("u-owner", { role: "Manager" })).rejects.toThrow(/^LAST_ADMIN:/)
    await expect(s.updateUser("u-owner", { active: false })).rejects.toThrow(/^LAST_ADMIN:/)
    expect(staffOps()).toEqual([])
    expect(s.getUsers().find((u) => u.id === "u-owner")).toMatchObject({ role: "Admin", active: true })
  })

  it("a rename sends no access fields, so an outdated role in the copy never travels", async () => {
    const s = await import("../features/pos/services/security.service")
    await s.updateUser("u-cash", { name: "Rami K." })
    const [op] = staffOps()
    for (const k of ["role", "permissions", "active"]) expect(op.payload).not.toHaveProperty(k)
  })
})

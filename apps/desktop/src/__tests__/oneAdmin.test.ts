// One active admin per store: a second admin cannot be created, promoted or reactivated.
import { beforeEach, describe, expect, it, vi } from "vitest"

const USERS = "lebanonpos.users.v1"
beforeEach(() => {
  vi.resetModules()
  localStorage.clear()
  vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("offline in this test"))))
  localStorage.setItem(USERS, JSON.stringify([
    { id: "u-owner", name: "Owner", role: "Admin", pin: "HASH-1", active: true, permissions: [], createdAt: "2026-01-01T00:00:00.000Z" },
    { id: "u-mgr", name: "Maya", role: "Manager", pin: "HASH-2", active: true, permissions: [], createdAt: "2026-01-01T00:00:00.000Z" },
    { id: "u-old", name: "Former", role: "Admin", pin: "HASH-3", active: false, permissions: [], createdAt: "2026-01-01T00:00:00.000Z" },
  ]))
  localStorage.setItem("lebanonpos.current-user.v1", "u-owner")
})

describe("one active admin per store", () => {
  it("refuses creating, promoting or reactivating a second admin; Manager stays possible", async () => {
    const s = await import("../features/pos/services/security.service")
    expect(s.otherActiveAdmin()?.name).toBe("Owner")
    await expect(s.createUser({ name: "New", mobile: "1", pin: "5555", role: "Admin" })).rejects.toThrow(/ONE_ADMIN/)
    await expect(s.updateUser("u-mgr", { role: "Admin" })).rejects.toThrow(/ONE_ADMIN/)
    await expect(s.updateUser("u-old", { active: true })).rejects.toThrow(/ONE_ADMIN/)
    await s.createUser({ name: "New manager", mobile: "2", pin: "6666", role: "Manager" })
    await s.updateUser("u-owner", { name: "Owner (renamed)" }) // the admin itself can still be edited
    const users = JSON.parse(localStorage.getItem(USERS) ?? "[]") as Array<{ role: string; active: boolean }>
    expect(users.filter((u) => u.role === "Admin" && u.active)).toHaveLength(1)
  })
})

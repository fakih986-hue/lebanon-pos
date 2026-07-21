import { describe, it, expect, vi } from "vitest"

// POS-PERMISSIONS-1 — model + guardrails (pure functions).
vi.mock("../features/pos/services/sync.service", () => ({
  enqueueSyncOperation: vi.fn(),
  getApiUrl: () => "",
  isSuspensionGracePeriodExpired: () => false,
  assertCanWrite: () => {},
  getDeviceId: () => "dev",
}))

import {
  userCan,
  effectivePermissions,
  expandLegacyPermissions,
  permissionsDiff,
  isFullAdmin,
  wouldOrphanAdmin,
  grantablePermissions,
  rolePermissions,
  ALL_PERMISSIONS,
  type StaffUser,
  type Permission,
} from "../features/pos/services/security.service"

const u = (over: Partial<StaffUser>): StaffUser => ({
  id: "u", name: "U", mobile: "", pin: "x", role: "Cashier",
  active: true, createdAt: "", pinChanged: true, ...over,
})

describe("userCan / effectivePermissions", () => {
  it("uses the explicit permission set when present", () => {
    const user = u({ role: "Cashier", permissions: ["sales.refund"] })
    expect(userCan("sales.refund", user)).toBe(true)
    expect(userCan("sales.void", user)).toBe(false)
    expect(userCan("sales.checkout", user)).toBe(false) // explicit set overrides role
  })

  it("falls back to the role preset when there is no explicit set", () => {
    const admin = u({ role: "Admin", permissions: undefined })
    expect(userCan("settings.manage", admin)).toBe(true)
    const cashier = u({ role: "Cashier", permissions: [] })
    expect(userCan("sales.checkout", cashier)).toBe(true)
    expect(userCan("sales.refund", cashier)).toBe(false)
  })

  it("effectivePermissions expands + returns the right base", () => {
    expect(effectivePermissions(u({ role: "Admin", permissions: undefined })))
      .toEqual(expect.arrayContaining(ALL_PERMISSIONS))
    expect(effectivePermissions(null)).toEqual([])
  })
})

describe("expandLegacyPermissions", () => {
  it("expands coarse inventory.manage into the granular gates", () => {
    const out = expandLegacyPermissions(["inventory.manage"] as Permission[])
    expect(out).toEqual(expect.arrayContaining(["inventory.manage", "inventory.view", "inventory.receive", "inventory.adjust"]))
  })
  it("expands coarse accounting.manage into suppliers + cash", () => {
    const out = expandLegacyPermissions(["accounting.manage"] as Permission[])
    expect(out).toEqual(expect.arrayContaining(["accounting.manage", "suppliers.manage", "cash.manage"]))
  })
  it("is idempotent for already-granular sets", () => {
    const input: Permission[] = ["sales.checkout", "inventory.view"]
    expect(expandLegacyPermissions(input).sort()).toEqual([...input].sort())
  })
})

describe("role presets", () => {
  it("Admin preset is the full catalog", () => {
    expect(rolePermissions.Admin).toEqual(ALL_PERMISSIONS)
  })
  it("Manager lacks staff + settings but keeps the rest", () => {
    expect(rolePermissions.Manager).not.toContain("staff.manage")
    expect(rolePermissions.Manager).not.toContain("settings.manage")
    expect(rolePermissions.Manager).toContain("cash.manage")
  })
  it("Cashier is checkout-focused", () => {
    expect(rolePermissions.Cashier).toContain("sales.checkout")
    expect(rolePermissions.Cashier).not.toContain("sales.refund")
  })
})

describe("isFullAdmin / wouldOrphanAdmin", () => {
  const fullAdmin = (id: string) => u({ id, permissions: ["staff.manage", "settings.manage", "sales.checkout"] })

  it("isFullAdmin requires both admin perms + active", () => {
    expect(isFullAdmin(fullAdmin("a"))).toBe(true)
    expect(isFullAdmin(u({ permissions: ["staff.manage"] }))).toBe(false)
    expect(isFullAdmin(u({ permissions: ["staff.manage", "settings.manage"], active: false }))).toBe(false)
  })

  it("blocks a change that would remove the last full admin", () => {
    const users = [fullAdmin("a"), u({ id: "b", permissions: ["sales.checkout"] })]
    // stripping admin from the only admin → would orphan
    expect(wouldOrphanAdmin({ userId: "a", permissions: ["sales.checkout"] }, users)).toBe(true)
    // disabling the only admin → would orphan
    expect(wouldOrphanAdmin({ userId: "a", active: false }, users)).toBe(true)
  })

  it("allows the change when another full admin remains", () => {
    const users = [fullAdmin("a"), fullAdmin("b")]
    expect(wouldOrphanAdmin({ userId: "a", permissions: ["sales.checkout"] }, users)).toBe(false)
  })

  it("does not block when there were no admins to begin with (bootstrap)", () => {
    const users = [u({ id: "a", permissions: ["sales.checkout"] })]
    expect(wouldOrphanAdmin({ userId: "a", permissions: [] }, users)).toBe(false)
  })
})

describe("grantablePermissions / permissionsDiff", () => {
  it("grantable = the editor's own effective set", () => {
    const manager = u({ role: "Manager", permissions: rolePermissions.Manager })
    const g = grantablePermissions(manager)
    expect(g).toContain("cash.manage")
    expect(g).not.toContain("staff.manage") // a manager can't grant admin powers
  })

  it("permissionsDiff reports added/removed", () => {
    const d = permissionsDiff(["sales.checkout", "sales.void"], ["sales.checkout", "sales.refund"])
    expect(d.added).toEqual(["sales.refund"])
    expect(d.removed).toEqual(["sales.void"])
  })
})

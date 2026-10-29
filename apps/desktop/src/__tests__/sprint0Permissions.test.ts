// SPRINT-0 (device side): catalogue edits, selling at cost and cost visibility are enforced by the
// services themselves (not only by hidden buttons), and the new reports.cost permission keeps
// existing managers' access while a Cashier does not get it.
import { beforeEach, describe, expect, it, vi } from "vitest"

const USERS = "lebanonpos.users.v1"
function signIn(role: "Manager" | "Cashier", permissions: string[] = []) {
  localStorage.setItem(USERS, JSON.stringify([{ id: `u-${role}`, name: role, role, pin: "x", active: true, permissions, createdAt: "2026-01-01T00:00:00.000Z" }]))
  localStorage.setItem("lebanonpos.current-user.v1", `u-${role}`)
}

beforeEach(() => {
  vi.resetModules()
  localStorage.clear()
  vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("offline in this test"))))
})

describe("reports.cost", () => {
  it("a Cashier (preset) cannot see cost; a Manager (preset) can", async () => {
    const s = await import("../features/pos/services/security.service")
    signIn("Cashier"); expect(s.userCan("reports.cost")).toBe(false)
    signIn("Manager"); expect(s.userCan("reports.cost")).toBe(true)
  })
  it("an explicit set saved before reports.cost existed keeps cost visibility when it has reports.view", async () => {
    const s = await import("../features/pos/services/security.service")
    signIn("Manager", ["sales.checkout", "reports.view"]); expect(s.userCan("reports.cost")).toBe(true)
    signIn("Cashier", ["sales.checkout", "inventory.view"]); expect(s.userCan("reports.cost")).toBe(false)
  })
})

describe("catalogue services enforce permissions", () => {
  it("a Cashier cannot create or edit a product through the service", async () => {
    signIn("Manager")
    const p = await import("../features/pos/services/product.service")
    const made = p.createProduct({ name: "Pepsi", barcode: "111", price: 1, cost: 0.5, stock: 0, category: "Drinks" } as Parameters<typeof p.createProduct>[0])
    expect(made).toBeDefined()
    signIn("Cashier")
    expect(() => p.createProduct({ name: "Chips", barcode: "222", price: 1, cost: 0.4, stock: 0, category: "Snacks" } as Parameters<typeof p.createProduct>[0])).toThrow(/permission/i)
    expect(() => p.updateProduct(made!.id, { price: 0.1 })).toThrow(/permission/i)
    expect(p.getProductsSync().find((x) => x.id === made!.id)?.price).toBe(1)
  })
  it("a Manager can edit a product's price", async () => {
    signIn("Manager")
    const p = await import("../features/pos/services/product.service")
    const made = p.createProduct({ name: "Water", barcode: "333", price: 0.5, cost: 0.2, stock: 0, category: "Drinks" } as Parameters<typeof p.createProduct>[0])
    expect(p.updateProduct(made!.id, { price: 0.75 })).toBeDefined()
  })
})

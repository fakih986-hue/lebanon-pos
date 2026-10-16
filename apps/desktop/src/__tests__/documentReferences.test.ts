import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"

// RELEASE BLOCKER: document references on the till. Record ids are identities;
// sale / shift / expense / PO numbers are display references.
//  - every new reference is sequential per device and carries the device tag;
//  - a device never reissues its own reference, even after a store switch or
//    if the counter is lost (it reseeds from local records);
//  - relationships (void → debt, pulled deletions) use ids, never "the first
//    record with that number".

const read = (key: string) => JSON.parse(window.localStorage.getItem(key) ?? "[]")
const DEBTS = "lebanonpos.debt-sales.v1"
const QUEUE = "lebanonpos.sync-queue.v1"

describe("document references (desktop)", () => {
  beforeEach(() => {
    vi.resetModules()
    window.localStorage.clear()
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("network disabled in tests"))))
  })
  afterEach(() => { vi.unstubAllGlobals() })

  it("references are sequential per device, carry the device tag, and differ across devices", async () => {
    window.localStorage.setItem("lebanonpos.device-id.v1", "DEV-AAAA-7Q2K")
    let sync = await import("../features/pos/services/sync.service")
    expect([sync.nextDocumentReference("S", 6), sync.nextDocumentReference("S", 6), sync.nextDocumentReference("SHIFT", 3)]).toEqual(["S-7Q2K-000001", "S-7Q2K-000002", "SHIFT-7Q2K-001"])
    // Another device (its own storage) with its own tag.
    const counters = window.localStorage.getItem("lebanonpos.reference-seq.v1")
    window.localStorage.clear()
    window.localStorage.setItem("lebanonpos.device-id.v1", "DEV-BBBB-M3XP")
    vi.resetModules()
    sync = await import("../features/pos/services/sync.service")
    expect(sync.nextDocumentReference("S", 6)).toBe("S-M3XP-000001")
    expect(counters).toContain("S-7Q2K")
  })

  it("a store switch keeps the counter; a lost counter reseeds from local records, so a device never repeats itself", async () => {
    window.localStorage.setItem("lebanonpos.device-id.v1", "DEV-AAAA-7Q2K")
    const sync = await import("../features/pos/services/sync.service")
    sync.nextDocumentReference("S", 6)
    sync.nextDocumentReference("S", 6)
    await sync.clearStoreData()
    expect(sync.nextDocumentReference("S", 6)).toBe("S-7Q2K-000003")
    window.localStorage.removeItem("lebanonpos.reference-seq.v1")
    expect(sync.nextDocumentReference("S", 6, () => ["S-7Q2K-000041", "S-OLD-1", "S-48291177", undefined])).toBe("S-7Q2K-000042")
  })

  it("voiding a sale reverses ITS debt, not another debt sharing the sale number", async () => {
    window.localStorage.setItem("lebanonpos.users.v1", JSON.stringify([{ id: "u1", name: "Owner", role: "Admin", pin: "HASH", code: "OWN", active: true, permissions: [] }]))
    window.localStorage.setItem("lebanonpos.current-user.v1", "u1")
    const customers = await import("../features/pos/services/customer.service")
    const mine = customers.recordDebtSale({ customerId: "c-nour", saleNumber: "S-48291177", saleId: "sale-A", subtotal: 5, tax: 0, total: 5, items: [] })
    const other = customers.recordDebtSale({ customerId: "c-karim", saleNumber: "S-48291177", saleId: "sale-B", subtotal: 7, tax: 0, total: 7, items: [] })
    expect(customers.reverseDebtSale({ id: "sale-B", saleNumber: "S-48291177", customerId: "c-karim" })?.id).toBe(other.id)
    expect(read(DEBTS).map((d: any) => d.id)).toEqual([mine.id])
    // An unlinked (older) row is reversed only when it is the single match for number + customer.
    const legacy = { id: "legacy-1", customerId: "c-hadi", saleNumber: "S-11111111", subtotal: 3, tax: 0, total: 3, items: [], createdAt: "2026-01-01T00:00:00.000Z" }
    window.localStorage.setItem(DEBTS, JSON.stringify([...read(DEBTS), legacy]))
    expect(customers.reverseDebtSale({ id: "sale-X", saleNumber: "S-11111111", customerId: "c-other" })).toBeUndefined()
    expect(customers.reverseDebtSale({ id: "sale-X", saleNumber: "S-11111111", customerId: "c-hadi" })?.id).toBe("legacy-1")
  })

  it("the debt's sale link stays local: the wire payload has only the columns a hub on the previous release accepts", async () => {
    window.localStorage.setItem("lebanonpos.users.v1", JSON.stringify([{ id: "u1", name: "Owner", role: "Admin", pin: "HASH", code: "OWN", active: true, permissions: [] }]))
    window.localStorage.setItem("lebanonpos.current-user.v1", "u1")
    const customers = await import("../features/pos/services/customer.service")
    const debt = customers.recordDebtSale({ customerId: "c-nour", saleNumber: "S-7Q2K-000001", saleId: "sale-A", subtotal: 5, tax: 0, total: 5, items: [] })
    expect(read(DEBTS)[0].saleId).toBe("sale-A")
    const op = read(QUEUE).find((o: any) => o.entity === "debt" && o.payload.id === debt.id)
    expect(op.payload).not.toHaveProperty("saleId")
  })

  it("a pulled deletion with an id removes only that record, never others that share its sale number", async () => {
    const sync = await import("../features/pos/services/sync.service")
    window.localStorage.setItem(DEBTS, JSON.stringify([
      { id: "d1", customerId: "c1", saleNumber: "S-48291177", subtotal: 5, tax: 0, total: 5, items: [], createdAt: "2026-01-01T00:00:00.000Z" },
      { id: "d2", customerId: "c2", saleNumber: "S-48291177", subtotal: 7, tax: 0, total: 7, items: [], createdAt: "2026-01-01T00:00:00.000Z" },
    ]))
    sync.applyPulledDeletionsForTest([{ entity: "debt", id: "d1", saleNumber: "S-48291177" }])
    expect(read(DEBTS).map((d: any) => d.id)).toEqual(["d2"])
  })
})

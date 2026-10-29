// SPRINT-1: pulled products are merged by syncId, not by the numeric id (a device's local ids and
// the server's come from independent counters and collide). Local references follow id changes.
import { beforeEach, describe, expect, it } from "vitest"
import { mergePulledProducts, remapLocalProductIds } from "../features/pos/services/sync.service"

beforeEach(() => localStorage.clear())

describe("mergePulledProducts", () => {
  it("a local product whose id is another server product's id is not overwritten by it", () => {
    const local = [{ id: 5, syncId: "cookie", name: "House cookie" }]
    const server = [{ id: 5, syncId: "other", name: "Other till item" }, { id: 8, syncId: "cookie", name: "House cookie" }]
    const { merged, remap } = mergePulledProducts(local, server)
    expect(merged.map((p) => [p.id, p.name]).sort()).toEqual([[5, "Other till item"], [8, "House cookie"]])
    expect([...remap]).toEqual([[5, 8]])
  })

  it("a local-only product (not on the server yet) whose id is taken by a different server product gets a free id", () => {
    const local = [{ id: 6, syncId: "new-drink", name: "Matcha" }, { id: 7, syncId: "kid", name: "Kids milk", parentId: 6 }]
    const server = [{ id: 6, syncId: "someone-else", name: "Server product" }]
    const { merged, remap } = mergePulledProducts(local, server)
    const matcha = merged.find((p) => p.name === "Matcha")!
    expect(matcha.id).not.toBe(6)
    expect(remap.get(6)).toBe(matcha.id)
    expect(merged.find((p) => p.name === "Kids milk")!.parentId).toBe(matcha.id) // the variant follows its parent
    expect(merged.find((p) => p.name === "Server product")!.id).toBe(6)
  })

  it("rows without a syncId keep the by-id rule and the legacy barcode rule", () => {
    const local = [{ id: 1, name: "Legacy by id" }, { id: 2, barcode: "555", name: "Legacy by barcode" }]
    const server = [{ id: 1, name: "Legacy by id (server)" }, { id: 9, barcode: "555", name: "Legacy by barcode (server)" }]
    const { merged, remap } = mergePulledProducts(local, server)
    expect(merged.map((p) => p.name).sort()).toEqual(["Legacy by barcode (server)", "Legacy by id (server)"])
    expect([...remap]).toEqual([[2, 9]])
  })
})

describe("remapLocalProductIds", () => {
  it("rewrites lots, movements, sale/refund/held-sale lines and variant parents in one pass (swaps are safe)", () => {
    localStorage.setItem("lebanonpos.inventory-batches.v1", JSON.stringify([{ id: "lot1", productId: 5 }, { id: "lot2", productId: 8 }]))
    localStorage.setItem("lebanonpos.stock-movements.v1", JSON.stringify([{ id: "m1", productId: 5 }]))
    localStorage.setItem("lebanonpos.sales.v1", JSON.stringify([{ id: "s1", items: [{ id: 5, batchAllocations: [] }] }]))
    localStorage.setItem("lebanonpos.held-sales.v1", JSON.stringify([{ id: "h1", items: [{ id: 5, quantity: 1 }] }]))
    localStorage.setItem("lebanonpos.products.v1", JSON.stringify([{ id: 9, parentId: 5 }]))
    remapLocalProductIds(new Map([[5, 8], [8, 12]])) // 5 -> 8 and the old 8 -> 12, applied together
    expect(JSON.parse(localStorage.getItem("lebanonpos.inventory-batches.v1")!).map((l: { productId: number }) => l.productId)).toEqual([8, 12])
    expect(JSON.parse(localStorage.getItem("lebanonpos.stock-movements.v1")!)[0].productId).toBe(8)
    expect(JSON.parse(localStorage.getItem("lebanonpos.sales.v1")!)[0].items[0].id).toBe(8)
    expect(JSON.parse(localStorage.getItem("lebanonpos.held-sales.v1")!)[0].items[0].id).toBe(8)
    expect(JSON.parse(localStorage.getItem("lebanonpos.products.v1")!)[0].parentId).toBe(8)
  })
})

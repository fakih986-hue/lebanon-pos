import { describe, it, expect } from "vitest"
import { buildActionQueue, type ActionQueueInput } from "../features/pos/lib/actionQueue"

// POS-OWNER-DASHBOARD-POLISH-1
const base: ActionQueueInput = {
  outstanding: 0,
  debtCustomers: 0,
  lowStock: [],
  deadStock: [],
  operationalAlerts: [],
  fmtMoney: (n) => `$${n}`,
  fmtNum: (n) => String(n),
}

describe("POS-OWNER-DASHBOARD-POLISH-1 — buildActionQueue", () => {
  it("uses action-verb labels and correct destination links", () => {
    const q = buildActionQueue({
      ...base,
      outstanding: 100, debtCustomers: 3,
      lowStock: [{ name: "Pepsi", stock: 2, cost: 1 }],
      operationalAlerts: [{ type: "warning", message: "Sync stalled", action: "retry-sync" }],
    })
    const byKey = Object.fromEntries(q.map((i) => [i.key, i]))
    expect(byKey["debt"].label).toBe("Collect debt")
    expect(byKey["debt"].link).toBe("/customers")
    expect(byKey["low-Pepsi"].label).toBe("Restock Pepsi")
    expect(byKey["low-Pepsi"].link).toBe("/products/new")
    expect(byKey["op-Sync stalled"].label).toBe("Resolve sync issue")
    expect(byKey["op-Sync stalled"].link).toBe("/settings")
    expect(byKey["op-Sync stalled"].tag).toBe("Sync")
  })

  it("surfaces critical (danger) alerts first, above money-at-risk", () => {
    const q = buildActionQueue({
      ...base,
      outstanding: 9999, debtCustomers: 1, // large money item
      operationalAlerts: [{ type: "danger", message: "Store suspended" }],
    })
    expect(q[0].severity).toBe("critical")
    expect(q[0].label).toBe("Store suspended")
    expect(q[1].key).toBe("debt")
  })

  it("orders warn-tier items by money-at-risk descending", () => {
    const q = buildActionQueue({
      ...base,
      outstanding: 50, debtCustomers: 1,
      lowStock: [{ name: "Cheap", stock: 1, cost: 1 }], // value 1
      deadStock: [{ name: "Pricey", stock: 10, cost: 20 }], // value 200
    })
    expect(q.map((i) => i.key)).toEqual(["dead-Pricey", "debt", "low-Cheap"])
  })

  it("omits the debt item when nothing is outstanding", () => {
    const q = buildActionQueue({ ...base, outstanding: 0 })
    expect(q.find((i) => i.key === "debt")).toBeUndefined()
  })

  it("labels a zero-stock item as Out of stock", () => {
    const q = buildActionQueue({ ...base, lowStock: [{ name: "Gone", stock: 0, cost: 5 }] })
    expect(q[0].sub).toBe("Out of stock")
  })

  it("respects the limit", () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ name: `P${i}`, stock: 1, cost: 1 }))
    expect(buildActionQueue({ ...base, lowStock: many }, 8)).toHaveLength(8)
  })

  it("returns an empty queue when all is clear", () => {
    expect(buildActionQueue(base)).toEqual([])
  })
})

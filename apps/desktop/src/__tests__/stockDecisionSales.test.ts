// SPRINT-1: a held sale (the server does not know which stock setting a product was sold under)
// stays in front of a manager: it never uses up its attempts, the card shows what was paid, and the
// manager's explicit decision re-sends the SAME sale (same operation, same money) with the decision.
import { beforeEach, describe, expect, it, vi } from "vitest"

const QUEUE = "lebanonpos.sync-queue.v1"
const HELD = 'STOCK_POLICY_HELD: "Tea" was sold under a stock setting (rev-lost) this server does not know yet. The sale is kept and retried; nothing was applied.'
const sale = {
  id: "sale-1", saleNumber: "S-HELD-1", paymentMethod: "Cash", total: 3, cashier: "Rana", createdAt: "2026-10-29T10:00:00.000Z",
  tender: { currency: "USD", paidUsd: 5, changeUsd: 2 },
  items: [
    { id: 7, name: "Tea", quantity: 1, unitPrice: 3, total: 3, stockPolicy: "untracked", stockPolicyRev: "rev-lost" },
    { id: 8, name: "Water", quantity: 1, unitPrice: 0, total: 0, stockPolicy: "tracked", stockPolicyRev: "initial" },
  ],
}
const op = (over: Record<string, unknown> = {}) => ({ id: "op-1", entity: "sale", action: "create", summary: "sale", payload: sale, status: "Failed", attempts: 1, createdAt: sale.createdAt, error: HELD, ...over })

beforeEach(() => {
  vi.resetModules()
  localStorage.clear()
  localStorage.setItem("lebanonpos.api-url", "http://hub.test")
  localStorage.setItem("lebanonpos.auth-token", "t")
})

describe("held sales", () => {
  it("are listed with the money already collected, the product and the revision it was sold under", async () => {
    localStorage.setItem(QUEUE, JSON.stringify([op()]))
    const { getPolicyHeldSales } = await import("../features/pos/services/sync.service")
    const [h] = getPolicyHeldSales()
    expect(h).toMatchObject({ operationId: "op-1", saleNumber: "S-HELD-1", total: 3, paymentMethod: "Cash", productName: "Tea", revision: "rev-lost", cashier: "Rana" })
    expect(h.lines.filter((l) => l.held).map((l) => l.name)).toEqual(["Tea"])
  })

  it("a held answer from the server does not use up the sale's attempts (it never silently goes dead)", async () => {
    localStorage.setItem(QUEUE, JSON.stringify([op({ status: "Pending", attempts: 4, error: undefined })]))
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ results: [{ id: "op-1", status: "error", error: HELD }] }), { status: 200 })))
    const s = await import("../features/pos/services/sync.service")
    await s.flushSyncQueue()
    const q = JSON.parse(localStorage.getItem(QUEUE)!)
    expect(q[0]).toMatchObject({ status: "Failed", attempts: 4, error: HELD })
    expect(s.getPolicyHeldSales()).toHaveLength(1)
  })

  it("a manager's decision re-sends the same operation (same sale, same total) with the decision on the held lines only", async () => {
    localStorage.setItem(QUEUE, JSON.stringify([op()]))
    localStorage.setItem("lebanonpos.sales.v1", JSON.stringify([sale]))
    const s = await import("../features/pos/services/sync.service")
    expect(s.resolvePolicyHeldSale("op-1", "tracked", "Tea bags come from stock", { id: "mgr-1", name: "Owner" })).toBe(true)
    const [q] = JSON.parse(localStorage.getItem(QUEUE)!)
    expect([q.id, q.status, q.error, q.payload.total, q.payload.id]).toEqual(["op-1", "Pending", undefined, 3, "sale-1"])
    expect(q.payload.items[0]).toMatchObject({ stockPolicy: "tracked", stockPolicyResolution: { policy: "tracked", note: "Tea bags come from stock", resolvedBy: "mgr-1", resolvedByName: "Owner" } })
    expect(q.payload.items[1].stockPolicyResolution).toBeUndefined()
    expect(JSON.parse(localStorage.getItem("lebanonpos.sales.v1")!)[0].items[0].stockPolicy).toBe("tracked")
    expect(s.getPolicyHeldSales()).toHaveLength(0)
  })

  it("only a held operation can be settled this way", async () => {
    localStorage.setItem(QUEUE, JSON.stringify([op({ error: "Server error" })]))
    const s = await import("../features/pos/services/sync.service")
    expect(s.resolvePolicyHeldSale("op-1", "untracked", "note", { id: "m", name: "M" })).toBe(false)
  })
})

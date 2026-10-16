// Receiving recovery: a delivery save that succeeds but "crashes" before the draft is cleared,
// an interrupted save whose outcome is unknown, and drafts across a store switch. A restart is
// simulated with vi.resetModules(): every service is re-imported, only localStorage survives.
import { beforeEach, describe, expect, it, vi } from "vitest"

const KEYS = {
  products: "lebanonpos.products.v1",
  batches: "lebanonpos.inventory-batches.v1",
  orders: "lebanonpos.purchase-orders.v1",
  payments: "lebanonpos.supplier-payments.v1",
  queue: "lebanonpos.sync-queue.v1",
}
const read = (k: string) => { try { return JSON.parse(localStorage.getItem(k) ?? "[]") } catch { return [] } }
/** Everything a duplicate receive would change: stock, lots, purchase orders, payments, sync ops. */
function books() {
  const products = read(KEYS.products) as Array<{ barcode: string; stock: number }>
  return {
    stock: Object.fromEntries(products.map((p) => [p.barcode, p.stock])),
    lots: (read(KEYS.batches) as Array<{ initialQuantity: number }>).map((b) => b.initialQuantity),
    orders: (read(KEYS.orders) as Array<{ total: number; items: unknown[] }>).map((o) => ({ total: o.total, items: o.items.length })),
    payments: (read(KEYS.payments) as Array<{ amount: number }>).map((p) => p.amount),
    queue: (read(KEYS.queue) as unknown[]).length,
  }
}
function token(tenantId: string) {
  const b64 = (o: object) => btoa(JSON.stringify(o)).replace(/=+$/, "")
  return `${b64({ alg: "none" })}.${b64({ tenantId })}.sig`
}

async function load() {
  const rows = await import("../features/pos/lib/receiveRows")
  const sub = await import("../features/pos/services/receiveSubmission.service")
  const sup = await import("../features/pos/services/supplier.service")
  return { ...rows, ...sub, ...sup }
}

/** The delivery as the Receive page would hold it: one good row and one the service rejects. */
async function draftDelivery() {
  const m = await load()
  const good = { ...m.createRow(), name: "Recovery Widget", barcode: "RCV-0001", category: "Test", quantity: 5, cost: 2, price: 4, mode: "new" as const, decisionConfirmed: true }
  const bad = { ...m.createRow(), name: "Zero Widget", barcode: "RCV-0002", category: "Test", quantity: 0, cost: 1, price: 2, mode: "new" as const, decisionConfirmed: true }
  return { rows: [good, bad], good, bad }
}
let CONTEXT: { supplierId: string; supplierName: string; invoiceNumber: string; paymentMethod: "Cash" }

beforeEach(async () => {
  vi.restoreAllMocks()
  vi.resetModules()
  localStorage.clear()
  localStorage.setItem("lebanonpos.users.v1", JSON.stringify([
    { id: "u-1", name: "Test Admin", mobile: "0", pin: "x", role: "Admin", active: true, createdAt: new Date().toISOString(), pinChanged: false },
  ]))
  localStorage.setItem("lebanonpos.current-user.v1", "u-1")
  const { createSupplier } = await import("../features/pos/services/supplier.service")
  const s = createSupplier({ name: "Malia Group", mobile: "01 000 000", contact: "Karim", address: "Dora", notes: "" })
  CONTEXT = { supplierId: s.id, supplierName: s.name, invoiceNumber: "INV-9", paymentMethod: "Cash" }
})

describe("receiving recovery", () => {
  it("saved, then crashed before the draft was cleared: reopening settles it and a retry writes nothing", async () => {
    let m = await load()
    const { rows, good, bad } = await draftDelivery()
    const before = books()

    // Save, exactly as the page does: the draft records the submission first, then the writes run.
    const pending = { submissionId: "receive-test-1", rowIds: rows.map((r) => r.id) }
    m.writeReceiveDraft(m.serializeDraft({ rows, supplierId: "sup-1", invoiceNumber: "INV-9", paymentMethod: "Cash", note: "", pending }))
    const summary = await m.receiveAndRecord(rows.map(m.toReceiveEntry), CONTEXT, { submissionId: pending.submissionId })

    // Results identify rows structurally, by row id.
    expect(summary.results).toEqual([
      { rowId: good.id, status: "accepted" },
      { rowId: bad.id, status: "rejected", reason: expect.stringContaining("quantity") },
    ])
    const afterSave = books()
    expect(afterSave.stock["RCV-0001"]).toBe(5)
    expect(afterSave.lots).toEqual([...before.lots, 5])
    // The purchase order and payment cover only what was received (5 x $2), not the rejected row.
    expect(afterSave.orders).toEqual([{ total: 10, items: 1 }])
    expect(afterSave.payments).toEqual([10])

    // ── crash: the page never cleared the draft. Restart. ──
    vi.resetModules()
    m = await load()
    const reopened = m.parseDraft(m.readReceiveDraftRaw())
    expect(reopened?.pending?.submissionId).toBe("receive-test-1")
    const { draft, recovery } = m.recoverReceiveDraft(reopened!)
    expect(recovery).toMatchObject({ kind: "committed", accepted: 1, rejected: 1, units: 5 })
    // The received row is gone; the rejected row stays with its reason; no save is pending any more.
    expect(draft.rows.map((r) => r.id)).toEqual([bad.id])
    expect(draft.rows[0].saveError).toContain("quantity")
    expect(draft.pending).toBeUndefined()

    // Retry the very same submission (e.g. a stale tab or a second click after restart).
    const replay = await m.receiveAndRecord(rows.map(m.toReceiveEntry), CONTEXT, { submissionId: "receive-test-1" })
    expect(replay.replayed).toBe(true)
    expect(replay.results).toEqual(summary.results)
    expect(books()).toEqual(afterSave) // no extra stock, lot, purchase order, payment or sync op
  })

  it("an interrupted save stays visible as unknown, is never resent, and waits for a person", async () => {
    let m = await load()
    const { rows } = await draftDelivery()
    const pending = { submissionId: "receive-test-2", rowIds: rows.map((r) => r.id) }
    m.writeReceiveDraft(m.serializeDraft({ rows, supplierId: "sup-1", invoiceNumber: "", paymentMethod: "On Account", note: "", pending }))

    // Storage fills up while the lots are written: products/stock are already in, lots are not.
    const setItem = Storage.prototype.setItem
    const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, k: string, v: string) {
      if (k === KEYS.batches) throw new DOMException("quota", "QuotaExceededError")
      return setItem.call(this, k, v)
    })
    await expect(m.receiveAndRecord(rows.map(m.toReceiveEntry), CONTEXT, { submissionId: "receive-test-2" }))
      .rejects.toBeInstanceOf(m.ReceiveOutcomeUnknownError)
    spy.mockRestore()
    const partial = books()
    expect(partial.stock["RCV-0001"]).toBe(5) // partly written: exactly why "nothing happened" would be wrong
    expect(partial.lots).toEqual([])

    // Restart: the draft still holds the rows, and the outcome is reported as unknown.
    vi.resetModules()
    m = await load()
    const { draft, recovery } = m.recoverReceiveDraft(m.parseDraft(m.readReceiveDraftRaw())!)
    expect(recovery).toEqual({ kind: "unknown", submissionId: "receive-test-2" })
    expect(draft.rows).toHaveLength(2)
    expect(draft.pending?.submissionId).toBe("receive-test-2")
    expect(m.getUnresolvedReceiveSubmissions().map((s) => s.id)).toEqual(["receive-test-2"])
    expect(m.getReceiveSubmission("receive-test-2")?.failure).toContain("quota")

    // A blind resend of the same submission is refused and writes nothing.
    await expect(m.receiveAndRecord(rows.map(m.toReceiveEntry), CONTEXT, { submissionId: "receive-test-2" }))
      .rejects.toBeInstanceOf(m.ReceiveOutcomeUnknownError)
    expect(books()).toEqual(partial)

    // A person checks Lots and records the decision; only then is the draft released.
    m.resolveReceiveSubmission("receive-test-2", "received")
    expect(m.getUnresolvedReceiveSubmissions()).toEqual([])
    const settled = m.recoverReceiveDraft(m.parseDraft(m.readReceiveDraftRaw())!)
    expect(settled.recovery.kind).toBe("none")
    expect(settled.draft.rows.every((r) => !rows.some((x) => x.id === r.id))).toBe(true)
    expect(settled.draft.pending).toBeUndefined()
  })

  it("a refusal before any write is not an unknown outcome", async () => {
    const m = await load()
    const { rows } = await draftDelivery()
    const before = books()
    localStorage.setItem("lebanonpos.license.v1", JSON.stringify({ status: "read_only", message: "Store is read-only." }))
    const blocked = await m.receiveAndRecord(rows.map(m.toReceiveEntry), CONTEXT, { submissionId: "receive-test-3" }).then(() => null, (e: unknown) => e)
    expect(blocked).toBeInstanceOf(Error)
    expect(blocked).not.toBeInstanceOf(m.ReceiveOutcomeUnknownError)
    expect(m.getReceiveSubmission("receive-test-3")).toBeUndefined() // nothing started, so nothing to reconcile
    expect(books()).toEqual(before)
  })

  it("drafts and submissions are isolated by the immutable tenant id across a store switch", async () => {
    let m = await load()
    const { rows } = await draftDelivery()
    localStorage.setItem("lebanonpos.auth-token", token("tenant-A"))
    m.writeReceiveDraft(m.serializeDraft({ rows, supplierId: "", invoiceNumber: "A-1", paymentMethod: "On Account", note: "" }))
    expect(m.parseDraft(m.readReceiveDraftRaw())?.invoiceNumber).toBe("A-1")

    // Switch to store B: clearStoreData wipes store data, then B's token arrives.
    const sync = await import("../features/pos/services/sync.service")
    await sync.clearStoreData()
    sync.setAuthToken(token("tenant-B"))
    vi.resetModules()
    m = await load()
    expect(m.readReceiveDraftRaw()).toBeNull() // A's delivery is not shown in, or receivable into, B
    m.writeReceiveDraft(m.serializeDraft({ rows: rows.slice(0, 1), supplierId: "", invoiceNumber: "B-1", paymentMethod: "On Account", note: "" }))
    m.beginReceiveSubmission("receive-B", ["x"])
    expect(m.getUnresolvedReceiveSubmissions().map((s) => s.id)).toEqual(["receive-B"])

    // Back to A: A's draft is intact, B's draft and B's interrupted save are not visible.
    sync.setAuthToken(token("tenant-A"))
    expect(m.parseDraft(m.readReceiveDraftRaw())?.invoiceNumber).toBe("A-1")
    expect(m.getReceiveSubmission("receive-B")).toBeUndefined()
    expect(m.getUnresolvedReceiveSubmissions()).toEqual([])

    // A store subdomain or URL never stands in for the tenant: with no tenant known the key is "unbound".
    localStorage.removeItem("lebanonpos.auth-token")
    localStorage.removeItem("lebanonpos.tenant-id.v1")
    expect(m.currentTenantKey()).toBe("unbound")
    expect(m.readReceiveDraftRaw()).toBeNull()
  })
})

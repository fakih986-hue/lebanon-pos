import { describe, it, expect, beforeAll, afterAll, vi } from "vitest"
import http from "node:http"
import type { AddressInfo } from "node:net"
import { randomUUID } from "node:crypto"
import WebSocket from "ws"

// CONTAINMENT (real Postgres, real handlers): token kinds per endpoint, permission rules for
// operations that had none, ambiguous PINs — and the legitimate ordering and driver workflows that
// must keep working. Tokens come from the real login endpoints.
process.env.JWT_SECRET = process.env.JWT_SECRET || "containment-secret"
const prisma = (await import("../src/lib/prisma.js")).default
const app = (await import("../src/app.js")).default
const { setupWebSocket, broadcastToTenant } = await import("../src/ws/index.js")
const bcrypt = (await import("bcryptjs")).default
delete process.env.IS_LOCAL_SERVER
vi.setConfig({ testTimeout: 60_000 })

const T = randomUUID()
const SUB = `ct-${T.slice(0, 8)}`
const DRIVER_CODE = `D${T.slice(0, 5)}`
let server: http.Server
let base = ""
let owner = "", cashier = "", manager = "", driver = "", customer = ""
let customerId = ""
let productId = 0
const productSyncId = randomUUID()

const call = async (method: string, path: string, body?: unknown, token?: string) => {
  const r = await fetch(`${base}${path}`, { method, headers: { "Content-Type": "application/json", "x-titan-sync-schema": "3", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) })
  return { status: r.status, body: (await r.json().catch(() => null)) as any }
}
const login = async (pin: string, extra: Record<string, unknown> = {}) => call("POST", "/api/auth/login", { pin, tenantSubdomain: SUB, ...extra })
const push = async (token: string, entity: string, action: string, payload: unknown) =>
  (await call("POST", "/api/sync/push", { deviceId: "ct-dev", operations: [{ id: randomUUID(), entity, action, payload }] }, token))

beforeAll(async () => {
  server = http.createServer(app)
  setupWebSocket(server)
  await new Promise<void>((resolve) => server.listen(0, resolve))
  base = `http://localhost:${(server.address() as AddressInfo).port}`
  await prisma.tenant.create({ data: { id: T, name: "Containment (disposable)", subdomain: SUB } })
  const mk = (name: string, pin: string, role: string, permissions: string[] = [], extra: Record<string, unknown> = {}) =>
    bcrypt.hash(pin, 12).then((h) => prisma.staffUser.create({ data: { tenantId: T, name, mobile: `ct-${name}-${T.slice(0, 6)}`, pin: h, role: role as any, permissions, ...extra } as any }))
  await mk("Owner", "5101", "Admin")
  await mk("Cashier", "5102", "Cashier", ["sales.checkout", "sales.reprint", "inventory.view"])
  await mk("Manager", "5103", "Manager", ["sales.checkout", "inventory.manage", "customers.manage"])
  await mk("Driver", "5104", "Driver", [], { code: DRIVER_CODE })
  owner = (await login("5101")).body.token
  cashier = (await login("5102")).body.token
  manager = (await login("5103")).body.token
  driver = (await call("POST", "/api/auth/login", { pin: "5104", code: DRIVER_CODE, tenantSubdomain: SUB, role: "Driver" })).body.token
  productId = (await prisma.product.create({ data: { tenantId: T, syncId: productSyncId, name: "Water", price: 1, cost: 0.2, stock: 10, category: "Drinks" } })).id
  const mobile = `7${Date.now().toString().slice(-7)}`
  expect((await call("POST", "/api/delivery/customer/signup", { tenantId: T, name: "Rami", mobile, pin: "4321" })).status).toBe(201)
  const c = await call("POST", "/api/delivery/customer/login", { tenantId: T, mobile, pin: "4321" })
  customer = c.body.token
  customerId = c.body.customer?.id ?? (await prisma.customer.findFirst({ where: { tenantId: T, mobile } }))!.id
  for (const t of [owner, cashier, manager, driver, customer]) expect(t).toBeTruthy()
})

afterAll(async () => {
  const where = { tenantId: T }
  for (const m of ["syncOperation", "syncClient", "auditEvent", "stockAdjustment", "stockMovement", "inventoryBatch", "debtPayment", "debtSale", "heldSale"] as const) await (prisma as any)[m]?.deleteMany({ where }).catch(() => undefined)
  await prisma.product.deleteMany({ where })
  await prisma.customer.deleteMany({ where })
  await prisma.staffUser.deleteMany({ where })
  await prisma.tenant.deleteMany({ where: { id: T } })
  await new Promise<void>((resolve) => server.close(() => resolve()))
  await prisma.$disconnect()
})

describe("token kinds per endpoint", () => {
  it("a driver token cannot use till sync (push, pull, status)", async () => {
    expect((await call("POST", "/api/sync/push", { deviceId: "d", operations: [] }, driver)).status).toBe(403)
    expect((await call("GET", "/api/sync/pull", undefined, driver)).status).toBe(403)
    expect((await call("GET", "/api/sync/status", undefined, driver)).status).toBe(403)
  })
  it("a customer token cannot use till sync or the hub setup endpoints", async () => {
    expect((await call("GET", "/api/sync/pull", undefined, customer)).status).toBe(401)
    expect((await call("GET", "/api/setup/tenant-info", undefined, customer)).status).toBe(403)
    expect((await call("POST", "/api/setup/pull-from-cloud", {}, customer)).status).toBe(403)
  })
  it("a driver token cannot use the hub setup endpoints", async () => {
    expect((await call("GET", "/api/setup/tenant-info", undefined, driver)).status).toBe(403)
  })
  it("store staff still sync, and still reach the setup info endpoint", async () => {
    expect((await call("GET", "/api/sync/pull", undefined, cashier)).status).toBe(200)
    expect((await call("GET", "/api/setup/tenant-info", undefined, owner)).status).not.toBe(403)
  })
  it("legitimate workflows are kept: the driver lists their orders, the customer lists theirs", async () => {
    expect((await call("GET", "/api/delivery/driver/orders", undefined, driver)).status).toBe(200)
    expect((await call("GET", "/api/delivery/customer/orders", undefined, customer)).status).toBe(200)
  })
})

describe("permission rules for operations that had none", () => {
  const adjust = () => ({ id: randomUUID(), adjustmentNumber: `ADJ-${randomUUID().slice(0, 4)}`, productId, productSyncId, productName: "Water", barcode: "", quantityBefore: 10, quantityChange: 1, quantityAfter: 11, reason: "Count Correction", valueImpact: 0.2, createdAt: new Date().toISOString() })
  it("a cashier (no inventory.adjust) cannot adjust or count stock; a manager with inventory.manage can", async () => {
    expect((await push(cashier, "inventory", "adjust", adjust())).body.results[0].status).not.toBe("ok")
    expect((await push(cashier, "inventory", "count", { id: randomUUID(), items: [] })).body.results[0].status).not.toBe("ok")
    expect((await push(manager, "inventory", "adjust", adjust())).body.results[0].status).toBe("ok")
  })
  it("a cashier cannot receive stock (inventory.receive)", async () => {
    const r = await push(cashier, "inventory", "receive", [{ id: randomUUID(), batchNumber: "LOT-CT", productId, productSyncId, productName: "Water", barcode: "", initialQuantity: 5, quantityRemaining: 5, unitCost: 0.2, unitPrice: 1, receivedAt: new Date().toISOString(), status: "Open" }])
    expect(r.body.results[0].status).not.toBe("ok")
  })
  it("a cashier cannot change customers or record a debt collection; a manager with customers.manage can update a customer", async () => {
    expect((await push(cashier, "customer", "update", { id: customerId, name: "Renamed" })).body.results[0].status).not.toBe("ok")
    expect((await push(cashier, "debt", "payment", { id: randomUUID(), customerId, amount: 5, method: "Cash", reference: "P-CT", createdAt: new Date().toISOString() })).body.results[0].status).not.toBe("ok")
    expect((await push(manager, "customer", "update", { id: customerId, name: "Rami K." })).body.results[0].status).toBe("ok")
  })
  it("refused work is kept on the server (unapplied, payload and reason), listed for managers, and applies once when resent by an allowed account", async () => {
    const op = { id: randomUUID(), entity: "inventory", action: "adjust", payload: adjust() }
    expect((await call("POST", "/api/sync/push", { deviceId: "ct-dev", operations: [op] }, cashier)).body.results[0].status).toBe("error")
    const row = await prisma.syncOperation.findUnique({ where: { id: op.id } })
    expect(row).toMatchObject({ status: "Refused", appliedAt: null })
    expect((row!.payload as any).quantityChange).toBe(1)
    expect(String(row!.error)).toMatch(/permission.*device ct-dev/)
    const list = await call("GET", "/api/sync/refused", undefined, owner)
    expect(list.body.operations.map((o: { id: string }) => o.id)).toContain(op.id)
    expect((await call("GET", "/api/sync/refused", undefined, cashier)).status).toBe(403)
    expect((await call("POST", "/api/sync/push", { deviceId: "ct-dev", operations: [op] }, manager)).body.results[0].status).toBe("ok")
    expect((await call("POST", "/api/sync/push", { deviceId: "ct-dev", operations: [op] }, manager)).body.results[0].status).toBe("ok")
    expect(await prisma.stockAdjustment.count({ where: { tenantId: T, id: op.payload.id } })).toBe(1)
    expect((await prisma.syncOperation.findUnique({ where: { id: op.id } }))!.appliedAt).toBeTruthy()
  })
  it("refused work is reviewed and resolved: apply once under the manager's authority (evidence says so), decline is final", async () => {
    // a decision is about the preview the reviewer saw (SPRINT-2 F); a decline says what happened to the money
    const resolve = async (token: string, id: string, decision: string, note = "checked on the shelf") => {
      const previewToken = ((await call("GET", "/api/sync/refused", undefined, token)).body?.operations as any[] | undefined)?.find((o) => o.id === id)?.previewToken ?? "no-preview-seen"
      return call("POST", `/api/sync/refused/${id}/resolve`, { decision, note, previewToken, ...(decision === "dismiss" ? { outcome: "nothing-to-correct" } : {}) }, token)
    }
    const applyOp = { id: randomUUID(), entity: "inventory", action: "adjust", payload: { ...adjust(), quantityChange: 3 } }
    const declineOp = { id: randomUUID(), entity: "inventory", action: "adjust", payload: { ...adjust(), quantityChange: -4 } }
    for (const op of [applyOp, declineOp]) expect((await call("POST", "/api/sync/push", { deviceId: "ct-dev", operations: [op] }, cashier)).body.results[0].status).toBe("error")
    const list = (await call("GET", "/api/sync/refused", undefined, manager)).body.operations as Array<Record<string, any>>
    const item = list.find((o) => o.id === applyOp.id)!
    expect(item).toMatchObject({ reason: "You don't have permission to adjust inventory", deviceId: "ct-dev", canResolve: true })
    expect(item.effects[0]).toMatchObject({ kind: "stock-change", change: 3 })
    const stockBefore = Number((await prisma.product.findFirst({ where: { tenantId: T, id: productId } }))!.stock)
    expect((await resolve(cashier, applyOp.id, "apply")).status).toBe(403)
    const [a, b] = await Promise.all([resolve(manager, applyOp.id, "apply"), resolve(manager, applyOp.id, "apply")])
    expect([a.status, b.status].sort()).toEqual([200, 409])
    expect(Number((await prisma.product.findFirst({ where: { tenantId: T, id: productId } }))!.stock)).toBe(stockBefore + 3)
    // The losing side of a race read the row as still Refused: the decision must still be refused.
    const staleRow = { ...(await prisma.syncOperation.findFirst({ where: { id: applyOp.id } }))!, status: "Refused", appliedAt: null }
    const stale = vi.spyOn(prisma.syncOperation, "findFirst").mockResolvedValueOnce(staleRow as any)
    expect((await resolve(manager, applyOp.id, "apply")).status).toBe(409)
    stale.mockRestore()
    expect(Number((await prisma.product.findFirst({ where: { tenantId: T, id: productId } }))!.stock)).toBe(stockBefore + 3)
    // the till's resend is acknowledged, never applied again
    expect((await call("POST", "/api/sync/push", { deviceId: "ct-dev", operations: [applyOp] }, cashier)).body.results[0].status).toBe("ok")
    expect(Number((await prisma.product.findFirst({ where: { tenantId: T, id: productId } }))!.stock)).toBe(stockBefore + 3)
    const ev = await prisma.operationEvidence.findUnique({ where: { opId: applyOp.id } })
    expect(ev!.limitations).toContain("applied-on-manager-review")
    expect(ev!.evidence).not.toBe("verified")
    expect((await resolve(manager, declineOp.id, "dismiss", "miscounted")).status).toBe(200)
    expect((await call("POST", "/api/sync/push", { deviceId: "ct-dev", operations: [declineOp] }, manager)).body.results[0]).toMatchObject({ status: "rejected" })
    // the cashier-connected till that sent it: told it was declined (not left retrying as refused)
    expect((await call("POST", "/api/sync/push", { deviceId: "ct-dev", operations: [declineOp] }, cashier)).body.results[0]).toMatchObject({ status: "rejected" })
    expect((await prisma.syncOperation.findUnique({ where: { id: declineOp.id } }))!.status).toBe("Dismissed")
    // review never shows PINs or credentials
    const secret = { id: randomUUID(), entity: "customer", action: "create", payload: { id: randomUUID(), name: "Walk-in", mobile: `ct-${randomUUID().slice(0, 6)}`, pin: "8642", nested: { sessionToken: "eyJsecret" } } }
    await call("POST", "/api/sync/push", { deviceId: "ct-dev", operations: [secret] }, cashier)
    const shown = JSON.stringify((await call("GET", "/api/sync/refused", undefined, owner)).body)
    expect(shown).toContain(secret.id)
    expect(shown).not.toMatch(/8642|eyJsecret/)
    expect(Number((await prisma.product.findFirst({ where: { tenantId: T, id: productId } }))!.stock)).toBe(stockBefore + 3)
  })
  it("a cashier can still park an order (held-sale needs sales.checkout)", async () => {
    expect((await push(cashier, "held-sale", "create", { id: randomUUID(), items: [], createdAt: new Date().toISOString() })).body.results[0].status).toBe("ok")
  })
})

describe("ambiguous PIN", () => {
  it("two staff members sharing a PIN: refused (409), never the higher role; naming the staff member works", async () => {
    const h = await bcrypt.hash("5199", 12)
    const a = await prisma.staffUser.create({ data: { tenantId: T, name: "Shared A", mobile: `ct-sa-${T.slice(0, 6)}`, pin: h, role: "Cashier", permissions: ["sales.checkout"] } as any })
    const b = await prisma.staffUser.create({ data: { tenantId: T, name: "Shared B", mobile: `ct-sb-${T.slice(0, 6)}`, pin: h, role: "Manager", permissions: ["sales.checkout", "inventory.manage"] } as any })
    const r = await login("5199")
    expect(r.status).toBe(409)
    expect(r.body.code).toBe("AMBIGUOUS_PIN")
    expect(r.body.token).toBeUndefined()
    expect(r.body.candidates.map((c: any) => c.name).sort()).toEqual(["Shared A", "Shared B"])
    const asA = await login("5199", { staffId: a.id })
    expect([asA.status, asA.body.user.id, asA.body.user.role]).toEqual([200, a.id, "Cashier"])
    expect((await login("5199", { staffId: b.id })).body.user.id).toBe(b.id) // the Manager only when named
    expect((await login("0000", { staffId: a.id })).status).toBe(401)
    await prisma.staffUser.deleteMany({ where: { id: { in: [a.id, b.id] } } })
  })
})

describe("WebSocket channels", () => {
  async function socket(token: string) {
    const ws = new WebSocket(base.replace("http", "ws") + "/ws")
    const got: Array<{ type: string; data: any }> = []
    ws.on("message", (m) => got.push(JSON.parse(String(m))))
    await new Promise((r) => ws.on("open", r))
    ws.send(JSON.stringify({ type: "auth", token }))
    for (let i = 0; i < 50 && !got.some((g) => g.type === "auth:ok"); i++) await new Promise((r) => setTimeout(r, 20))
    return { ws, got }
  }
  it("a customer gets only their own order updates; sync events go to store staff only", async () => {
    const c = await socket(customer), s = await socket(cashier), d = await socket(driver)
    try {
    broadcastToTenant(T, "sync:activity", { activities: [{ summary: "Rana sold 2 Water" }] })
    broadcastToTenant(T, "order:updated", { order: { id: "o1", customerId, status: "Ready" } })
    broadcastToTenant(T, "order:updated", { order: { id: "o2", customerId: "someone-else", status: "Ready" } })
    broadcastToTenant(T, "order:available", { order: { id: "o3" } })
    await new Promise((r) => setTimeout(r, 300))
    const types = (x: { got: any[] }) => x.got.filter((g) => g.type !== "auth:ok" && g.type !== "connected").map((g) => `${g.type}:${g.data?.order?.id ?? ""}`)
    expect(types(c)).toEqual(["order:updated:o1"])
    expect(types(s)).toEqual(["sync:activity:", "order:updated:o1", "order:updated:o2", "order:available:o3"])
    expect(types(d)).toEqual(["order:updated:o1", "order:updated:o2", "order:available:o3"])
    } finally { for (const x of [c, s, d]) x.ws.terminate() }
  })
})

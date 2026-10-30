import { describe, it, expect, beforeAll, afterAll, vi } from "vitest"
import http from "node:http"
import type { AddressInfo } from "node:net"
import { randomUUID, createHash } from "node:crypto"

// CAFE-AUDIT (real Postgres, real handlers): café workflows and the security boundaries they rely
// on, for docs/CAFE-COMPATIBILITY-AUDIT.md. Two disposable stores (A, B), staff signed in through
// the real login endpoint. `it.fails` marks a CONFIRMED DEFECT that is not fixed yet: it passes
// while the defect exists and turns red once fixed (then flip it to `it`). Plain `it` = behaviour
// that must hold. SPRINT-0 flipped every security probe it fixed into a plain regression assertion.
process.env.JWT_SECRET = process.env.JWT_SECRET || "cafe-audit-secret"
const prisma = (await import("../src/lib/prisma.js")).default
const app = (await import("../src/app.js")).default
const bcrypt = (await import("bcryptjs")).default
delete process.env.IS_LOCAL_SERVER
vi.setConfig({ testTimeout: 60_000 })

const A = randomUUID(), B = randomUUID()
const SUB_A = `ca-${A.slice(0, 8)}`, SUB_B = `cb-${B.slice(0, 8)}`
const DEV = `cafe-dev-${A.slice(0, 6)}`
let server: http.Server
let base = ""
let adminA = "", cashierA = "", managerA = ""
const CASHIER_A = randomUUID(), ADMIN_A = randomUUID(), MANAGER_A = randomUUID()
const sha = (p: string) => createHash("sha256").update(p).digest("base64")
/** Evidence: every server answer this file sees, by test, written for the audit report. */
const evidence: Array<{ test: string; what: string; status: unknown; detail?: unknown }> = []
const note = (what: string, status: unknown, detail?: unknown) => evidence.push({ test: expect.getState().currentTestName ?? "", what, status, detail })

async function login(pin: string, sub: string) {
  const r = await fetch(`${base}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pin, tenantSubdomain: sub }) })
  if (!r.ok) throw new Error(`login ${r.status}`)
  return ((await r.json()) as { token: string }).token
}
async function call(token: string, method: string, path: string, body?: unknown) {
  const r = await fetch(`${base}${path}`, { method, headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined })
  let json: any = null
  try { json = await r.json() } catch { /* not json */ }
  if (path !== "/api/sync/push") note(`${method} ${path.replace(/[0-9a-f-]{36}/g, "<id>")}`, r.status, Array.isArray(json) ? `${json.length} rows` : undefined)
  return { status: r.status, body: json }
}
async function push(token: string, entity: string, action: string, payload: unknown, id = randomUUID()) {
  const r = await call(token, "POST", "/api/sync/push", { deviceId: DEV, operations: [{ id, entity, action, payload }] })
  const out = (r.body?.results?.[0] ?? { status: `http-${r.status}`, error: r.body?.error }) as { status: string; error?: string }
  note(`push ${entity}/${action}`, out.status, out.error)
  return out
}
const tender = (usd: number) => ({ currency: "USD", exchangeRate: 89500, paidUsd: usd, paidLbp: 0, paidTotalUsd: usd, paidTotalLbp: usd * 89500, changeUsd: 0, changeLbp: 0, changeCurrency: "USD" })
type Line = { productId: number; name: string; qty: number; price: number; barcode?: string | null }
function salePayload(lines: Line[], extra: Record<string, unknown> = {}) {
  const id = randomUUID()
  const total = lines.reduce((s, l) => s + l.qty * l.price, 0)
  return {
    id, saleNumber: `S-${id.slice(0, 8)}`, paymentMethod: "Cash", subtotal: total, tax: 0, total, cost: 0, profit: 0,
    cashier: "Cashier A", cashierId: CASHIER_A, status: "Completed", tender: tender(total),
    items: lines.map((l) => ({ id: l.productId, lineId: randomUUID(), name: l.name, barcode: l.barcode ?? "", quantity: l.qty, unitPrice: l.price, total: l.qty * l.price, cost: 0 })),
    ...extra,
  }
}
const productBy = (tenantId: string, name: string) => prisma.product.findFirst({ where: { tenantId, name } })

beforeAll(async () => {
  server = http.createServer(app)
  await new Promise<void>((r) => server.listen(0, r))
  base = `http://localhost:${(server.address() as AddressInfo).port}`
  for (const [id, sub] of [[A, SUB_A], [B, SUB_B]]) await prisma.tenant.create({ data: { id, name: `Cafe audit ${sub} (disposable)`, subdomain: sub } })
  await prisma.staffUser.create({ data: { id: ADMIN_A, tenantId: A, name: "Owner A", mobile: `ca-a-${A.slice(0, 6)}`, pin: await bcrypt.hash("7101", 12), role: "Admin" } })
  await prisma.staffUser.create({ data: { id: MANAGER_A, tenantId: A, name: "Manager A", mobile: `ca-m-${A.slice(0, 6)}`, pin: await bcrypt.hash("7102", 12), role: "Manager", permissions: ["sales.checkout", "sales.refund", "sales.void", "reports.view", "inventory.view"] } })
  await prisma.staffUser.create({ data: { id: CASHIER_A, tenantId: A, name: "Cashier A", mobile: `ca-c-${A.slice(0, 6)}`, pin: await bcrypt.hash("7103", 12), role: "Cashier", permissions: ["sales.checkout", "sales.reprint", "inventory.view"] } })
  await prisma.staffUser.create({ data: { tenantId: B, name: "Owner B", mobile: `cb-a-${B.slice(0, 6)}`, pin: await bcrypt.hash("8101", 12), role: "Admin" } })
  await prisma.device.create({ data: { tenantId: A, deviceId: DEV, deviceName: "Cafe till", status: "APPROVED" } })
  // Store B has its own data that A must never see.
  await prisma.product.create({ data: { tenantId: B, name: "B secret blend", price: 9, cost: 4, stock: 5, barcode: `B-${B.slice(0, 6)}`, category: "B" } })
  await prisma.customer.create({ data: { tenantId: B, name: "B private customer", mobile: `cb-cust-${B.slice(0, 6)}`, creditLimit: 0 } })
  adminA = await login("7101", SUB_A)
  managerA = await login("7102", SUB_A)
  cashierA = await login("7103", SUB_A)
})

afterAll(async () => {
  if (process.env.CAFE_EVIDENCE) (await import("node:fs")).writeFileSync(process.env.CAFE_EVIDENCE, JSON.stringify(evidence, null, 2))
  await new Promise<void>((r) => server.close(() => r()))
  for (const t of [A, B]) {
    const where = { tenantId: t }
    await prisma.stockMovement.deleteMany({ where })
    await prisma.syncOperation.deleteMany({ where })
    await prisma.saleRefund.deleteMany({ where })
    await prisma.sale.deleteMany({ where })
    await prisma.inventoryBatch.deleteMany({ where })
    await prisma.auditEvent.deleteMany({ where })
    await prisma.pairingCode.deleteMany({ where })
    await prisma.device.deleteMany({ where })
    await prisma.customer.deleteMany({ where })
    await prisma.product.deleteMany({ where })
    await prisma.staffUser.deleteMany({ where })
    await prisma.tenant.deleteMany({ where: { id: t } })
  }
  await prisma.$disconnect()
})

describe("B. products without barcodes", () => {
  it("several drinks can be created with no barcode (null) and stay distinct", async () => {
    for (const name of ["Espresso", "Double espresso", "Cappuccino"]) {
      const r = await push(adminA, "product", "create", { syncId: randomUUID(), name, price: 1.5, cost: 0.4, category: "Coffee", barcode: null })
      expect([name, r.status]).toEqual([name, "ok"])
    }
    expect(await prisma.product.count({ where: { tenantId: A, category: "Coffee", barcode: null } })).toBe(3)
  })

  it.fails("CONFIRMED DEFECT: two products sent with an empty-string barcode are both kept as separate products", async () => {
    const r1 = await push(adminA, "product", "create", { syncId: randomUUID(), name: "Iced latte", price: 2.5, category: "Coffee", barcode: "" })
    const r2 = await push(adminA, "product", "create", { syncId: randomUUID(), name: "Nescafé", price: 1, category: "Coffee", barcode: "" })
    expect([r1.status, r2.status]).toEqual(["ok", "ok"])
    expect(await productBy(A, "Iced latte")).not.toBeNull()
    expect(await productBy(A, "Nescafé")).not.toBeNull()
  })

  it.fails("CONFIRMED DEFECT (café blocker): a prepared drink with no stock count can be sold", async () => {
    const p = (await productBy(A, "Espresso"))!
    const r = await push(cashierA, "sale", "create", salePayload([{ productId: p.id, name: p.name, qty: 1, price: 1.5 }]))
    expect(r.status).toBe("ok")
  })

  it("a packaged item with stock sells and decrements stock; a drink kept at a placeholder stock also sells", async () => {
    const pepsi = await prisma.product.create({ data: { tenantId: A, name: "Pepsi 330ml", price: 1, cost: 0.5, stock: 10, barcode: `PEP-${A.slice(0, 6)}`, category: "Drinks" } })
    const esp = (await productBy(A, "Espresso"))!
    await prisma.product.update({ where: { id: esp.id }, data: { stock: 1000 } }) // the only way a drink sells today
    const r = await push(cashierA, "sale", "create", salePayload([{ productId: esp.id, name: esp.name, qty: 2, price: 1.5 }, { productId: pepsi.id, name: pepsi.name, qty: 1, price: 1, barcode: pepsi.barcode }]))
    expect(r.status).toBe("ok")
    expect(Number((await prisma.product.findUnique({ where: { id: pepsi.id } }))!.stock)).toBe(9)
    expect(Number((await prisma.product.findUnique({ where: { id: esp.id } }))!.stock)).toBe(998) // the drink's fake stock is consumed too
  })

  it("refunding a prepared drink puts it back into product stock (no physical-return decision)", async () => {
    const esp = (await productBy(A, "Espresso"))!
    const sale = salePayload([{ productId: esp.id, name: esp.name, qty: 1, price: 1.5 }])
    expect((await push(managerA, "sale", "create", sale)).status).toBe("ok")
    const before = Number((await prisma.product.findUnique({ where: { id: esp.id } }))!.stock)
    const rid = randomUUID()
    const r = await push(managerA, "refund", "create", { id: rid, refundNumber: `R-${rid.slice(0, 8)}`, saleId: sale.id, saleNumber: sale.saleNumber, method: "Cash", reason: "spilled", total: 1.5, cashier: "Manager A", items: [{ id: esp.id, saleLineId: sale.items[0].lineId, name: esp.name, quantity: 1, unitPrice: 1.5, total: 1.5 }] })
    expect(r.status).toBe("ok")
    expect(Number((await prisma.product.findUnique({ where: { id: esp.id } }))!.stock)).toBe(before + 1)
  })
})

describe("A. staff attribution and server authorization", () => {
  it("a cashier's sale below the catalogue price is rejected (needs sales.price_override)", async () => {
    const pepsi = (await productBy(A, "Pepsi 330ml"))!
    const r = await push(cashierA, "sale", "create", salePayload([{ productId: pepsi.id, name: pepsi.name, qty: 1, price: 0.01, barcode: pepsi.barcode }]))
    expect(r.status).toBe("rejected")
    expect(r.error).toMatch(/^PRICE_OVERRIDE:/)
  })

  it("a cashier's sale at the catalogue price (or above it) is accepted", async () => {
    const pepsi = (await productBy(A, "Pepsi 330ml"))!
    expect((await push(cashierA, "sale", "create", salePayload([{ productId: pepsi.id, name: pepsi.name, qty: 1, price: Number(pepsi.price), barcode: pepsi.barcode }]))).status).toBe("ok")
  })

  it("a manager with sales.price_override may sell below the catalogue price", async () => {
    const pepsi = (await productBy(A, "Pepsi 330ml"))!
    await prisma.staffUser.update({ where: { id: MANAGER_A }, data: { permissions: ["sales.checkout", "sales.refund", "sales.void", "sales.price_override", "reports.view", "inventory.view"] } })
    expect((await push(managerA, "sale", "create", salePayload([{ productId: pepsi.id, name: pepsi.name, qty: 1, price: 0.5, barcode: pepsi.barcode }]))).status).toBe("ok")
  })

  it("a cashier cannot push a sell-at-cost sale", async () => {
    const pepsi = (await productBy(A, "Pepsi 330ml"))!
    const r = await push(cashierA, "sale", "create", salePayload([{ productId: pepsi.id, name: pepsi.name, qty: 1, price: Number(pepsi.price), barcode: pepsi.barcode }], { soldAtCost: true }))
    expect(r.status).toBe("rejected")
  })

  it.fails("CONFIRMED DEFECT: a cashier cannot record a sale attributed to another staff member", async () => {
    const pepsi = (await productBy(A, "Pepsi 330ml"))!
    const sale = salePayload([{ productId: pepsi.id, name: pepsi.name, qty: 1, price: 1, barcode: pepsi.barcode }], { cashier: "Owner A", cashierId: ADMIN_A })
    const r = await push(cashierA, "sale", "create", sale)
    expect(r.status).not.toBe("ok")
  })

  it("a cashier cannot push a refund (sales.refund is checked on the signed-in account)", async () => {
    const r = await push(cashierA, "refund", "create", { id: randomUUID(), saleId: randomUUID(), items: [], total: 1, method: "Cash" })
    expect(r.status).not.toBe("ok")
  })

  it("a cashier cannot change staff roles or settings through sync", async () => {
    expect((await push(cashierA, "staff", "update", { id: CASHIER_A, name: "Cashier A", role: "Manager", active: true, permissions: [], roleVersion: 1 })).status).not.toBe("ok")
    expect((await push(cashierA, "settings", "update", { storeName: "hijacked" })).status).not.toBe("ok")
  })

  it("a cashier cannot change a product's price or cost, nor create or delete products, through sync", async () => {
    const pepsi = (await productBy(A, "Pepsi 330ml"))!
    const r = await push(cashierA, "product", "update", { id: pepsi.id, syncId: pepsi.syncId, name: pepsi.name, price: 0.1, cost: 0.01 })
    expect(r.status).not.toBe("ok")
    expect(r.error).toMatch(/permission/)
    expect(Number((await prisma.product.findUnique({ where: { id: pepsi.id } }))!.price)).toBe(1)
    expect((await push(cashierA, "product", "create", { syncId: randomUUID(), name: "Cashier item", price: 1, category: "X" })).status).not.toBe("ok")
    expect((await push(cashierA, "product", "delete", { id: pepsi.id, syncId: pepsi.syncId })).status).not.toBe("ok")
  })

  it("an Admin can still edit the catalogue through sync", async () => {
    const pepsi = (await productBy(A, "Pepsi 330ml"))!
    expect((await push(adminA, "product", "update", { id: pepsi.id, syncId: pepsi.syncId, name: pepsi.name, price: 1, cost: 0.5 })).status).toBe("ok")
  })

  it("cost and margin reports: refused to a cashier, open to a manager (reports.cost implied by reports.view)", async () => {
    expect((await call(cashierA, "GET", "/api/reports/margin")).status).toBe(403)
    expect((await call(cashierA, "GET", "/api/reports/export/margin")).status).toBe(403)
    expect((await call(cashierA, "GET", "/api/dashboard/kpi")).status).toBe(403)
    expect((await call(managerA, "GET", "/api/reports/margin")).status).toBe(200)
  })

  it("the product list a cashier gets has no cost fields; a manager's has them", async () => {
    const c = await call(cashierA, "GET", "/api/products")
    expect(c.status).toBe(200)
    expect((c.body as Array<Record<string, unknown>>).length).toBeGreaterThan(0)
    expect((c.body as Array<Record<string, unknown>>).every((p) => !("cost" in p) && !("wholesalePrice" in p))).toBe(true)
    const m = await call(managerA, "GET", "/api/products")
    expect((m.body as Array<Record<string, unknown>>).some((p) => "cost" in p)).toBe(true)
  })

  it("a cashier never receives customer PIN hashes; staff records (and their versions) still arrive", async () => {
    await prisma.customer.create({ data: { tenantId: A, name: "A app customer", mobile: `ca-pin-${A.slice(0, 6)}`, creditLimit: 0, pin: "$2a$12$customerhashcustomerhashcustomerhashcustomerhashcust" } as any })
    const r = await call(cashierA, "GET", "/api/sync/pull")
    expect(r.status).toBe(200)
    const users = (r.body.users ?? []) as Array<Record<string, unknown>>
    expect(users.length).toBeGreaterThanOrEqual(3)
    expect(users.find((u) => u.id === CASHIER_A)?.pinVersion).toBe(1) // versions still flow (offline invalidation)
    expect(((r.body.customers ?? []) as Array<Record<string, unknown>>).some((c) => "pin" in c)).toBe(false)
  })

  // HOTFIX: staff verifiers are still sent to staff tills — 1.0.50 tills unlock offline with them
  // (tested in offline-auth.test.ts). Withholding them waits for tills that verify online.
  it.fails("KNOWN 1.0.50 LIMITATION: a cashier still receives staff PIN verifiers", async () => {
    const r = await call(cashierA, "GET", "/api/sync/pull")
    expect(((r.body.users ?? []) as Array<Record<string, unknown>>).some((u) => "pin" in u)).toBe(false)
  })

  it("the hub's sync connection (store cloud key) still receives verifiers to verify PINs for its tills", async () => {
    const key = `cafe-key-${randomUUID()}`
    await prisma.tenant.update({ where: { id: A }, data: { cloudApiKey: key } })
    const r = await fetch(`${base}/api/sync/pull`, { headers: { "X-Cloud-Key": key, "X-Tenant-Id": A } })
    const body = (await r.json()) as { users: Array<Record<string, unknown>> }
    expect(r.status).toBe(200)
    expect(body.users.find((u) => u.id === ADMIN_A)?.pin).toMatch(/^\$2/)
    // ...and the key cannot be used for another store.
    expect((await fetch(`${base}/api/sync/pull`, { headers: { "X-Cloud-Key": key, "X-Tenant-Id": B } })).status).toBe(401)
  })

  it("a cashier cannot approve, list or revoke devices; the store admin and the hub's own admin token can", async () => {
    expect((await call(cashierA, "POST", "/api/device/generate-code", {})).status).toBe(403)
    expect((await call(cashierA, "GET", "/api/device/list")).status).toBe(403)
    expect((await call(cashierA, "POST", "/api/device/revoke", { deviceId: DEV })).status).toBe(403)
    expect((await call(adminA, "POST", "/api/device/generate-code", {})).status).toBe(200)
    const jwt = (await import("jsonwebtoken")).default
    const hubAdmin = jwt.sign({ userId: "__admin__", tenantId: A, role: "Admin" }, process.env.JWT_SECRET!, { expiresIn: "1h" })
    expect((await call(hubAdmin, "POST", "/api/device/generate-code", {})).status).toBe(200)
  })

  it("a cashier cannot create or change driver logins; the store admin can", async () => {
    const r = await call(cashierA, "POST", "/api/delivery/drivers", { name: "Ghost", mobile: `ghost-${A.slice(0, 6)}`, pin: "6464", code: `G${A.slice(0, 4)}` })
    expect(r.status).toBe(403)
    expect(await prisma.staffUser.count({ where: { tenantId: A, name: "Ghost" } })).toBe(0)
    expect((await call(adminA, "POST", "/api/delivery/drivers", { name: "Real driver", mobile: `drv-${A.slice(0, 6)}`, pin: "6565", code: `D${A.slice(0, 4)}` })).status).toBe(201)
  })

  it("a deactivated manager's still-valid token gets no permissions", async () => {
    const jwt = (await import("jsonwebtoken")).default
    const t = jwt.sign({ userId: MANAGER_A, tenantId: A, role: "Manager" }, process.env.JWT_SECRET!, { expiresIn: "1h" }) // no tokenVersion: not re-checked by requireAuth
    await prisma.staffUser.update({ where: { id: MANAGER_A }, data: { active: false } })
    try {
      expect((await call(t, "GET", "/api/reports/margin")).status).toBe(403)
    } finally {
      await prisma.staffUser.update({ where: { id: MANAGER_A }, data: { active: true } })
    }
  })

  it("the shift opener named in the record must be allowed to open a shift (recorded-actor rule)", async () => {
    // A driver-only account cannot be named as the opener.
    const D = randomUUID()
    await prisma.staffUser.create({ data: { id: D, tenantId: A, name: "Driver A", mobile: `ca-d-${A.slice(0, 6)}`, pin: "x", role: "Driver", permissions: ["delivery.manage"] } })
    const r = await push(adminA, "shift", "open", { id: randomUUID(), openedById: D, openedByName: "Driver A", openingFloatUsd: 50, openedAt: new Date().toISOString(), status: "Open" })
    expect(r.status).not.toBe("ok")
  })
})

describe("J. tenant isolation", () => {
  it("store A's staff cannot list store B's products, customers or sales via ?tenantId= (403, nothing leaked)", async () => {
    await prisma.sale.create({ data: { id: randomUUID(), tenantId: B, saleNumber: "S-B-PRIVATE", paymentMethod: "Cash", subtotal: 3, tax: 0, total: 3, cashier: "Owner B", status: "Completed" } as any })
    for (const [who, path] of [[cashierA, "products"], [cashierA, "customers"], [adminA, "products"], [adminA, "customers"], [adminA, "sales"]] as const) {
      const r = await call(who, "GET", `/api/${path}?tenantId=${B}`)
      expect([path, r.status]).toEqual([path, 403])
      expect(JSON.stringify(r.body)).not.toMatch(/B secret blend|B private customer|S-B-PRIVATE/)
    }
  })
  it("the same lists without ?tenantId= return the caller's own store only", async () => {
    const p = await call(adminA, "GET", "/api/products")
    expect((p.body as Array<{ tenantId: string }>).every((x) => x.tenantId === A)).toBe(true)
    const s = await call(adminA, "GET", "/api/sales")
    const rows = (Array.isArray(s.body) ? s.body : s.body?.sales ?? []) as Array<{ tenantId: string }>
    expect(rows.every((x) => x.tenantId === A)).toBe(true)
    expect((await call(cashierA, "GET", "/api/sales")).status).toBe(403) // sales history needs reports.view
  })
  it("a staff token cannot read another store's setup info through X-Tenant-Id", async () => {
    const r = await fetch(`${base}/api/setup/tenant-info`, { headers: { Authorization: `Bearer ${cashierA}`, "X-Tenant-Id": B } })
    expect(r.status).toBe(403)
    const own = await fetch(`${base}/api/setup/tenant-info`, { headers: { Authorization: `Bearer ${cashierA}` } })
    expect(((await own.json()) as { id: string }).id).toBe(A)
  })
  it("sync pull is scoped to the token's store", async () => {
    const r = await call(cashierA, "GET", "/api/sync/pull")
    expect(JSON.stringify(r.body)).not.toContain("B secret blend")
    expect(JSON.stringify(r.body)).not.toContain("B private customer")
  })
  it("setup diagnostics are refused over the network (only the machine itself may read them)", async (ctx) => {
    const os = await import("node:os")
    const lan = Object.values(os.networkInterfaces()).flat().find((i) => i && i.family === "IPv4" && !i.internal)
    if (!lan) { ctx.skip(); return } // no non-loopback interface on this machine
    const port = (server.address() as AddressInfo).port
    expect((await fetch(`http://${lan.address}:${port}/api/setup/diagnostics`)).status).toBe(403)
    expect((await fetch(`${base}/api/setup/diagnostics`)).status).toBe(200) // localhost: the hub's own support screen
  })
  it("a public product image is served only within the store named in the request", async () => {
    const b = (await productBy(B, "B secret blend"))!
    await prisma.product.update({ where: { id: b.id }, data: { image: "data:image/png;base64,iVBORw0KGgo=" } as any })
    expect((await fetch(`${base}/api/delivery/public/image/${b.id}`)).status).toBe(400)
    expect((await fetch(`${base}/api/delivery/public/image/${b.id}?tenantId=${A}`)).status).toBe(404)
    expect((await fetch(`${base}/api/delivery/public/image/${b.id}?tenantId=${B}`)).status).toBe(200)
  })
})

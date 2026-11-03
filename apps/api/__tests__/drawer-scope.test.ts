import { describe, it, expect, beforeAll, afterAll } from "vitest"
import http from "node:http"
import type { AddressInfo } from "node:net"
import { randomUUID } from "node:crypto"
import jwt from "jsonwebtoken"

// Batch 83 (real Postgres, real handlers): a shift records the register that opened it (the store's name for
// the device); a second shift opened while one is open is recorded and flagged, never merged; the drawer
// scope changes only while no shift is open and nothing is held; hubs before sync schema 7 never receive
// the new fields (their database has no such columns).
process.env.JWT_SECRET = process.env.JWT_SECRET || "drawer-scope-secret"
delete process.env.IS_LOCAL_SERVER
const prisma = (await import("../src/lib/prisma.js")).default
const app = (await import("../src/app.js")).default

const T = randomUUID(), OWNER = randomUUID(), KEY = randomUUID()
let server: http.Server
let base = ""
let owner = ""
async function call(method: string, p: string, body?: unknown, headers: Record<string, string> = {}) {
  const r = await fetch(`${base}${p}`, { method, headers: { "Content-Type": "application/json", "x-titan-sync-schema": "7", ...headers }, body: body === undefined ? undefined : JSON.stringify(body) })
  const text = await r.text()
  return { status: r.status, body: (text ? JSON.parse(text) : null) as any }
}
const push = (op: any) => call("POST", "/api/sync/push", { deviceId: op.payload?.deviceId ?? "x", operations: [op] }, { Authorization: `Bearer ${owner}` }).then((r) => r.body.results[0])
const openOp = (id: string, n: string, deviceId: string) => ({ id: randomUUID(), entity: "shift", action: "open", payload: { id, shiftNumber: n, status: "Open", openedAt: new Date().toISOString(), openingFloatUsd: 20, openedById: OWNER, openedByName: "Owner", deviceId, deviceName: "what the register calls itself", registerId: "REG-001" } })
const closeOp = (id: string) => ({ id: randomUUID(), entity: "shift", action: "close", payload: { id, closingCashUsd: 20, expectedCashUsd: 20, differenceUsd: 0 } })
// a register sends its whole settings object
const SETTINGS = { storeName: "Drawer IT", branchName: "", phone: "", address: "", vatRate: 0, usdToLbpRate: 89500, receiptFooter: "", lowStockThreshold: 5 }
const settingsOp = (drawerScope: unknown) => ({ id: randomUUID(), entity: "settings", action: "update", payload: { ...SETTINGS, drawerScope } })

beforeAll(async () => {
  server = http.createServer(app)
  await new Promise<void>((r) => server.listen(0, r))
  base = `http://localhost:${(server.address() as AddressInfo).port}`
  await prisma.tenant.create({ data: { id: T, name: "Drawer scope IT (disposable)", subdomain: `dsc-${T.slice(0, 8)}`, cloudApiKey: KEY } })
  await prisma.staffUser.create({ data: { id: OWNER, tenantId: T, name: "Owner", mobile: `dsc-${OWNER.slice(0, 8)}`, pin: "x".repeat(10), role: "Admin" } as any })
  await prisma.appSettings.create({ data: { tenantId: T, storeName: "Drawer IT", branchName: "", phone: "", address: "", vatRate: 0, usdToLbpRate: 89500, receiptFooter: "", lowStockThreshold: 5 } })
  owner = jwt.sign({ userId: OWNER, tenantId: T, role: "Admin", tokenVersion: 1 }, process.env.JWT_SECRET!, { expiresIn: "1h" })
  // the store knows the PC as "Counter PC" (paired)
  const code = (await call("POST", "/api/device/generate-code", {}, { Authorization: `Bearer ${owner}` })).body.code
  expect((await call("POST", "/api/device/pair", { code, deviceId: "dev-pc", deviceName: "Counter PC" })).status).toBe(200)
})
afterAll(async () => {
  for (const m of ["auditEvent", "syncOperation", "syncClient", "operationEvidence", "managerApproval", "supplierPayment", "supplier", "cashMovement", "saleRefund", "sale", "shift", "appSettings", "pairingCode", "device", "staffUser"] as const)
    await (prisma as any)[m].deleteMany({ where: { tenantId: T } }).catch(() => undefined)
  await prisma.tenant.deleteMany({ where: { id: T } })
  await new Promise<void>((r) => server.close(() => r()))
  await prisma.$disconnect()
})

describe("shifts and the drawer scope", () => {
  it("a shift records its register, named as the store knows the device", async () => {
    expect((await push(openOp("sh-a", "SHIFT-A", "dev-pc"))).status).toBe("ok")
    const s = await prisma.shift.findUnique({ where: { id: "sh-a" } })
    expect([s?.deviceId, s?.deviceName]).toEqual(["dev-pc", "Counter PC"])
  })

  it("a second shift opened on another register while one is open: recorded and flagged, never merged", async () => {
    expect((await push(openOp("sh-b", "SHIFT-B", "dev-phone"))).status).toBe("ok")
    expect(await prisma.shift.count({ where: { tenantId: T, status: "Open" } })).toBe(2)
    const flag = await prisma.auditEvent.findFirst({ where: { tenantId: T, action: "shift.open_while_other_open" } })
    expect(flag?.summary).toMatch(/SHIFT-B was opened on what the register calls itself while SHIFT-A was still open/)
    expect((await push(closeOp("sh-b"))).status).toBe("ok")
  })

  it("the drawer scope changes only while no shift is open; it reaches registers and current hubs", async () => {
    const busy = await push(settingsOp("shared"))
    expect(busy.status).not.toBe("ok")
    expect(busy.error).toMatch(/DRAWER_SCOPE_BUSY: .*1 open shift/)
    expect((await prisma.appSettings.findUnique({ where: { tenantId: T } }))?.drawerScope ?? null).toBeNull()
    expect((await push(closeOp("sh-a"))).status).toBe("ok")
    expect((await push(settingsOp("shared"))).status).toBe("ok")
    expect((await prisma.appSettings.findUnique({ where: { tenantId: T } }))?.drawerScope).toBe("shared")
    // anything else is "not chosen"
    expect((await push(settingsOp("per-register"))).status).toBe("ok")
    expect((await prisma.appSettings.findUnique({ where: { tenantId: T } }))?.drawerScope ?? null).toBeNull()
    expect((await push(settingsOp("shared"))).status).toBe("ok")
    // a settings save that does not mention it leaves it as it is (an older register's save)
    expect((await push({ id: randomUUID(), entity: "settings", action: "update", payload: { ...SETTINGS, storeName: "Drawer IT 2" } })).status).toBe("ok")
    expect((await prisma.appSettings.findUnique({ where: { tenantId: T } }))?.drawerScope).toBe("shared")
  })

  it("a hub before schema 7 never receives the new fields; a schema-7 hub and registers do", async () => {
    const bridge = (schema: string) => ({ "x-cloud-key": KEY, "x-titan-sync-schema": schema, "x-tenant-id": T })
    const old = await call("GET", "/api/sync/pull", undefined, bridge("6"))
    expect(old.status).toBe(200)
    expect(old.body.shifts.length).toBeGreaterThan(0)
    for (const s of old.body.shifts) expect(["deviceId", "deviceName"].filter((k) => k in s)).toEqual([])
    const oldSettings = [old.body.settings].flat().filter(Boolean)
    for (const s of oldSettings) expect("drawerScope" in s).toBe(false)
    const oldFull = await call("GET", "/api/sync/pull/full/shifts?limit=50", undefined, bridge("6"))
    for (const s of oldFull.body.items) expect("deviceId" in s).toBe(false)
    const oldFullSettings = await call("GET", "/api/sync/pull/full/settings?limit=1", undefined, bridge("6"))
    for (const s of oldFullSettings.body.items) expect("drawerScope" in s).toBe(false)
    const cur = await call("GET", "/api/sync/pull", undefined, bridge("7"))
    expect(cur.body.shifts.find((s: any) => s.id === "sh-a")).toMatchObject({ deviceId: "dev-pc", deviceName: "Counter PC" })
    expect([cur.body.settings].flat()[0]?.drawerScope).toBe("shared")
    const reg = await call("GET", "/api/sync/pull", undefined, { Authorization: `Bearer ${owner}`, "x-titan-sync-schema": "6" })
    expect(reg.body.shifts.find((s: any) => s.id === "sh-a")?.deviceId).toBe("dev-pc")
  })

  it("one shared shift, two registers: X and Z count each sale, refund, payout and supplier payment once", async () => {
    expect((await push(openOp("sh-z", "SHIFT-Z", "dev-pc"))).status).toBe("ok")
    const mk = (id: string, total: number, method: string, dev: string) => prisma.sale.create({ data: { id, tenantId: T, saleNumber: id, paymentMethod: method as any, subtotal: total, tax: 0, total, cashier: dev, shiftId: "sh-z", shiftNumber: "SHIFT-Z" } as any })
    await mk(`z-pc-${T.slice(0, 4)}`, 5.5, "Cash", "pc"); await mk(`z-ph-${T.slice(0, 4)}`, 4.75, "Cash", "phone"); await mk(`z-card-${T.slice(0, 4)}`, 3.5, "Card", "phone")
    await prisma.saleRefund.create({ data: { tenantId: T, refundNumber: "R-Z1", saleId: `z-pc-${T.slice(0, 4)}`, saleNumber: "z-pc", method: "Cash", reason: "IT", total: 1, cashier: "phone", shiftId: "sh-z" } as any })
    await prisma.cashMovement.create({ data: { tenantId: T, type: "PettyCash", direction: "Out", amountUsd: 2, reason: "IT milk", recordedByName: "phone", shiftId: "sh-z" } as any })
    const sup = await prisma.supplier.create({ data: { tenantId: T, name: "IT supplier" } })
    await prisma.supplierPayment.create({ data: { tenantId: T, supplierId: sup.id, supplierName: sup.name, amount: 3, method: "Cash", recordedBy: "pc", shiftId: "sh-z" } as any })
    const x = await call("GET", "/api/reports/x-report", undefined, { Authorization: `Bearer ${owner}` })
    const expected = 20 + 5.5 + 4.75 - 1 - 2 - 3
    expect([x.body.shift?.number, x.body.cashReconciliation?.expectedCash, x.body.paymentBreakdown?.cashSales?.count]).toEqual(["SHIFT-Z", expected, 2])
    const z = await call("POST", "/api/reports/z-report", { shiftId: "sh-z", closingCash: expected }, { Authorization: `Bearer ${owner}` })
    expect(z.status).toBe(200)
    const closed = await prisma.shift.findUnique({ where: { id: "sh-z" } })
    expect([closed?.status, Number(closed?.expectedCashUsd), Number(closed?.differenceUsd)]).toEqual(["Closed", expected, 0])
    await prisma.supplierPayment.deleteMany({ where: { tenantId: T } }); await prisma.supplier.deleteMany({ where: { tenantId: T } })
    await prisma.cashMovement.deleteMany({ where: { tenantId: T } }); await prisma.saleRefund.deleteMany({ where: { tenantId: T } }); await prisma.sale.deleteMany({ where: { tenantId: T } })
  })
})

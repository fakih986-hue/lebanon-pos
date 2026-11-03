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
  for (const m of ["auditEvent", "syncOperation", "syncClient", "operationEvidence", "managerApproval", "dailyClose", "supplierPayment", "supplier", "cashMovement", "saleRefund", "sale", "shift", "appSettings", "pairingCode", "device", "staffUser"] as const)
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

  it("the stuck 1.0.54 shift forwards (its exact shape: deviceName, deviceId, a close with tenantId and closedById): applied once; a resend changes nothing", async () => {
    const OPEN = "0f4bffc5-0a09-4285-bd17-9697c934a150", CLOSE = "06e9533c-336b-419b-b965-21420bb540e9", SH = `shift-rehearsal-${T.slice(0, 6)}`
    const open = { id: OPEN, entity: "shift", action: "open", payload: { id: SH, status: "Open", deviceId: "DEV-MVZXCELC-OA5K", openedAt: "2026-11-03T12:31:56.808Z", deviceName: "Main Register", openedById: OWNER, registerId: "REG-001", shiftNumber: "SHIFT-OA5K-007", openedByName: "Café Cashier", openingFloatUsd: 20 } }
    const close = { id: CLOSE, entity: "shift", action: "close", payload: { id: SH, status: "Closed", closedAt: "2026-11-03T12:32:48.356Z", deviceId: "DEV-MVZXCELC-OA5K", openedAt: "2026-11-03T12:31:56.808Z", tenantId: T, closedById: OWNER, deviceName: "Main Register", openedById: OWNER, shiftNumber: "SHIFT-OA5K-007", cashSalesUsd: 0, closedByName: "Café Cashier", openedByName: "Café Cashier", differenceUsd: 0, cashRefundsUsd: 0, closingCashUsd: 21, cashExpensesUsd: 0, expectedCashUsd: 21, openingFloatUsd: 20, supplierPaymentsUsd: 0 } }
    const bridge = (ops: any[]) => call("POST", "/api/sync/push", { deviceId: "hub", operations: ops }, { "x-cloud-key": KEY, "x-tenant-id": T })
    for (let round = 0; round < 2; round++) {
      const r = await bridge([open, close])
      expect(r.body.results.map((x: any) => x.status)).toEqual(["ok", "ok"])
    }
    const rows = await prisma.shift.findMany({ where: { tenantId: T, id: SH } })
    expect(rows.map((x) => [x.status, Number(x.openingFloatUsd), Number(x.closingCashUsd), Number(x.expectedCashUsd), Number(x.differenceUsd), x.deviceId])).toEqual([["Closed", 20, 21, 21, 0, "DEV-MVZXCELC-OA5K"]])
    expect(await prisma.syncOperation.count({ where: { id: { in: [OPEN, CLOSE] }, appliedAt: { not: null } } })).toBe(2)
    await prisma.syncOperation.deleteMany({ where: { id: { in: [OPEN, CLOSE] } } })
  })
})

describe("the shared drawer's day close", () => {
  const today = new Date().toISOString().slice(0, 10)
  const closeOp = (id: string, saleIds: string[], extra: Record<string, unknown> = {}) => ({ id: randomUUID(), entity: "daily-close", action: "close", payload: {
    id, dateKey: today, grossSales: saleIds.length * 5, refunds: 0, netSales: saleIds.length * 5, expenses: 0, cashIn: 0, cashOut: 0, note: "", closedBy: "Owner",
    registerId: "SHARED-DRAWER", tzOffsetMinutes: 0, saleIds, refundIds: [], createdAt: new Date().toISOString(), ...extra } })
  const current = () => prisma.dailyClose.findMany({ where: { tenantId: T, dateKey: today, supersededById: null } })
  const sale = async (n: string) => (await prisma.sale.create({ data: { id: `${n}-${T.slice(0, 6)}`, tenantId: T, saleNumber: n, paymentMethod: "Cash", subtotal: 5, tax: 0, total: 5, cashier: "IT" } as any })).id
  let s1 = "", s2 = "", s3 = ""
  beforeAll(async () => { s1 = await sale("DC-1"); s2 = await sale("DC-2") })

  it("a retry changes nothing; an explicit correction is a linked revision; a close that does not name the current one never replaces it", async () => {
    const a = randomUUID()
    const first = closeOp(a, [s1, s2])
    expect((await push(first)).status).toBe("ok")
    expect((await push(first)).status).toBe("ok") // the same operation again
    expect((await push(closeOp(a, [s1, s2]))).status).toBe("ok") // the same close in another operation
    expect((await current()).map((c) => [c.id, c.revision])).toEqual([[a, 1]])
    // another register's close of the same date, not naming the current one
    const other = await push(closeOp(randomUUID(), [s1, s2], { deviceId: "dev-phone" }))
    expect([other.status === "ok", other.error]).toEqual([false, expect.stringMatching(/CLOSE_CONFLICT: .*already closed for the shared drawer/)])
    expect((await current()).map((c) => c.id)).toEqual([a])
    // an explicit correction
    const c = randomUUID()
    expect((await push(closeOp(c, [s1, s2], { correctsId: a }))).status).toBe("ok")
    const cur = await current()
    expect(cur.map((x) => [x.id, x.revision, x.revisionOf, x.correction])).toEqual([[c, 2, a, "correction"]])
    expect((await prisma.dailyClose.findUnique({ where: { id: a } }))?.supersededById).toBe(c)
  })

  it("a register that has not received every sale of the day cannot close it (nothing lost); after syncing it can", async () => {
    s3 = await sale("DC-3")
    const prev = (await current())[0]
    const partial = await push(closeOp(randomUUID(), [s1, s2], { correctsId: prev.id }))
    expect([partial.status === "ok", partial.error]).toEqual([false, expect.stringMatching(/CLOSE_CONFLICT: .*leaves out 1 sale/)])
    expect((await current()).map((x) => x.id)).toEqual([prev.id])
    const full = randomUUID()
    expect((await push(closeOp(full, [s1, s2, s3], { correctsId: prev.id }))).status).toBe("ok")
    expect((await current()).map((x) => [x.id, Number(x.grossSales)])).toEqual([[full, 15]])
  })

  it("two registers correcting the same close at once: one becomes current, the other is kept for review; each sale counted once", async () => {
    const prev = (await current())[0]
    const [x, y] = await Promise.all([push(closeOp(randomUUID(), [s1, s2, s3], { correctsId: prev.id })), push(closeOp(randomUUID(), [s1, s2, s3], { correctsId: prev.id }))])
    expect([x, y].filter((r) => r.status === "ok")).toHaveLength(1)
    expect([x, y].find((r) => r.status !== "ok")?.error).toMatch(/CLOSE_CONFLICT/)
    const cur = await current()
    expect(cur).toHaveLength(1)
    expect(Number(cur[0].grossSales)).toBe(15)
  })
})

import { describe, it, expect, beforeAll, afterAll } from "vitest"
import http from "node:http"
import type { AddressInfo } from "node:net"
import { randomUUID } from "node:crypto"
import jwt from "jsonwebtoken"

// Release batch — recipe and unit edge cases, conservation, report reconciliation and cost visibility (real Postgres,
// real handlers, a direct store). Every ingredient's quantities are asserted to agree across all four records that
// hold them: product stock, its lots, the stock ledger (movements) and the sale lines' consumption records — after
// shared and substituted ingredients, many repeated fractional sales, a yield other than one, expired and used-up lots,
// archived options and ingredients, an old recipe revision sold offline, concurrent checkouts for the last serving,
// refunds (money only for drinks) and waste. Quantities the declared precision cannot hold are refused, never
// rounded into the order. Reports: base + options = revenue (options never counted twice), refunds apart, ingredient
// cost from the lots taken, real zero apart from unknown, the shift's totals; cost-hidden staff get no cost anywhere.
process.env.JWT_SECRET = process.env.JWT_SECRET || "cafe-edges-secret"
delete process.env.IS_LOCAL_SERVER
const prisma = (await import("../src/lib/prisma.js")).default
const app = (await import("../src/app.js")).default
const { vi } = await import("vitest")
vi.setConfig({ testTimeout: 120_000 })

const T = randomUUID()
const OWNER = randomUUID(), RANA = randomUUID(), SAM = randomUUID()
const t8 = T.slice(0, 8)
const SID = { beans: `beans-${t8}`, milk: `milk-${t8}`, oat: `oat-${t8}`, cups: `cups-${t8}`, syrup: `syrup-${t8}`, capp: `capp-${t8}`, esp: `esp-${t8}`, batch: `batch-${t8}`, water: `water-${t8}`, pepsi: `pepsi-${t8}` }
const G = { size: `g-size-${t8}`, milk: `g-milk-${t8}`, extra: `g-extra-${t8}` }
const O = { medium: `o-med-${t8}`, large: `o-large-${t8}`, whole: `o-whole-${t8}`, oat: `o-oat-${t8}`, vanilla: `o-van-${t8}` }
const REV = { capp1: `rcp-capp1-${t8}`, capp2: `rcp-capp2-${t8}`, esp: `rcp-esp-${t8}`, batch: `rcp-batch-${t8}`, water: `rcp-water-${t8}` }
const LOT = { beansOld: `lot-beans-old-${t8}`, beansExpired: `lot-beans-exp-${t8}`, beansNew: `lot-beans-new-${t8}`, syrup: `lot-syrup-${t8}` }
let server: http.Server
let base = ""
let owner = "", rana = "", sam = "", ownerPerson = "", samPerson = ""
let shiftId = ""
const ip = () => `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`
async function call(method: string, p: string, body?: unknown, headers: Record<string, string> = {}) {
  const r = await fetch(`${base}${p}`, { method, headers: { "Content-Type": "application/json", "x-titan-sync-schema": "6", "x-forwarded-for": ip(), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) })
  const text = await r.text()
  let parsed: any = null
  try { parsed = JSON.parse(text) } catch { parsed = text }
  return { status: r.status, body: parsed }
}
const sign = (userId: string, role: string, use: "transport" | "person" = "transport") => jwt.sign({ userId, tenantId: T, role, tokenVersion: 1, ...(use === "person" ? { use, client: "person" } : { use, client: "register" }) }, process.env.JWT_SECRET!, { expiresIn: "1h" })
async function push(token: string, entity: string, action: string, payload: unknown, opId: string = randomUUID()) {
  const r = await call("POST", "/api/sync/push", { deviceId: "edge-till", operations: [{ id: opId, entity, action, payload }] }, { Authorization: `Bearer ${token}` })
  return { ...(r.body?.results?.[0] ?? { status: `http-${r.status}`, error: JSON.stringify(r.body) }), opId }
}
const pid: Record<string, number> = {}
const ingredient = (syncId: string, name: string, stockUnit: string, purchaseUnit: string, unitsPerPurchase?: number) =>
  ({ syncId, name, price: 0, cost: 0, stock: 0, barcode: null, category: "Ingredients", stockPolicy: "tracked", sellable: false, stockUnit, purchaseUnit, ...(unitsPerPurchase ? { unitsPerPurchase } : {}) })
const lot = (syncId: string, name: string, purchaseUnit: string, purchaseQuantity: number, purchasePrice: number | null, stockQty: number, extra: Record<string, unknown> = {}) =>
  ({ id: randomUUID(), batchNumber: `L-${randomUUID().slice(0, 6)}`, productSyncId: syncId, productName: name, barcode: "", initialQuantity: stockQty, quantityRemaining: stockQty, unitPrice: 0, status: "Open", purchaseUnit, purchaseQuantity, purchasePrice, ...extra })
const mod = (groupId: string, optionId: string, name: string, priceDelta: number) => ({ groupId, optionId, name, groupName: groupId, priceDelta })
const MEDIUM = mod(G.size, O.medium, "Medium", 0), LARGE = mod(G.size, O.large, "Large", 0.75), WHOLE = mod(G.milk, O.whole, "Whole", 0), OAT = mod(G.milk, O.oat, "Oat", 0.5), VANILLA = mod(G.extra, O.vanilla, "Vanilla", 0.3)
function sale(lines: Array<Record<string, unknown>>, extra: Record<string, unknown> = {}) {
  const id = randomUUID()
  const total = Math.round(lines.reduce((s, l) => s + Number(l.total), 0) * 10000) / 10000
  return { id, saleNumber: `S-ED-${id.slice(0, 6)}`, paymentMethod: "Cash", subtotal: total, tax: 0, total, status: "Completed", createdAt: new Date().toISOString(), cashier: "Rana", cashierId: RANA, shiftId, items: lines, ...extra }
}
const drink = (sid: string, name: string, price: number, rev: string, qty: number, modifiers: Array<{ priceDelta: number }>, extra: Record<string, unknown> = {}) => {
  const unit = Math.round((price + modifiers.reduce((s, m) => s + m.priceDelta, 0)) * 10000) / 10000
  return { id: pid[sid], productSyncId: sid, lineId: randomUUID(), name, barcode: "", quantity: qty, unitPrice: unit, total: Math.round(unit * qty * 10000) / 10000, basePrice: price, stockPolicy: "recipe", stockPolicyRev: "initial", recipeRev: rev, modifiers, batchAllocations: [], ...extra }
}
const capp = (modifiers: Array<{ priceDelta: number }>, extra: Record<string, unknown> = {}) => drink(SID.capp, "Cappuccino", 3, REV.capp1, 1, modifiers, extra)
const esp = (modifiers: Array<{ priceDelta: number }> = [], extra: Record<string, unknown> = {}) => drink(SID.esp, "Espresso", 2, REV.esp, 1, modifiers, extra)

const stock = async (syncId: string) => Number((await prisma.product.findFirst({ where: { tenantId: T, syncId }, select: { stock: true } }))!.stock)
const lotLeft = async (id: string) => Number((await prisma.inventoryBatch.findFirst({ where: { tenantId: T, id }, select: { quantityRemaining: true } }))!.quantityRemaining)
const milli = (n: number) => Math.round(n * 1000)

/**
 * The four records agree, to the thousandth, for an ingredient: product stock = what its lots hold (+ stock without a
 * lot) = the ledger's sum of movements; and what the sale lines record as consumed = what the ledger records as sold.
 */
async function conserved(syncId: string) {
  const p = (await prisma.product.findFirst({ where: { tenantId: T, syncId } }))!
  const lots = await prisma.inventoryBatch.findMany({ where: { tenantId: T, productId: p.id } })
  const moves = await prisma.stockMovement.findMany({ where: { tenantId: T, productId: p.id } })
  const lines = await prisma.saleItem.findMany({ where: { sale: { tenantId: T, status: { not: "Voided" } }, stockPolicy: "recipe" }, select: { consumption: true } })
  const consumed = lines.flatMap((l) => (Array.isArray(l.consumption) ? (l.consumption as any[]) : [])).filter((c) => c.ingredientSyncId === syncId)
  const sold = moves.filter((m) => m.type === "Sale").reduce((s, m) => s + milli(Number(m.quantity)), 0)
  const stockM = milli(Number(p.stock))
  // stock never carries residue below the declared precision
  expect(Number(p.stock)).toBe(stockM / 1000)
  for (const l of lots) expect(Number(l.quantityRemaining)).toBe(milli(Number(l.quantityRemaining)) / 1000)
  const unlotted = consumed.flatMap((c) => c.allocations ?? []).filter((a: any) => !a.batchId).reduce((s: number, a: any) => s + milli(Number(a.quantity)), 0)
  return {
    stock: stockM,
    lots: lots.reduce((s, l) => s + milli(Number(l.quantityRemaining)), 0) - unlotted,
    ledger: moves.reduce((s, m) => s + milli(Number(m.quantity)), 0),
    consumed: consumed.reduce((s, c) => s + milli(Number(c.quantity)), 0),
    soldInLedger: -sold,
  }
}
async function expectConserved(syncId: string) {
  const c = await conserved(syncId)
  expect([c.lots, c.ledger]).toEqual([c.stock, c.stock])
  expect(c.consumed).toBe(c.soldInLedger)
  return c
}

beforeAll(async () => {
  server = http.createServer(app)
  await new Promise<void>((resolve) => server.listen(0, resolve))
  base = `http://localhost:${(server.address() as AddressInfo).port}`
  await prisma.tenant.create({ data: { id: T, name: "Cafe edges IT (disposable)", subdomain: `ce-${t8}`, cloudApiKey: randomUUID(), storeTopology: "direct", topologyVersion: 1 } })
  for (const [id, name, role, permissions] of [
    [OWNER, "Owner", "Admin", undefined],
    [RANA, "Rana", "Cashier", ["sales.checkout", "sales.refund", "sales.void", "inventory.view"]],
    // no cost visibility (reports, catalogue and books imply it): checkout, stock lookup, shift reports
    [SAM, "Sam", "Cashier", ["inventory.view", "sales.checkout", "shifts.manage"]],
  ] as const) await prisma.staffUser.create({ data: { id, tenantId: T, name, mobile: `ce-${id.slice(0, 8)}`, pin: "x", role, ...(permissions ? { permissions: [...permissions] } : {}) } as any })
  owner = sign(OWNER, "Admin"); rana = sign(RANA, "Cashier"); sam = sign(SAM, "Cashier")
  ownerPerson = sign(OWNER, "Admin", "person"); samPerson = sign(SAM, "Cashier", "person")
})

afterAll(async () => {
  const where = { tenantId: T }
  for (const m of ["syncOperation", "syncClient", "auditEvent", "stockAdjustment", "stockMovement", "refundItem", "saleRefund", "saleTender", "saleItem", "sale", "inventoryBatch", "shift", "modifierGroup", "recipeRevision", "operationEvidence", "product", "staffUser"] as const) {
    if (m === "refundItem") await (prisma as any).refundItem.deleteMany({ where: { refund: { tenantId: T } } }).catch(() => undefined)
    else if (m === "saleItem" || m === "saleTender") await (prisma as any)[m].deleteMany({ where: { sale: { tenantId: T } } }).catch(() => undefined)
    else await (prisma as any)[m].deleteMany({ where }).catch(() => undefined)
  }
  await prisma.appSettings.deleteMany({ where }).catch(() => undefined)
  await prisma.tenant.deleteMany({ where: { id: T } })
  await prisma.$disconnect()
  await new Promise<void>((resolve) => server.close(() => resolve()))
})

describe("setup", () => {
  it("ingredients, lots (one expired, one free, one without a price), options, drinks and recipes; an open shift", async () => {
    for (const p of [ingredient(SID.beans, "Coffee beans", "g", "kg"), ingredient(SID.milk, "Whole milk", "ml", "L"), ingredient(SID.oat, "Oat milk", "ml", "L"),
      ingredient(SID.cups, "Cups", "unit", "pack", 50), ingredient(SID.syrup, "Vanilla syrup", "ml", "ml")]) expect((await push(owner, "product", "create", p)).status).toBe("ok")
    expect((await push(owner, "product", "create", { syncId: SID.pepsi, name: "Pepsi", price: 1, cost: 0.4, stock: 0, barcode: `p-${t8}`, category: "Drinks" })).status).toBe("ok")
    for (const g of [
      { id: G.size, name: "Size", required: true, minSelect: 1, maxSelect: 1, options: [{ id: O.medium, name: "Medium", priceDelta: 0, isDefault: true }, { id: O.large, name: "Large", priceDelta: 0.75 }] },
      { id: G.milk, name: "Milk", required: true, maxSelect: 1, options: [{ id: O.whole, name: "Whole", priceDelta: 0, isDefault: true }, { id: O.oat, name: "Oat", priceDelta: 0.5 }] },
      { id: G.extra, name: "Extra", required: false, maxSelect: 1, options: [{ id: O.vanilla, name: "Vanilla", priceDelta: 0.3 }, { id: `${O.vanilla}-c`, name: "Caramel", priceDelta: 0.3 }] },
    ]) expect((await push(owner, "modifier-group", "create", g)).status).toBe("ok")
    for (const d of [
      { syncId: SID.capp, name: "Cappuccino", price: 3, modifierGroupIds: [G.size, G.milk, G.extra] },
      { syncId: SID.esp, name: "Espresso", price: 2, modifierGroupIds: [G.extra] },
      { syncId: SID.batch, name: "Batch brew", price: 2.5, modifierGroupIds: [] },
      { syncId: SID.water, name: "Water cup", price: 0.5, modifierGroupIds: [] },
    ]) expect((await push(owner, "product", "create", { ...d, cost: 0, stock: 0, barcode: null, category: "Coffee", stockPolicy: "recipe" })).status).toBe("ok")
    for (const p of await prisma.product.findMany({ where: { tenantId: T }, select: { id: true, syncId: true } })) pid[p.syncId!] = p.id
    const milkBy = (size: string, ml: number) => [{ ingredientSyncId: SID.milk, quantity: ml, when: [size], unless: [O.oat] }, { ingredientSyncId: SID.oat, quantity: ml, when: [size, O.oat] }]
    // Cappuccino: 18 g beans, milk (or oat instead) by size, 0.3 ml syrup with vanilla, a cup
    expect((await push(owner, "recipe", "create", { id: REV.capp1, productSyncId: SID.capp, yield: 1, lines: [
      { ingredientSyncId: SID.beans, quantity: 18 }, ...milkBy(O.medium, 200), ...milkBy(O.large, 250), { ingredientSyncId: SID.syrup, quantity: "0.3", when: [O.vanilla] }, { ingredientSyncId: SID.cups, quantity: 1 }] })).status).toBe("ok")
    expect((await push(owner, "recipe", "create", { id: REV.esp, productSyncId: SID.esp, yield: 1, lines: [{ ingredientSyncId: SID.beans, quantity: "9.5" }, { ingredientSyncId: SID.syrup, quantity: "0.3", when: [O.vanilla] }, { ingredientSyncId: SID.cups, quantity: 1 }] })).status).toBe("ok")
    // a batch recipe: 50 g of beans and 3 cups make 3 servings (16.667 g and one cup per serving)
    expect((await push(owner, "recipe", "create", { id: REV.batch, productSyncId: SID.batch, yield: 3, lines: [{ ingredientSyncId: SID.beans, quantity: 50 }, { ingredientSyncId: SID.cups, quantity: 3 }] })).status).toBe("ok")
    expect((await push(owner, "recipe", "create", { id: REV.water, productSyncId: SID.water, yield: 1, lines: [{ ingredientSyncId: SID.cups, quantity: 1 }] })).status).toBe("ok")
    // beans: an old lot (earliest), an EXPIRED one (marked, earlier still), a new one; cups are free (a real zero);
    // the syrup has no price at all (unknown)
    expect((await push(owner, "inventory", "receive", [
      { ...lot(SID.beans, "Coffee beans", "g", 100, 0.02, 100, { expiryDate: "2027-01-01" }), id: LOT.beansOld },
      { ...lot(SID.beans, "Coffee beans", "g", 300, 0.02, 300, { expiryDate: "2026-12-01" }), id: LOT.beansExpired },
      { ...lot(SID.beans, "Coffee beans", "kg", 2, 15, 2000, { expiryDate: "2027-06-01" }), id: LOT.beansNew },
      lot(SID.milk, "Whole milk", "L", 3, 1, 3000), lot(SID.oat, "Oat milk", "L", 1, 2.5, 1000),
      lot(SID.cups, "Cups", "pack", 4, 0, 200, { unitsPerPurchase: 50 }),
      { ...lot(SID.syrup, "Vanilla syrup", "ml", 100, null, 100, { unitCost: 0 }), id: LOT.syrup },
    ])).status).toBe("ok")
    expect((await push(owner, "inventory", "update", [{ id: LOT.beansExpired, status: "Expired" }])).status).toBe("ok")
    expect((await push(owner, "inventory", "receive", [{ id: randomUUID(), batchNumber: "L-PEP", productSyncId: SID.pepsi, productName: "Pepsi", barcode: `p-${t8}`, initialQuantity: 24, quantityRemaining: 24, unitCost: 0.4, unitPrice: 1, status: "Open" }])).status).toBe("ok")
    shiftId = `shift-${randomUUID()}`
    expect((await push(owner, "shift", "open", { id: shiftId, shiftNumber: `SH-${t8}`, openedAt: new Date().toISOString(), openedById: OWNER, openedByName: "Owner", openingFloatUsd: 0, status: "Open" })).status).toBe("ok")
    expect(await stock(SID.beans)).toBe(2400)
  })
})

describe("recipe edge cases, with conservation", () => {
  it("two drinks sharing beans and a substituted milk in one cart; the expired lot is skipped (FEFO over open lots)", async () => {
    const s = sale([capp([LARGE, OAT]), capp([MEDIUM, WHOLE]), esp()])
    expect((await push(rana, "sale", "create", s)).status).toBe("ok")
    // beans 18 + 18 + 9.5; oat 250 (instead of milk); milk 200; 3 cups
    expect([await stock(SID.beans), await stock(SID.oat), await stock(SID.milk), await stock(SID.cups)]).toEqual([2354.5, 750, 2800, 197])
    // taken from the old lot (the expired one, though earlier, is never used)
    expect([await lotLeft(LOT.beansOld), await lotLeft(LOT.beansExpired), await lotLeft(LOT.beansNew)]).toEqual([54.5, 300, 2000])
    for (const i of [SID.beans, SID.milk, SID.oat, SID.cups]) await expectConserved(i)
  })

  it("a used-up lot is never taken again: the next sales move on to the newer lot", async () => {
    let lastSale = ""
    for (let i = 0; i < 6; i++) { const s = sale([esp()]); lastSale = s.id; expect((await push(rana, "sale", "create", s)).status).toBe("ok") }
    // 54.5 − 5 × 9.5 = 7; the sixth takes 7 from the old lot and 2.5 from the new
    expect([await lotLeft(LOT.beansOld), await lotLeft(LOT.beansNew)]).toEqual([0, 1997.5])
    expect((await prisma.inventoryBatch.findFirst({ where: { id: LOT.beansOld } }))!.status).toBe("Consumed")
    const last = await prisma.saleItem.findFirst({ where: { saleId: lastSale } })
    expect(((last!.consumption as any[]).find((c) => c.ingredientSyncId === SID.beans).allocations as any[]).map((a) => [a.batchId, a.quantity])).toEqual([[LOT.beansOld, 7], [LOT.beansNew, 2.5]])
    await expectConserved(SID.beans)
  })

  it("100 sales of 0.3 ml of syrup: exactly 30 ml, no drift in stock, lots or the ledger", async () => {
    for (let i = 0; i < 100; i++) expect((await push(rana, "sale", "create", sale([esp([VANILLA])]))).status).toBe("ok")
    expect(await stock(SID.syrup)).toBe(70)
    const c = await expectConserved(SID.syrup)
    expect(c.consumed).toBe(30_000)
    // ten corrections of +0.1 ml: exactly 71
    for (let i = 0; i < 10; i++) expect((await push(owner, "inventory", "adjust", { id: randomUUID(), adjustmentNumber: `ADJ-${i}`, productSyncId: SID.syrup, productName: "Vanilla syrup", barcode: "", quantityBefore: 0, quantityChange: 0.1, quantityAfter: 0, reason: "Count Correction", batchAllocations: [{ batchId: LOT.syrup, quantity: 0.1 }], createdAt: new Date().toISOString() })).status).toBe("ok")
    expect(await stock(SID.syrup)).toBe(71)
    expect(milli((await prisma.stockMovement.findMany({ where: { tenantId: T, productId: pid[SID.syrup] } })).reduce((s, m) => s + Number(m.quantity), 0))).toBe(71_000)
  })

  it("a yield of 3: one serving takes 16.667 g (rounded half up once); three servings take exactly 50 g", async () => {
    const before = await stock(SID.beans)
    expect((await push(rana, "sale", "create", sale([drink(SID.batch, "Batch brew", 2.5, REV.batch, 1, [])]))).status).toBe("ok")
    expect(milli(before - (await stock(SID.beans)))).toBe(16_667)
    const mid = await stock(SID.beans)
    expect((await push(rana, "sale", "create", sale([drink(SID.batch, "Batch brew", 2.5, REV.batch, 3, [])]))).status).toBe("ok")
    expect(milli(mid - (await stock(SID.beans)))).toBe(50_000)
    await expectConserved(SID.beans)
  })

  it("quantities the declared precision cannot hold are refused, never rounded into the order", async () => {
    const beans = await stock(SID.beans)
    const bad = await push(rana, "sale", "create", sale([drink(SID.esp, "Espresso", 2, REV.esp, 1.0005, [])]), `wt-${randomUUID()}`)
    expect([bad.status, /PRODUCT_SETUP: "Espresso": 1\.0005 is not a supported quantity/.test(bad.error)]).toEqual(["rejected", true])
    const adj = await push(owner, "inventory", "adjust", { id: randomUUID(), adjustmentNumber: "ADJ-P", productSyncId: SID.beans, productName: "Coffee beans", barcode: "", quantityBefore: 0, quantityChange: -0.0004, quantityAfter: 0, reason: "Count Correction", batchAllocations: [], createdAt: new Date().toISOString() })
    expect([adj.status, /PRODUCT_SETUP: "Coffee beans": -0\.0004 g is not a supported quantity/.test(adj.error)]).toEqual(["rejected", true])
    const rec = await push(owner, "inventory", "receive", [lot(SID.beans, "Coffee beans", "g", 1.0005, 1, 1.0005)])
    expect(rec.status).toBe("rejected")
    const recipe = await push(owner, "recipe", "create", { id: `rcp-bad-${t8}`, productSyncId: SID.esp, yield: 1, lines: [{ ingredientSyncId: SID.beans, quantity: "9.0005" }] })
    expect(recipe.error).toMatch(/precision/)
    expect(await stock(SID.beans)).toBe(beans)
  })

  it("an archived option: a paid (queued) sale keeps what was sold and records the conflict; a live checkout is refused", async () => {
    const arch = await push(owner, "modifier-group", "update", { id: G.extra, name: "Extra", required: false, maxSelect: 1, options: [{ id: O.vanilla, name: "Vanilla", priceDelta: 0.3, archived: true }, { id: `${O.vanilla}-c`, name: "Caramel", priceDelta: 0.3 }] })
    expect([arch.status, arch.error]).toEqual(["ok", undefined])
    const live = await push(rana, "sale", "create", sale([esp([VANILLA])]), `wt-${randomUUID()}`)
    expect([live.status, /^MODIFIERS_INVALID:/.test(live.error)]).toEqual(["rejected", true])
    const paid = sale([esp([VANILLA])])
    expect((await push(rana, "sale", "create", paid)).status).toBe("ok")
    const line = await prisma.saleItem.findFirst({ where: { saleId: paid.id } })
    expect([line!.modifierConflict != null, (line!.modifiers as any[]).map((m) => m.name)]).toEqual([true, ["Vanilla"]])
    expect((await push(owner, "modifier-group", "update", { id: G.extra, name: "Extra", required: false, maxSelect: 1, options: [{ id: O.vanilla, name: "Vanilla", priceDelta: 0.3 }, { id: `${O.vanilla}-c`, name: "Caramel", priceDelta: 0.3 }] })).status).toBe("ok")
  })

  it("an archived ingredient with stock is still taken by the recipes that name it (history and names stay)", async () => {
    expect((await push(owner, "product", "update", { syncId: SID.syrup, archived: true })).status).toBe("ok")
    const before = await stock(SID.syrup)
    expect((await push(rana, "sale", "create", sale([esp([VANILLA])]))).status).toBe("ok")
    expect(milli(before - (await stock(SID.syrup)))).toBe(300)
    await expectConserved(SID.syrup)
    expect((await push(owner, "product", "update", { syncId: SID.syrup, archived: false })).status).toBe("ok")
  })

  it("a recipe changed while another till was offline: its sale is made with the revision it was sold under", async () => {
    expect((await push(owner, "recipe", "create", { id: REV.capp2, productSyncId: SID.capp, parentRev: REV.capp1, yield: 1, lines: [{ ingredientSyncId: SID.beans, quantity: 20 }, { ingredientSyncId: SID.milk, quantity: 180 }, { ingredientSyncId: SID.cups, quantity: 1 }] })).status).toBe("ok")
    const beans = await stock(SID.beans), milk = await stock(SID.milk)
    // the offline till still sold with revision 1 (18 g, medium whole 200 ml)
    expect((await push(rana, "sale", "create", sale([capp([MEDIUM, WHOLE], { recipeRev: REV.capp1 })]))).status).toBe("ok")
    expect([milli(beans - (await stock(SID.beans))), milli(milk - (await stock(SID.milk)))]).toEqual([18_000, 200_000])
  })

  it("concurrent checkouts for the last serving: exactly one is taken, the other refused before payment; stock never below zero", async () => {
    const left = await stock(SID.oat)
    // leave 250 ml of oat milk: one large oat cappuccino
    expect((await push(owner, "inventory", "waste", { id: `waste-${randomUUID()}`, productSyncId: SID.oat, productName: "Oat milk", quantity: left - 250, reason: "Waste", note: "spilled jug" })).status).toBe("ok")
    expect(await stock(SID.oat)).toBe(250)
    const [a, b] = await Promise.all([0, 1].map(() => push(rana, "sale", "create", sale([drink(SID.capp, "Cappuccino", 3, REV.capp2, 1, [LARGE, OAT], { recipeRev: REV.capp1 })]), `wt-${randomUUID()}`)))
    expect([a.status, b.status].sort()).toEqual(["ok", "rejected"])
    expect([a, b].find((r) => r.status === "rejected")!.error).toMatch(/^INGREDIENT_SHORT:/)
    expect(await stock(SID.oat)).toBe(0)
    await expectConserved(SID.oat)
  })

  it("every ingredient: stock = lots = ledger, and consumption records = the ledger's sales, to the thousandth", async () => {
    for (const i of [SID.beans, SID.milk, SID.oat, SID.cups, SID.syrup]) await expectConserved(i)
  })
})

describe("returns, reports and cost visibility", () => {
  let cappSale: ReturnType<typeof sale>
  it("a drink refund gives money back and nothing to stock; a packaged return restores its exact lot", async () => {
    cappSale = sale([capp([LARGE, WHOLE]), { id: pid[SID.pepsi], productSyncId: SID.pepsi, lineId: randomUUID(), name: "Pepsi", barcode: `p-${t8}`, quantity: 2, unitPrice: 1, total: 2, stockPolicy: "tracked", stockPolicyRev: "initial", batchAllocations: [] }])
    expect((await push(rana, "sale", "create", cappSale)).status).toBe("ok")
    const beans = await stock(SID.beans), milk = await stock(SID.milk), pepsi = await stock(SID.pepsi)
    const [drinkLine, can] = cappSale.items as any[]
    const refundId = randomUUID()
    expect((await push(rana, "refund", "create", { id: refundId, refundNumber: `R-${t8}`, saleId: cappSale.id, saleNumber: cappSale.saleNumber, method: "Cash", reason: "cold", total: 4.75, cashier: "Rana", cashierId: RANA, shiftId,
      items: [{ id: pid[SID.capp], saleLineId: drinkLine.lineId, name: "Cappuccino", quantity: 1, unitPrice: 3.75, total: 3.75 }, { id: pid[SID.pepsi], saleLineId: can.lineId, name: "Pepsi", quantity: 1, unitPrice: 1, total: 1 }] })).status).toBe("ok")
    expect([await stock(SID.beans), await stock(SID.milk), await stock(SID.pepsi)]).toEqual([beans, milk, pepsi + 1])
    for (const i of [SID.beans, SID.milk]) await expectConserved(i)
  })

  it("reports reconcile: base + options = revenue (options once), refunds apart, ingredient cost from the lots taken, real zero apart from unknown, the shift's totals", async () => {
    // a water cup is made from a free cup: a real zero cost, with a margin
    expect((await push(rana, "sale", "create", sale([drink(SID.water, "Water cup", 0.5, REV.water, 2, [])]))).status).toBe("ok")
    const rep = await call("GET", "/api/reports/cafe?days=1", undefined, { Authorization: `Bearer ${ownerPerson}` })
    expect(rep.status).toBe(200)
    const lines = await prisma.saleItem.findMany({ where: { sale: { tenantId: T, status: { not: "Voided" } }, stockPolicy: "recipe" } })
    const cents = (n: number) => Math.round(n * 100)
    expect(cents(rep.body.summary.revenue)).toBe(cents(lines.reduce((s, l) => s + Number(l.total), 0)))
    expect(cents(rep.body.summary.baseRevenue + rep.body.summary.modifierRevenue)).toBe(cents(rep.body.summary.revenue))
    // options counted once: Σ (unit − base) × qty over the lines
    expect(cents(rep.body.summary.modifierRevenue)).toBe(cents(lines.reduce((s, l) => s + (Number(l.unitPrice) - Number(l.basePrice)) * Number(l.quantity), 0)))
    expect(rep.body.summary.refunds).toBe(3.75)
    // ingredient cost = Σ the consumption records' lot costs (known lines)
    const capp = rep.body.drinks.find((d: any) => d.name === "Cappuccino")
    expect(capp.refunds).toBe(3.75)
    expect(capp.margin).toBe(Math.round((capp.revenue - capp.refunds - capp.ingredientCost) * 100) / 100)
    const water = rep.body.drinks.find((d: any) => d.name === "Water cup")
    expect([water.ingredientCost, water.costStatus, water.margin]).toEqual([0, "known", 1])
    // the syrup has no price: espressos with vanilla are partly of unknown cost and have no margin
    const espRow = rep.body.drinks.find((d: any) => d.name === "Espresso")
    expect([espRow.costStatus, espRow.margin]).toEqual(["partial", null])
    // the shift: sales and refunds as recorded; the cost of sales includes the drinks' lot cost
    const x = await call("GET", "/api/reports/x-report", undefined, { Authorization: `Bearer ${ownerPerson}` })
    expect(x.status).toBe(200)
    const sales = await prisma.sale.findMany({ where: { tenantId: T, shiftId, status: { not: "Voided" } } })
    expect(cents(x.body.sales.total)).toBe(cents(sales.reduce((s, v) => s + Number(v.total), 0)))
    expect(x.body.refunds.total).toBe(4.75)
    expect(cents(x.body.sales.cost)).toBe(cents(sales.reduce((s, v) => s + Number(v.cost), 0)))
  })

  it("staff without cost visibility: no cost anywhere — reports, sales and their consumption details, exports, pulls", async () => {
    const auth = { Authorization: `Bearer ${samPerson}` }
    const costKeys = /"(cost|profit|margin|unitCost|purchasePrice|valueImpact|ingredientCost|wasteCost|costKnown|costStatus|totalCost|wholesalePrice)"/
    const leak = (body: unknown) => JSON.stringify(body).match(costKeys)?.[0] ?? null
    // the café report and the sales list need reports (which imply cost): refused, with nothing in the refusal
    for (const path of ["/api/reports/cafe?days=1", "/api/sales?limit=500", "/api/reports/margin?days=1"]) {
      const r = await call("GET", path, undefined, auth)
      expect([r.status, leak(r.body)]).toEqual([403, null])
    }
    // the shift report and the product list: figures without cost
    const x = await call("GET", "/api/reports/x-report", undefined, auth)
    expect([x.status, leak(x.body)]).toEqual([200, null])
    const products = await call("GET", "/api/products", undefined, auth)
    expect([products.status, leak(products.body)]).toEqual([200, null])
    expect((await call("GET", "/api/reports/export/margin", undefined, auth)).status).toBe(403)
    // the register's own download: sales with their consumption details, lots, adjustments, recipes — no cost
    const pull = await call("GET", "/api/sync/pull", undefined, { Authorization: `Bearer ${sam}` })
    expect(pull.status).toBe(200)
    expect(JSON.stringify(pull.body.sales ?? [])).toMatch(/"consumption"/)
    // (a wholesale price is a selling price the register needs for a named customer's sale, not a cost)
    expect(JSON.stringify(pull.body).match(/"(cost|profit|margin|unitCost|purchasePrice|valueImpact|ingredientCost|wasteCost|costKnown|costStatus|totalCost)"/)?.[0] ?? null).toBeNull()
    // an account with cost visibility gets the same details with cost (the control)
    const ownerPull = await call("GET", "/api/sync/pull", undefined, { Authorization: `Bearer ${owner}` })
    expect(leak(ownerPull.body)).not.toBeNull()
  })
})

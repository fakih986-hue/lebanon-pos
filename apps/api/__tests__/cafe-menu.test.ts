import { describe, it, expect, beforeAll, afterAll } from "vitest"
import http from "node:http"
import type { AddressInfo } from "node:net"
import { randomUUID } from "node:crypto"
import jwt from "jsonwebtoken"

// Café batch (real Postgres, real handlers): modifier groups, recipes and ingredient stock, end to end through the
// sync push the registers use. A direct store in observe mode (the connection account's permissions decide): the
// owner sets up ingredients in grams/millilitres/units, receives them in purchase units, defines the menu and
// recipes; a cashier sells configured drinks with packaged goods. Under test: exact unit conversion and cost from
// the invoice price, consumption by the revision a drink was made with (never today's), the line's immutable
// option snapshot, server price floor with options, conflicts recorded on paid sales but a live checkout refused,
// refunds and voids that never restore ingredients, remake/waste once per event, unknown revisions held and
// retried (or resolved by a manager), ingredient shortfalls held for review, cost data withheld, older registers
// never seeing recipe drinks, the recipe upgrade gate, the café report, and delivery refused in a hub store.
process.env.JWT_SECRET = process.env.JWT_SECRET || "cafe-menu-secret"
delete process.env.IS_LOCAL_SERVER
const prisma = (await import("../src/lib/prisma.js")).default
const app = (await import("../src/app.js")).default
const bcrypt = (await import("bcryptjs")).default
const { topologyReadiness } = await import("../src/lib/topology.js")
const { vi } = await import("vitest")
vi.setConfig({ testTimeout: 60_000 })

const T = randomUUID(), HUBT = randomUUID()
const OWNER = randomUUID(), MAYA = randomUUID(), RANA = randomUUID()
const id8 = T.slice(0, 8)
const SID = { beans: `beans-${id8}`, milk: `milk-${id8}`, oat: `oat-${id8}`, syrup: `syrup-${id8}`, cups: `cups-${id8}`, capp: `capp-${id8}`, esp: `esp-${id8}`, pepsi: `pepsi-${id8}`, tea: `tea-${id8}`, mystery: `myst-${id8}` }
const G = { size: `g-size-${id8}`, milk: `g-milk-${id8}`, shot: `g-shot-${id8}` }
const O = { small: `o-small-${id8}`, medium: `o-med-${id8}`, large: `o-large-${id8}`, whole: `o-whole-${id8}`, oat: `o-oat-${id8}`, shot: `o-shot-${id8}` }
const REV = { capp1: `rcp-capp1-${id8}`, capp2: `rcp-capp2-${id8}`, cappSide: `rcp-capp-side-${id8}`, esp1: `rcp-esp1-${id8}`, ghost: `rcp-ghost-${id8}`, myst: `rcp-myst-${id8}` }
let server: http.Server
let base = ""
let owner = "", rana = "", ranaPerson = "", ownerPerson = ""
const pid: Record<string, number> = {}
const ip = () => `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`
async function call(method: string, p: string, body?: unknown, headers: Record<string, string> = {}) {
  const r = await fetch(`${base}${p}`, { method, headers: { "Content-Type": "application/json", "x-titan-sync-schema": "6", "x-forwarded-for": ip(), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) })
  return { status: r.status, body: (await r.json().catch(() => null)) as any }
}
const sign = (userId: string, tenantId: string, role: string, use: "transport" | "person" = "transport") => jwt.sign({ userId, tenantId, role, tokenVersion: 1, ...(use === "person" ? { use, client: "person" } : { use, client: "register" }) }, process.env.JWT_SECRET!, { expiresIn: "1h" })
async function push(token: string, entity: string, action: string, payload: unknown, opId = randomUUID()) {
  const r = await call("POST", "/api/sync/push", { deviceId: "cafe-till", operations: [{ id: opId, entity, action, payload }] }, { Authorization: `Bearer ${token}` })
  return { ...(r.body?.results?.[0] ?? { status: `http-${r.status}`, error: JSON.stringify(r.body) }), opId }
}
const stock = async (syncId: string) => Number((await prisma.product.findFirst({ where: { tenantId: T, syncId }, select: { stock: true } }))!.stock)
const lots = async (syncId: string) => (await prisma.inventoryBatch.findMany({ where: { tenantId: T, productId: pid[syncId] }, orderBy: [{ receivedAt: "asc" }, { id: "asc" }] })).map((b) => ({ id: b.id, left: Number(b.quantityRemaining), status: b.status }))
const ingredient = (syncId: string, name: string, stockUnit: string, purchaseUnit: string, unitsPerPurchase?: number) =>
  ({ syncId, name, price: 0, cost: 0, stock: 0, barcode: null, category: "Ingredients", stockPolicy: "tracked", sellable: false, stockUnit, purchaseUnit, ...(unitsPerPurchase ? { unitsPerPurchase } : {}) })
const lot = (syncId: string, name: string, purchaseUnit: string, purchaseQuantity: number, purchasePrice: number, stockQty: number, extra: Record<string, unknown> = {}) => {
  const id = randomUUID()
  return { id, batchNumber: `L-${id.slice(0, 6)}`, productSyncId: syncId, productName: name, barcode: "", initialQuantity: stockQty, quantityRemaining: stockQty, unitPrice: 0, status: "Open", purchaseUnit, purchaseQuantity, purchasePrice, supplierReference: "INV-77", ...extra }
}
const mod = (groupId: string, optionId: string, name: string, priceDelta: number) => ({ groupId, optionId, name, groupName: groupId, priceDelta })
const LARGE = mod(G.size, O.large, "Large", 0.75), MEDIUM = mod(G.size, O.medium, "Medium", 0), OAT = mod(G.milk, O.oat, "Oat", 0.5), WHOLE = mod(G.milk, O.whole, "Whole", 0), SHOT = mod(G.shot, O.shot, "Extra shot", 0.75)
function sale(lines: Array<Record<string, unknown>>, extra: Record<string, unknown> = {}) {
  const id = randomUUID()
  const total = lines.reduce((s, l) => s + Number(l.total), 0)
  return { id, saleNumber: `S-CM-${id.slice(0, 6)}`, paymentMethod: "Cash", subtotal: total, tax: 0, total, status: "Completed", createdAt: new Date().toISOString(), cashier: "Rana", cashierId: RANA, items: lines, ...extra }
}
const capp = (qty: number, unitPrice: number, modifiers: unknown[], extra: Record<string, unknown> = {}) => ({ id: pid[SID.capp], productSyncId: SID.capp, lineId: randomUUID(), name: "Cappuccino", barcode: "", quantity: qty, unitPrice, total: unitPrice * qty, basePrice: 3, stockPolicy: "recipe", stockPolicyRev: "initial", recipeRev: REV.capp1, modifiers, batchAllocations: [], ...extra })
const pepsi = (qty = 1) => ({ id: pid[SID.pepsi], productSyncId: SID.pepsi, lineId: randomUUID(), name: "Pepsi", barcode: SID.pepsi, quantity: qty, unitPrice: 1, total: qty, stockPolicy: "tracked", stockPolicyRev: "initial", batchAllocations: [{ batchId: "legacy-stock", quantity: qty }] })

beforeAll(async () => {
  server = http.createServer(app)
  await new Promise<void>((resolve) => server.listen(0, resolve))
  base = `http://localhost:${(server.address() as AddressInfo).port}`
  await prisma.tenant.create({ data: { id: T, name: "Cafe menu IT (disposable)", subdomain: `cm-${id8}`, cloudApiKey: randomUUID(), storeTopology: "direct", topologyVersion: 1 } })
  for (const [id, name, role, permissions] of [
    [OWNER, "Owner", "Admin", undefined], [MAYA, "Maya", "Manager", undefined],
    [RANA, "Rana", "Cashier", ["sales.checkout", "sales.refund", "sales.void", "inventory.view"]],
  ] as const) await prisma.staffUser.create({ data: { id, tenantId: T, name, mobile: `cm-${id.slice(0, 8)}`, pin: await bcrypt.hash(`9${id.slice(0, 3).replace(/\D/g, "1")}`, 4), role, ...(permissions ? { permissions: [...permissions] } : {}) } as any })
  owner = sign(OWNER, T, "Admin"); rana = sign(RANA, T, "Cashier")
  ownerPerson = sign(OWNER, T, "Admin", "person"); ranaPerson = sign(RANA, T, "Cashier", "person")
  // a hub store (its stock is kept at its hub) for the delivery boundary
  await prisma.tenant.create({ data: { id: HUBT, name: "Cafe hub store IT (disposable)", subdomain: `cmh-${id8}`, cloudApiKey: randomUUID(), storeTopology: "hub", topologyHubId: "hubi-test", topologyVersion: 1 } })
})

afterAll(async () => {
  for (const tenantId of [T, HUBT]) {
    const where = { tenantId }
    for (const m of ["syncOperation", "syncClient", "auditEvent", "stockAdjustment", "inventoryBatch", "stockMovement", "refundItem", "saleRefund", "saleTender", "saleItem", "sale", "deliveryOrderItem", "deliveryOrder", "modifierGroup", "recipeRevision", "product", "staffUser"] as const) {
      if (m === "refundItem") await (prisma as any).refundItem.deleteMany({ where: { refund: { tenantId } } }).catch(() => undefined)
      else if (m === "saleItem" || m === "saleTender") await (prisma as any)[m].deleteMany({ where: { sale: { tenantId } } }).catch(() => undefined)
      else if (m === "deliveryOrderItem") await (prisma as any).deliveryOrderItem.deleteMany({ where: { deliveryOrder: { tenantId } } }).catch(() => undefined)
      else await (prisma as any)[m].deleteMany({ where }).catch(() => undefined)
    }
    await prisma.appSettings.deleteMany({ where }).catch(() => undefined)
    await prisma.tenant.deleteMany({ where: { id: tenantId } })
  }
  await prisma.$disconnect()
  await new Promise<void>((resolve) => server.close(() => resolve()))
})

describe("café menu: setup, receiving in purchase units", () => {
  it("ingredients take only compatible purchase units; recipe drinks, packaged goods and groups are set up by the owner", async () => {
    // kg cannot be converted to millilitres: refused before anything is saved
    const bad = await push(owner, "product", "create", ingredient(`bad-${id8}`, "Bad milk", "ml", "kg"))
    expect(bad.status).toBe("rejected")
    expect(bad.error).toMatch(/PRODUCT_SETUP: kg cannot be converted to ml/)
    expect(await prisma.product.count({ where: { tenantId: T, syncId: `bad-${id8}` } })).toBe(0)
    for (const p of [
      ingredient(SID.beans, "Coffee beans", "g", "kg"), ingredient(SID.milk, "Whole milk", "ml", "L"), ingredient(SID.oat, "Oat milk", "ml", "L"),
      ingredient(SID.syrup, "Vanilla syrup", "ml", "ml"), ingredient(SID.cups, "Cups", "unit", "pack", 50), ingredient(SID.mystery, "Sample beans", "g", "g"),
    ]) expect((await push(owner, "product", "create", p)).status).toBe("ok")
    expect((await push(owner, "product", "create", { syncId: SID.pepsi, name: "Pepsi", price: 1, cost: 0.4, stock: 0, barcode: SID.pepsi, category: "Drinks" })).status).toBe("ok")
    expect((await push(owner, "product", "create", { syncId: SID.tea, name: "House tea", price: 1.5, cost: 0, stock: 0, barcode: null, category: "Drinks", stockPolicy: "untracked" })).status).toBe("ok")
    for (const p of await prisma.product.findMany({ where: { tenantId: T }, select: { id: true, syncId: true } })) pid[p.syncId!] = p.id
    const cups = await prisma.product.findFirst({ where: { tenantId: T, syncId: SID.cups } })
    expect([cups!.sellable, cups!.stockUnit, cups!.purchaseUnit, Number(cups!.unitsPerPurchase)]).toEqual([false, "unit", "pack", 50])

    // the cashier cannot change the menu (catalogue management)
    const denied = await push(rana, "modifier-group", "create", { id: `g-x-${id8}`, name: "Sneaky", options: [{ id: "x", name: "x", priceDelta: -1 }] })
    expect(denied.status).not.toBe("ok")
    expect(await (prisma as any).modifierGroup.count({ where: { tenantId: T } })).toBe(0)
    // a required group needs options; min above the options is refused
    expect((await push(owner, "modifier-group", "create", { id: `g-bad-${id8}`, name: "Broken", required: true, minSelect: 3, maxSelect: 3, options: [{ id: "a", name: "A", priceDelta: 0 }] })).error).toMatch(/PRODUCT_SETUP: modifier group "Broken" is not valid \(min-max\)/)
    expect((await push(owner, "modifier-group", "create", { id: G.size, name: "Size", nameAr: "الحجم", required: true, minSelect: 1, maxSelect: 1, options: [
      { id: O.small, name: "Small", nameAr: "صغير", priceDelta: -0.25, sortOrder: 1 }, { id: O.medium, name: "Medium", nameAr: "وسط", priceDelta: 0, isDefault: true, sortOrder: 2 }, { id: O.large, name: "Large", nameAr: "كبير", priceDelta: 0.75, sortOrder: 3 }] })).status).toBe("ok")
    expect((await push(owner, "modifier-group", "create", { id: G.milk, name: "Milk", required: true, maxSelect: 1, options: [{ id: O.whole, name: "Whole", priceDelta: 0, isDefault: true }, { id: O.oat, name: "Oat", priceDelta: 0.5 }] })).status).toBe("ok")
    expect((await push(owner, "modifier-group", "create", { id: G.shot, name: "Extra", required: false, maxSelect: 2, options: [{ id: O.shot, name: "Extra shot", priceDelta: 0.75 }] })).status).toBe("ok")
    expect((await push(owner, "product", "create", { syncId: SID.capp, name: "Cappuccino", price: 3, cost: 0, stock: 0, barcode: null, category: "Coffee", stockPolicy: "recipe", modifierGroupIds: [G.size, G.milk, G.shot] })).status).toBe("ok")
    expect((await push(owner, "product", "create", { syncId: SID.esp, name: "Espresso", price: 2, cost: 0, stock: 0, barcode: null, category: "Coffee", stockPolicy: "recipe", modifierGroupIds: [G.shot] })).status).toBe("ok")
    for (const p of await prisma.product.findMany({ where: { tenantId: T }, select: { id: true, syncId: true } })) pid[p.syncId!] = p.id
    expect((await prisma.product.findFirst({ where: { tenantId: T, syncId: SID.capp } }))!.stock).toBe(0) // never a fake quantity
  })

  it("recipes: invalid ones are refused; a revision becomes current and old ones stay", async () => {
    expect((await push(owner, "recipe", "create", { id: `rcp-bad-${id8}`, productSyncId: SID.capp, yield: 1, lines: [{ ingredientSyncId: SID.beans, quantity: "18.0005" }] })).error).toMatch(/precision/)
    expect((await push(owner, "recipe", "create", { id: `rcp-bad2-${id8}`, productSyncId: SID.capp, yield: 1, lines: [{ ingredientSyncId: SID.capp, quantity: 1 }] })).error).toMatch(/self/)
    // Cappuccino: 18 g beans; milk 150/200/250 ml by size, unless oat (then oat milk); +18 g per extra shot; a cup
    const milkBy = (size: string, ml: number) => [{ ingredientSyncId: SID.milk, quantity: ml, when: [size], unless: [O.oat] }, { ingredientSyncId: SID.oat, quantity: ml, when: [size, O.oat] }]
    const r1 = await push(owner, "recipe", "create", { id: REV.capp1, productSyncId: SID.capp, yield: 1, note: "house", createdById: OWNER, createdByName: "Owner", lines: [
      { ingredientSyncId: SID.beans, quantity: 18 }, ...milkBy(O.small, 150), ...milkBy(O.medium, 200), ...milkBy(O.large, 250),
      { ingredientSyncId: SID.beans, quantity: 18, when: [O.shot] }, { ingredientSyncId: SID.cups, quantity: 1 }] })
    expect(r1.status).toBe("ok")
    expect((await push(owner, "recipe", "create", { id: REV.esp1, productSyncId: SID.esp, yield: 1, lines: [{ ingredientSyncId: SID.beans, quantity: "9.5" }, { ingredientSyncId: SID.beans, quantity: 9, when: [O.shot] }, { ingredientSyncId: SID.cups, quantity: 1 }] })).status).toBe("ok")
    expect((await prisma.product.findFirst({ where: { tenantId: T, syncId: SID.capp } }))!.recipeRev).toBe(REV.capp1)
    const stored = await (prisma as any).recipeRevision.findUnique({ where: { id: REV.capp1 } })
    // attributed to the person who saved it (observe store: as the register names them, a claim)
    expect([stored.createdById, (stored.attribution as any)?.basis]).toEqual([OWNER, "claimed"])
    // resending the same revision changes nothing
    expect((await push(owner, "recipe", "create", { id: REV.capp1, productSyncId: SID.capp, yield: 1, lines: [{ ingredientSyncId: SID.beans, quantity: 99 }] })).status).toBe("ok")
    expect((await (prisma as any).recipeRevision.findUnique({ where: { id: REV.capp1 } })).lines[0].quantity).toBe("18")
  })

  it("receiving in purchase units: exact stock in grams/ml/units, the invoice price kept, valuation derived; a row that does not add up is refused", async () => {
    const wrong = lot(SID.beans, "Coffee beans", "kg", 2, 18.37, 1999)
    expect((await push(owner, "inventory", "receive", [wrong])).error).toMatch(/PRODUCT_SETUP: "Coffee beans": 2 kg is 2000 g, not 1999/)
    const beans = lot(SID.beans, "Coffee beans", "kg", 2, 18.37, 2000, { expiryDate: "2027-03-01" })
    const beansLater = lot(SID.beans, "Coffee beans", "kg", 0.5, 20, 500, { expiryDate: "2027-06-01" })
    expect((await push(owner, "inventory", "receive", [beans, beansLater,
      lot(SID.milk, "Whole milk", "L", 2, 1.25, 2000), lot(SID.oat, "Oat milk", "L", 1, 2.4, 1000),
      lot(SID.cups, "Cups", "pack", 2, 4, 100, { unitsPerPurchase: 50 }),
      // a lot received with neither a price nor a valuation: its cost is unknown, not zero
      lot(SID.mystery, "Sample beans", "g", 100, "" as any, 100, { purchasePrice: null, unitCost: 0 }),
    ])).status).toBe("ok")
    const pepsiLot = { id: randomUUID(), batchNumber: "L-PEP", productSyncId: SID.pepsi, productName: "Pepsi", barcode: SID.pepsi, initialQuantity: 24, quantityRemaining: 24, unitCost: 0.4, unitPrice: 1, status: "Open" }
    expect((await push(owner, "inventory", "receive", [pepsiLot])).status).toBe("ok")
    expect([await stock(SID.beans), await stock(SID.milk), await stock(SID.oat), await stock(SID.cups), await stock(SID.pepsi)]).toEqual([2500, 2000, 1000, 100, 24])
    const b = await prisma.inventoryBatch.findUnique({ where: { id: beans.id } })
    expect([Number(b!.purchasePrice), b!.purchaseUnit, Number(b!.purchaseQuantity), Number(b!.unitsPerPurchase), Number(b!.unitCost), b!.supplierReference]).toEqual([18.37, "kg", 2, 1000, 0.0184, "INV-77"])
  })
})

describe("café menu: selling configured drinks", () => {
  it("a configured cappuccino and a Pepsi: options snapshot kept, ingredients consumed FEFO by the revision, cost exact from invoice prices", async () => {
    const s = sale([capp(2, 5, [LARGE, OAT, SHOT]), pepsi()])
    const r = await push(rana, "sale", "create", s)
    expect(r.status).toBe("ok")
    // 2 × (18 + 18 shot) = 72 g beans; 2 × 250 ml oat (no whole milk); 2 cups; Pepsi 1
    expect([await stock(SID.beans), await stock(SID.milk), await stock(SID.oat), await stock(SID.cups), await stock(SID.pepsi), await stock(SID.capp)]).toEqual([2428, 2000, 500, 98, 23, 0])
    const line = await prisma.saleItem.findFirst({ where: { saleId: s.id, productId: pid[SID.capp] } })
    expect((line!.modifiers as any[]).map((m) => m.optionId)).toEqual([O.large, O.oat, O.shot])
    expect([Number(line!.basePrice), line!.recipeRev, line!.costStatus, line!.recipeConflict, line!.modifierConflict]).toEqual([3, REV.capp1, "known", null, null])
    // beans 72 × 18.37/1000 = 1.32264; oat 500 × 2.4/1000 = 1.2; cups 2 × 4/50 = 0.16 → 2.68264 → 1.34132 per drink
    expect(Number(line!.cost)).toBeCloseTo(1.3413, 4)
    const consumed = line!.consumption as any[]
    expect(consumed.map((c) => [c.ingredientSyncId, c.quantity])).toEqual([[SID.beans, 72], [SID.oat, 500], [SID.cups, 2]])
    // FEFO: the beans lot expiring first
    expect(consumed[0].allocations).toEqual([expect.objectContaining({ quantity: 72 })])
    expect((await lots(SID.beans)).map((l) => l.left)).toEqual([1928, 500])
    // movements are the ingredients' (the drink's own stock never moves)
    const moves = await prisma.stockMovement.findMany({ where: { tenantId: T, reference: s.id } })
    expect(moves.map((m) => [m.productId, m.quantity]).sort()).toEqual([[pid[SID.beans], -72], [pid[SID.oat], -500], [pid[SID.cups], -2], [pid[SID.pepsi], -1]].sort())
    // a repeated delivery (lost response) consumes nothing again
    const again = await call("POST", "/api/sync/push", { deviceId: "cafe-till", operations: [{ id: r.opId, entity: "sale", action: "create", payload: s }] }, { Authorization: `Bearer ${rana}` })
    expect(again.body.results[0].status).toBe("ok")
    expect(await stock(SID.beans)).toBe(2428)
  })

  it("price floor includes the options: a missing option charge is a price override (held for a manager), the right price is routine", async () => {
    const cheap = await push(rana, "sale", "create", sale([capp(1, 3.75, [LARGE, OAT])])) // 3 + 0.75 + 0.5 = 4.25
    expect(cheap.status).not.toBe("ok")
    expect((await prisma.syncOperation.findUnique({ where: { id: cheap.opId } }))!.error).toMatch(/PRICE_OVERRIDE: "Cappuccino" was sold at 3.75, below its price 4.25/)
    // an option the server does not know adds nothing to the floor (a made-up discount option cannot lower it)
    const fake = await push(rana, "sale", "create", sale([capp(1, 2.5, [MEDIUM, WHOLE, mod(G.size, "made-up", "Free", -0.5)])]))
    expect((await prisma.syncOperation.findUnique({ where: { id: fake.opId } }))!.error).toMatch(/PRICE_OVERRIDE/)
    expect((await push(rana, "sale", "create", sale([capp(1, 4.25, [LARGE, OAT])]))).status).toBe("ok")
  })

  it("a paid sale with options the menu does not allow is recorded with a visible conflict; a live checkout is refused before payment", async () => {
    const before = await stock(SID.beans)
    const queued = sale([capp(1, 3, [WHOLE])]) // no size: the required group is missing
    expect((await push(rana, "sale", "create", queued)).status).toBe("ok")
    const line = await prisma.saleItem.findFirst({ where: { saleId: queued.id } })
    expect(line!.modifierConflict).toBe("required")
    expect(await prisma.auditEvent.count({ where: { tenantId: T, action: "sale.modifier_conflict", metadata: { path: ["saleId"], equals: queued.id } } })).toBe(1)
    expect(await stock(SID.beans)).toBe(before - 18) // the base lines still apply (no size line matched)
    // the same through a live checkout (hub write-through id): refused, nothing recorded
    const live = sale([capp(1, 3, [WHOLE])])
    const r = await push(rana, "sale", "create", live, `wt-${randomUUID()}`)
    expect(r.status).toBe("rejected")
    expect(r.error).toMatch(/MODIFIERS_INVALID: "Cappuccino" cannot be sold this way \(required\)/)
    expect(await prisma.sale.count({ where: { id: live.id } })).toBe(0)
    // an ingredient is not for sale
    const milkSale = sale([{ id: pid[SID.milk], productSyncId: SID.milk, lineId: randomUUID(), name: "Whole milk", barcode: "", quantity: 1, unitPrice: 0, total: 0, stockPolicy: "tracked", stockPolicyRev: "initial", batchAllocations: [{ batchId: "legacy-stock", quantity: 1 }] }])
    expect((await push(rana, "sale", "create", milkSale, `wt-${randomUUID()}`)).error).toMatch(/MODIFIERS_INVALID: "Whole milk" cannot be sold this way \(not-sellable\)/)
  })

  it("refunding or voiding a prepared drink returns money only; a packaged return restores its stock and lot", async () => {
    const s = sale([capp(1, 3, [MEDIUM, WHOLE]), pepsi(2)])
    expect((await push(rana, "sale", "create", s)).status).toBe("ok")
    const after = [await stock(SID.beans), await stock(SID.milk), await stock(SID.cups), await stock(SID.pepsi)]
    const lines = await prisma.saleItem.findMany({ where: { saleId: s.id } })
    const drink = lines.find((l) => l.productId === pid[SID.capp])!, can = lines.find((l) => l.productId === pid[SID.pepsi])!
    const refundId = randomUUID()
    expect((await push(rana, "refund", "create", { id: refundId, refundNumber: `R-CM-${refundId.slice(0, 6)}`, saleId: s.id, saleNumber: s.saleNumber, method: "Cash", reason: "spilled", total: 5, cashier: "Rana", cashierId: RANA,
      items: [{ id: pid[SID.capp], saleLineId: drink.lineId, name: "Cappuccino", quantity: 1, unitPrice: 3, total: 3 }, { id: pid[SID.pepsi], saleLineId: can.lineId, name: "Pepsi", quantity: 2, unitPrice: 1, total: 2 }] })).status).toBe("ok")
    expect(Number((await prisma.saleRefund.findUnique({ where: { id: refundId } }))!.total)).toBe(5)
    expect([await stock(SID.beans), await stock(SID.milk), await stock(SID.cups), await stock(SID.pepsi), await stock(SID.capp)]).toEqual([after[0], after[1], after[2], after[3] + 2, 0])
    // a void of another drink sale: nothing comes back either
    const v = sale([capp(1, 3, [MEDIUM, WHOLE])])
    expect((await push(rana, "sale", "create", v)).status).toBe("ok")
    const beansBefore = await stock(SID.beans)
    expect((await push(rana, "sale", "void", { id: v.id, saleNumber: v.saleNumber })).status).toBe("ok")
    expect([await stock(SID.beans), await stock(SID.capp)]).toEqual([beansBefore, 0])
    expect((await prisma.sale.findUnique({ where: { id: v.id } }))!.status).toBe("Voided")
  })
})

describe("café menu: revisions, offline and recovery", () => {
  it("a drink made with an older revision consumes that revision, never today's; concurrent edits keep both", async () => {
    // the owner changes the recipe (20 g beans) while a register still has revision 1
    expect((await push(owner, "recipe", "create", { id: REV.capp2, productSyncId: SID.capp, parentRev: REV.capp1, yield: 1, lines: [{ ingredientSyncId: SID.beans, quantity: 20 }, { ingredientSyncId: SID.milk, quantity: 200, when: [O.medium], unless: [O.oat] }, { ingredientSyncId: SID.cups, quantity: 1 }] })).status).toBe("ok")
    expect((await prisma.product.findFirst({ where: { tenantId: T, syncId: SID.capp } }))!.recipeRev).toBe(REV.capp2)
    // another device saved a change on top of revision 1 at the same time: kept, not current, visible
    expect((await push(owner, "recipe", "create", { id: REV.cappSide, productSyncId: SID.capp, parentRev: REV.capp1, yield: 1, lines: [{ ingredientSyncId: SID.beans, quantity: 30 }] })).status).toBe("ok")
    expect((await prisma.product.findFirst({ where: { tenantId: T, syncId: SID.capp } }))!.recipeRev).toBe(REV.capp2)
    expect(await prisma.auditEvent.count({ where: { tenantId: T, action: "product.recipe_conflict" } })).toBe(1)
    const beans = await stock(SID.beans)
    const offline = sale([capp(1, 3, [MEDIUM, WHOLE], { recipeRev: REV.capp1 })])
    expect((await push(rana, "sale", "create", offline)).status).toBe("ok")
    expect(await stock(SID.beans)).toBe(beans - 18)
    const fresh = sale([capp(1, 3, [MEDIUM, WHOLE], { recipeRev: REV.capp2 })])
    expect((await push(rana, "sale", "create", fresh)).status).toBe("ok")
    expect(await stock(SID.beans)).toBe(beans - 38)
    // the register's own figures differ from the revision: the revision's are taken, the difference is visible
    const odd = sale([capp(1, 3, [MEDIUM, WHOLE], { recipeRev: REV.capp2, consumption: [{ ingredientSyncId: SID.beans, quantity: 5 }] })])
    expect((await push(rana, "sale", "create", odd)).status).toBe("ok")
    expect(await stock(SID.beans)).toBe(beans - 58)
    expect((await prisma.saleItem.findFirst({ where: { saleId: odd.id } }))!.recipeConflict).toBe("mismatch")
  })

  it("a revision this server has not received is held and retried (nothing applied); once it arrives the same sale applies", async () => {
    const beans = await stock(SID.beans)
    const s = sale([capp(1, 3, [MEDIUM, WHOLE], { recipeRev: REV.ghost })])
    const held = await push(rana, "sale", "create", s)
    expect(held.status).toBe("error")
    expect(held.error).toMatch(/^RECIPE_HELD: "Cappuccino" was made with a recipe \(rcp-ghost-/)
    expect(await prisma.sale.count({ where: { id: s.id } })).toBe(0)
    expect(await stock(SID.beans)).toBe(beans)
    // the same through a live checkout (before payment): refused outright, never left unconfirmed at the register
    const live = await push(rana, "sale", "create", sale([capp(1, 3, [MEDIUM, WHOLE], { recipeRev: REV.ghost })]), `wt-${randomUUID()}`)
    expect([live.status, /^RECIPE_HELD:/.test(live.error)]).toEqual(["rejected", true])
    const arrived = await push(owner, "recipe", "create", { id: REV.ghost, productSyncId: SID.capp, parentRev: REV.capp2, yield: 2, lines: [{ ingredientSyncId: SID.beans, quantity: 25 }, { ingredientSyncId: SID.cups, quantity: 2 }] })
    expect(arrived.status).toBe("ok")
    // an operation applied on its first attempt is stamped in UTC like every other record, whatever the database's
    // own time zone (a hub's embedded database runs in local time; forwarding follows this order)
    const row = await prisma.syncOperation.findUnique({ where: { id: arrived.opId } })
    expect(Math.abs(row!.createdAt.getTime() - Date.now())).toBeLessThan(10 * 60_000)
    const again = await call("POST", "/api/sync/push", { deviceId: "cafe-till", operations: [{ id: held.opId, entity: "sale", action: "create", payload: s }] }, { Authorization: `Bearer ${rana}` })
    expect(again.body.results[0].status).toBe("ok")
    // yield 2: one drink = 12.5 g beans, 1 cup
    expect(await stock(SID.beans)).toBe(beans - 12.5)
  })

  it("a revision that never arrives is resolved on the register by a manager (audited); a cashier's claim does not count", async () => {
    const beans = await stock(SID.beans)
    const recorded = [{ ingredientSyncId: SID.beans, quantity: 17 }, { ingredientSyncId: SID.cups, quantity: 1 }]
    const claim = sale([capp(1, 3, [MEDIUM, WHOLE], { recipeRev: `rcp-lost-${id8}`, consumption: recorded, recipeResolution: { mode: "recorded", resolvedBy: RANA, resolvedByName: "Rana", note: "made it" } })])
    expect((await push(rana, "sale", "create", claim)).status).toBe("error")
    const s = sale([capp(1, 3, [MEDIUM, WHOLE], { recipeRev: `rcp-lost-${id8}`, consumption: recorded, recipeResolution: { mode: "recorded", resolvedBy: MAYA, resolvedByName: "Maya", note: "recipe saved on a till that broke" } })])
    expect((await push(rana, "sale", "create", s)).status).toBe("ok")
    expect(await stock(SID.beans)).toBe(beans - 17)
    expect((await prisma.saleItem.findFirst({ where: { saleId: s.id } }))!.recipeConflict).toBe("resolved")
    expect(await prisma.auditEvent.count({ where: { tenantId: T, action: "sale.recipe_resolved", userId: MAYA } })).toBe(1)
  })

  it("not enough of an ingredient: a queued sale is held for review (kept on the register) and applies once stock is received; a live checkout is refused", async () => {
    // a drink that needs more oat milk than is left
    const left = await stock(SID.oat)
    const qty = Math.floor(left / 250) + 1
    const s = sale([capp(qty, 4.25, [LARGE, OAT])])
    const r = await push(rana, "sale", "create", s)
    expect(r.status).toBe("error")
    expect(r.error).toMatch(/^INGREDIENT_SHORT: Not enough "Oat milk" for "Cappuccino" \(needs \d+ ml, \d+ ml in stock\)/)
    const row = await prisma.syncOperation.findUnique({ where: { id: r.opId } })
    expect(row!.status).toBe("Refused")
    expect(await prisma.sale.count({ where: { id: s.id } })).toBe(0)
    expect([await stock(SID.oat), await stock(SID.beans) > 0]).toEqual([left, true]) // nothing partly taken
    const review = await call("GET", "/api/sync/refused", undefined, { Authorization: `Bearer ${ownerPerson}` })
    expect(review.body.operations.find((i: any) => i.id === r.opId)?.category).toBe("stock")
    const live = sale([capp(qty, 4.25, [LARGE, OAT])])
    const lr = await push(rana, "sale", "create", live, `wt-${randomUUID()}`)
    expect([lr.status, /INGREDIENT_SHORT/.test(lr.error)]).toEqual(["rejected", true])
    // oat milk received: the register's resend applies the held sale, once
    expect((await push(owner, "inventory", "receive", [lot(SID.oat, "Oat milk", "L", 2, 2.4, 2000)])).status).toBe("ok")
    const again = await call("POST", "/api/sync/push", { deviceId: "cafe-till", operations: [{ id: r.opId, entity: "sale", action: "create", payload: s }] }, { Authorization: `Bearer ${rana}` })
    expect(again.body.results[0].status).toBe("ok")
    expect(await stock(SID.oat)).toBe(left + 2000 - qty * 250)
  })
})

describe("café menu: waste, cost visibility, versions, reports", () => {
  it("a remake consumes the drink's current recipe once per event (per-ingredient adjustments with lot cost); a cashier's is held", async () => {
    const before = [await stock(SID.beans), await stock(SID.milk), await stock(SID.cups)]
    // the revision named (else the drink's current one)
    const w = { id: `waste-${randomUUID()}`, productSyncId: SID.capp, recipeRev: REV.capp2, quantity: 1, reason: "Remake", note: "dropped", modifiers: [MEDIUM, WHOLE], createdById: OWNER, createdByName: "Owner" }
    const r = await push(owner, "inventory", "waste", w)
    expect(r.status).toBe("ok")
    expect(await push(owner, "inventory", "waste", w)).toMatchObject({ status: "ok" })
    // revision capp2: 20 g beans, 200 ml milk (medium, not oat), 1 cup
    expect([await stock(SID.beans), await stock(SID.milk), await stock(SID.cups)]).toEqual([before[0] - 20, before[1] - 200, before[2] - 1])
    const adj = await prisma.stockAdjustment.findMany({ where: { tenantId: T, wasteRef: w.id }, orderBy: { id: "asc" } })
    expect(adj.map((a) => [a.reason, a.quantityChange, a.wasteOf])).toEqual([["Remake", -20, "1 × Cappuccino (Medium, Whole)"], ["Remake", -200, "1 × Cappuccino (Medium, Whole)"], ["Remake", -1, "1 × Cappuccino (Medium, Whole)"]])
    expect(Number(adj[0].valueImpact)).toBeLessThan(0)
    expect(adj.every((a) => a.createdById === OWNER)).toBe(true)
    // a spill of an ingredient itself, in its unit
    expect((await push(owner, "inventory", "waste", { id: `waste-${randomUUID()}`, productSyncId: SID.milk, quantity: "12.5", reason: "Waste", note: "spilled" })).status).toBe("ok")
    expect(await stock(SID.milk)).toBe(before[1] - 212.5)
    // the cashier lacks inventory.adjust: not applied
    const c = await push(rana, "inventory", "waste", { id: `waste-${randomUUID()}`, productSyncId: SID.capp, quantity: 1, reason: "Remake", modifiers: [MEDIUM, WHOLE] })
    expect(c.status).not.toBe("ok")
    expect(await stock(SID.milk)).toBe(before[1] - 212.5)
    // with no revision named, the drink's current one (the latest saved: 12.5 g beans and a cup per drink)
    const beans = await stock(SID.beans)
    expect((await push(owner, "inventory", "waste", { id: `waste-${randomUUID()}`, productSyncId: SID.capp, quantity: 2, reason: "Waste", modifiers: [MEDIUM, WHOLE] })).status).toBe("ok")
    expect(await stock(SID.beans)).toBe(beans - 25)
  })

  it("staff without cost visibility receive no cost: no line cost, consumption cost, lot valuation or invoice price", async () => {
    const pull = await call("GET", "/api/sync/pull", undefined, { Authorization: `Bearer ${rana}` })
    const line = pull.body.sales.flatMap((s: any) => s.items).find((i: any) => Array.isArray(i.consumption) && i.consumption.length)
    expect(line).toBeTruthy()
    expect(line.cost).toBeUndefined()
    expect(line.costStatus).toBeUndefined()
    expect(line.consumption[0].cost).toBeUndefined()
    expect(line.consumption[0].allocations[0].unitCost).toBeUndefined()
    const lotRow = pull.body.batches.find((b: any) => b.productId === pid[SID.beans])
    expect([lotRow.unitCost, lotRow.purchasePrice, lotRow.purchaseUnit]).toEqual([undefined, undefined, "kg"])
    // the menu and recipes do reach the register (schema 6)
    expect(pull.body.modifierGroups.map((g: any) => g.id).sort()).toEqual([G.milk, G.shot, G.size].sort())
    expect(pull.body.recipeRevisions.some((r: any) => r.id === REV.capp2)).toBe(true)
    // an older register (schema 5) never sees recipe drinks or ingredients, nor the menu
    const old = await call("GET", "/api/sync/pull", undefined, { Authorization: `Bearer ${owner}`, "x-titan-sync-schema": "5" })
    const names = old.body.products.map((p: any) => p.name)
    expect(names).toContain("Pepsi")
    expect(names).not.toContain("Cappuccino")
    expect(names).not.toContain("Whole milk")
    expect(old.body.modifierGroups).toBeUndefined()
    // and an older register's view of a recipe line is "made to order" (no stock returns)
    expect(old.body.sales.flatMap((s: any) => s.items).some((i: any) => i.stockPolicy === "recipe")).toBe(false)
  })

  it("making a known product a recipe drink is refused while an older register still trades (upgrade gate, schema 6)", async () => {
    await prisma.syncClient.create({ data: { tenantId: T, clientKey: "device:old-till", label: "Old till", syncSchema: 5, lastSeenAt: new Date() } })
    const r = await push(owner, "product", "update", { syncId: SID.tea, stockPolicy: "recipe", stockPolicyRev: randomUUID(), stockPolicyParentRev: "initial" })
    expect(r.status).toBe("rejected")
    expect(r.error).toMatch(/STOCK_POLICY_GATE: .*Old till/)
    expect((await prisma.product.findFirst({ where: { tenantId: T, syncId: SID.tea } }))!.stockPolicy).toBe("untracked")
    await prisma.syncClient.deleteMany({ where: { tenantId: T, clientKey: "device:old-till" } })
    // the unit of an ingredient with stock cannot change
    expect((await push(owner, "product", "update", { syncId: SID.milk, stockUnit: "g" })).error).toMatch(/PRODUCT_SETUP: "Whole milk" has stock in ml/)
  })

  it("an ingredient of unknown cost: the drink's cost is unknown (never zero) and it has no margin; real figures elsewhere", async () => {
    expect((await push(owner, "recipe", "create", { id: REV.myst, productSyncId: SID.esp, parentRev: REV.esp1, yield: 1, lines: [{ ingredientSyncId: SID.mystery, quantity: 9 }] })).status).toBe("ok")
    const s = sale([{ id: pid[SID.esp], productSyncId: SID.esp, lineId: randomUUID(), name: "Espresso", barcode: "", quantity: 1, unitPrice: 2, total: 2, basePrice: 2, stockPolicy: "recipe", stockPolicyRev: "initial", recipeRev: REV.myst, modifiers: [], batchAllocations: [] }])
    expect((await push(rana, "sale", "create", s)).status).toBe("ok")
    expect((await prisma.saleItem.findFirst({ where: { saleId: s.id } }))!.costStatus).toBe("unknown")
    // a hub's copy of a packaged line can carry an empty options list rather than none
    expect((await prisma.saleItem.updateMany({ where: { sale: { tenantId: T }, productName: "Pepsi" }, data: { modifiers: [] } })).count).toBeGreaterThan(0)
    const rep = await call("GET", "/api/reports/cafe?days=1", undefined, { Authorization: `Bearer ${ownerPerson}` })
    expect(rep.status).toBe(200)
    const esp = rep.body.drinks.find((d: any) => d.name === "Espresso"), cap = rep.body.drinks.find((d: any) => d.name === "Cappuccino")
    expect([esp.costStatus, esp.margin, esp.unknownCostQuantity]).toEqual(["unknown", null, 1])
    expect(cap.modifierRevenue).toBeGreaterThan(0)
    expect(cap.baseRevenue + cap.modifierRevenue).toBeCloseTo(cap.revenue, 2)
    expect(rep.body.waste.find((w: any) => w.reason === "Remake")).toMatchObject({ events: 1 })
    expect(rep.body.summary.wasteCost).toBeGreaterThan(0)
    const margin = await call("GET", "/api/reports/margin?days=1", undefined, { Authorization: `Bearer ${ownerPerson}` })
    expect(margin.body.byProduct.find((p: any) => p.name === "Espresso")).toMatchObject({ margin: null, marginPct: null, costIncomplete: true })
    expect(margin.body.summary.totalMargin).toBeNull()
    // packaged goods are not in the café report (no options, no recipe)
    expect(rep.body.drinks.find((d: any) => d.name === "Pepsi")).toBeUndefined()
    // a cashier (no reports, no cost) gets neither
    const cashier = await call("GET", "/api/reports/cafe?days=1", undefined, { Authorization: `Bearer ${ranaPerson}` })
    expect(cashier.status).toBe(403)
    expect(JSON.stringify(cashier.body)).not.toMatch(/ingredientCost|wasteCost|revenue/)
  })

  it("names: a renamed drink is one row under its current name (sold-as names listed); option renames and archiving change no figures", async () => {
    const report = async () => (await call("GET", "/api/reports/cafe?days=1", undefined, { Authorization: `Bearer ${ownerPerson}` })).body
    const before = await report()
    const cap0 = before.drinks.find((d: any) => d.name === "Cappuccino")
    const figures = (d: any) => ({ quantity: d.quantity, revenue: d.revenue, baseRevenue: d.baseRevenue, modifierRevenue: d.modifierRevenue, refunds: d.refunds, ingredientCost: d.ingredientCost, margin: d.margin })
    const lineNames = async () => (await prisma.saleItem.findMany({ where: { sale: { tenantId: T }, productId: pid[SID.capp] }, select: { productName: true } })).map((l) => l.productName).sort()
    const names0 = await lineNames()
    // 1. the drink is renamed: one row, the current name, the old name listed, the same figures; the sale lines keep their name
    await prisma.product.update({ where: { id: pid[SID.capp] }, data: { name: "Cappuccino (house)" } })
    const r1 = await report()
    expect(r1.drinks.filter((d: any) => d.productId === pid[SID.capp])).toHaveLength(1)
    const cap1 = r1.drinks.find((d: any) => d.productId === pid[SID.capp])
    expect([cap1.name, cap1.soldAs]).toEqual(["Cappuccino (house)", ["Cappuccino"]])
    expect(figures(cap1)).toEqual(figures(cap0))
    expect(r1.drinks.find((d: any) => d.name === "Cappuccino")).toBeUndefined()
    expect(await lineNames()).toEqual(names0)
    // 2. another product given the same name is its own row (never merged by name)
    const other = await prisma.product.update({ where: { id: pid[SID.esp] }, data: { name: "Cappuccino (house)" } })
    const r2 = await report()
    expect(r2.drinks.filter((d: any) => d.name === "Cappuccino (house)").map((d: any) => d.productId).sort()).toEqual([pid[SID.capp], other.id].sort())
    await prisma.product.update({ where: { id: pid[SID.esp] }, data: { name: "Espresso" } })
    // 3. an option renamed in the menu: no figure or name changes
    const groups = await prisma.modifierGroup.findMany({ where: { tenantId: T } })
    for (const g of groups) await prisma.modifierGroup.update({ where: { id: g.id }, data: { name: `${g.name} (renamed)` } })
    expect(figures((await report()).drinks.find((d: any) => d.productId === pid[SID.capp]))).toEqual(figures(cap0))
    for (const g of groups) await prisma.modifierGroup.update({ where: { id: g.id }, data: { name: g.name } })
    // 4. archived: still reported under its name, marked; same figures and totals
    await prisma.product.update({ where: { id: pid[SID.capp] }, data: { archived: true } })
    const r4 = await report()
    const cap4 = r4.drinks.find((d: any) => d.productId === pid[SID.capp])
    expect([cap4.name, cap4.archived, figures(cap4)]).toEqual(["Cappuccino (house)", true, figures(cap0)])
    expect(r4.summary).toEqual(before.summary)
    await prisma.product.update({ where: { id: pid[SID.capp] }, data: { name: "Cappuccino", archived: false } })
    const after = (await report()).drinks.find((d: any) => d.productId === pid[SID.capp])
    expect([after.name, after.soldAs, after.archived]).toEqual(["Cappuccino", undefined, undefined])
  })
})

describe("delivery and the store's topology", () => {
  it("a hub store refuses delivery at every boundary and closes earlier orders only by an explicit, audited decision", async () => {
    const p = await prisma.product.create({ data: { tenantId: HUBT, syncId: `hp-${id8}`, name: "Chips", price: 1, cost: 0.5, stock: 10, barcode: `hp-${id8}`, category: "Snacks" } })
    const tenant = await call("GET", `/api/delivery/tenant?subdomain=cmh-${id8}`)
    expect(tenant.body.delivery).toMatchObject({ available: false, code: "DELIVERY_UNAVAILABLE" })
    const order = await call("POST", "/api/delivery/order", { tenantId: HUBT, customerName: "C", customerPhone: "1", address: "A", items: [{ productId: p.id, quantity: 1 }] })
    expect([order.status, order.body.code]).toEqual([409, "DELIVERY_UNAVAILABLE"])
    expect(await prisma.deliveryOrder.count({ where: { tenantId: HUBT } })).toBe(0)
    // an order accepted before the store became a hub store
    const old = await prisma.deliveryOrder.create({ data: { tenantId: HUBT, orderNumber: `DEL-OLD-${id8}`, customerName: "C", customerPhone: "1", address: "A", itemsTotal: 1, total: 1, items: { create: [{ productId: p.id, productName: "Chips", barcode: "", quantity: 1, unitPrice: 1, total: 1 }] } } })
    await prisma.staffUser.create({ data: { id: `hub-own-${id8}`, tenantId: HUBT, name: "Hub owner", mobile: `cmh-${id8}`, pin: "x", role: "Admin" } })
    const hubOwner = sign(`hub-own-${id8}`, HUBT, "Admin", "person")
    const patch = await call("PATCH", `/api/delivery/orders/${old.id}`, { status: "Confirmed" }, { Authorization: `Bearer ${hubOwner}` })
    expect([patch.status, patch.body.code]).toEqual([409, "DELIVERY_UNAVAILABLE"])
    expect(Number((await prisma.product.findUnique({ where: { id: p.id } }))!.stock)).toBe(10)
    expect((await call("POST", `/api/delivery/orders/${old.id}/close-without-stock`, { outcome: "Cancelled", note: "x" }, { Authorization: `Bearer ${hubOwner}` })).status).toBe(400)
    const closed = await call("POST", `/api/delivery/orders/${old.id}/close-without-stock`, { outcome: "Cancelled", note: "store moved to its hub" }, { Authorization: `Bearer ${hubOwner}` })
    expect([closed.status, closed.body.status]).toEqual([200, "Cancelled"])
    expect(Number((await prisma.product.findUnique({ where: { id: p.id } }))!.stock)).toBe(10)
    expect(await prisma.auditEvent.count({ where: { tenantId: HUBT, action: "delivery.closed_without_stock" } })).toBe(1)
    expect((await call("POST", `/api/delivery/orders/${old.id}/close-without-stock`, { outcome: "Delivered", note: "again please" }, { Authorization: `Bearer ${hubOwner}` })).body.code).toBe("ORDER_CLOSED")
  })

  it("a direct store: drinks and ingredients are not offered; stock is taken once and given back at most once; open orders block a change to a hub store", async () => {
    const menu = await call("GET", `/api/delivery/products?tenantId=${T}`)
    const names = menu.body.map((x: any) => x.name)
    expect(names).toContain("Pepsi")
    for (const n of ["Cappuccino", "Whole milk", "House tea"]) expect(names).not.toContain(n)
    expect((await call("POST", "/api/delivery/order", { tenantId: T, customerName: "C", customerPhone: "1", address: "A", items: [{ productId: pid[SID.capp], quantity: 1 }] })).status).toBe(400)
    const order = await call("POST", "/api/delivery/order", { tenantId: T, customerName: "C", customerPhone: "1", address: "A", items: [{ productId: pid[SID.pepsi], quantity: 2 }] })
    expect(order.status).toBe(201)
    const id = order.body.order.id
    const before = await stock(SID.pepsi)
    const readiness = await topologyReadiness(T, "hub", "hubi-x")
    expect(readiness.find((b) => b.code === "open-delivery")?.items?.[0]?.id).toBe(id)
    for (const status of ["Confirmed", "OutForDelivery"]) expect((await call("PATCH", `/api/delivery/orders/${id}`, { status }, { Authorization: `Bearer ${ownerPerson}` })).status).toBe(200)
    expect(await stock(SID.pepsi)).toBe(before - 2) // once, not twice
    expect((await call("PATCH", `/api/delivery/orders/${id}`, { status: "Cancelled" }, { Authorization: `Bearer ${ownerPerson}` })).status).toBe(200)
    expect(await stock(SID.pepsi)).toBe(before)
    expect((await call("PATCH", `/api/delivery/orders/${id}`, { status: "Cancelled" }, { Authorization: `Bearer ${ownerPerson}` })).status).toBe(200)
    expect(await stock(SID.pepsi)).toBe(before) // given back at most once
  })
})

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest"
import http from "node:http"
import type { AddressInfo } from "node:net"
import { randomUUID } from "node:crypto"
import { pathToFileURL } from "node:url"
import path from "node:path"

// Batch 83: staff whose PIN was set ON A REGISTER (the register stores and sends a SHA-256 verifier, base64)
// are checked by the one server rule (lib/pinVerifier.ts) everywhere a PIN is checked: sign-in, the staff
// session, manager approval (discount, refund, void, payout). The register's own services (apps/desktop/src)
// create the staff and ask for the approvals, against the real API handlers and a scratch database.
// Also: duplicate PINs, a PIN changed elsewhere while this register was offline, and lockout.
process.env.JWT_SECRET = process.env.JWT_SECRET || "register-pin-secret"
const SRC = path.resolve(__dirname, "../../desktop/src").replace(/\\/g, "/")

class MemoryStorage {
  m = new Map<string, string>()
  get length() { return this.m.size }
  key(i: number) { return [...this.m.keys()][i] ?? null }
  getItem(k: string) { return this.m.has(k) ? this.m.get(k)! : null }
  setItem(k: string, v: string) { this.m.set(k, String(v)) }
  removeItem(k: string) { this.m.delete(k) }
  clear() { this.m.clear() }
}
const storage = new MemoryStorage()
const events = new EventTarget()
const g = globalThis as unknown as Record<string, unknown>
g.localStorage = storage
const timers = new Set<ReturnType<typeof setTimeout>>()
g.window = new Proxy(globalThis, {
  get(t, k) {
    if (k === "setTimeout") return (fn: () => void, ms?: number) => { const id = setTimeout(() => { timers.delete(id); fn() }, ms); timers.add(id); return id }
    if (k === "clearTimeout") return (id: ReturnType<typeof setTimeout>) => { timers.delete(id); clearTimeout(id) }
    return Reflect.get(t, k)
  },
})
g.addEventListener = events.addEventListener.bind(events)
g.removeEventListener = events.removeEventListener.bind(events)
g.dispatchEvent = events.dispatchEvent.bind(events)
let offline = false
const inflight = new Set<Promise<unknown>>()
const realFetch = globalThis.fetch
g.fetch = ((url: string, init?: RequestInit) => {
  if (offline) return Promise.reject(new TypeError("Failed to fetch (offline)"))
  const p = realFetch(url, init); inflight.add(p); void p.catch(() => undefined).finally(() => inflight.delete(p)); return p
}) as typeof fetch
async function dispose() {
  for (const id of timers) clearTimeout(id)
  timers.clear()
  for (let i = 0; i < 20 && (inflight.size > 0 || i < 3); i++) { await Promise.allSettled([...inflight]); await new Promise((r) => setImmediate(r)) }
}
const mod = (name: string) => import(/* @vite-ignore */ pathToFileURL(`${SRC}/features/pos/${name}.ts`).href)
let d: Record<string, any>
const queue = () => JSON.parse(storage.getItem("lebanonpos.sync-queue.v1") ?? "[]") as Array<Record<string, any>>
const flush = async () => {
  for (let i = 0; i < 3; i++) {
    storage.setItem("lebanonpos.sync-queue.v1", JSON.stringify(queue().map((op) => ({ ...op, status: op.status === "Failed" ? "Pending" : op.status, lastAttemptAt: "2000-01-01T00:00:00.000Z" }))))
    await d.sync.flushSyncQueue()
  }
  await dispose()
}
const errOf = (op: any) => String(op?.lastError ?? op?.error ?? "")
// test-only: start each section with no recent refusals on this register (the lockout itself is tested last)
const clearLock = () => prisma.auditEvent.deleteMany({ where: { tenantId: T, action: "approval.refused" } })

let prisma: typeof import("../src/lib/prisma.js").default
let verifier: typeof import("../src/lib/pinVerifier.js")
let server: http.Server
let base = ""
const T = randomUUID(), SUB = `rpin-${T.slice(0, 8)}`
const OWNER = randomUUID()
// test PINs of a disposable scratch store
const PIN = { owner: "8701", lina: "8702", sami: "8703", linaNew: "8712", linaOffline: "8722" }
let product: { id: number; syncId: string; name: string; barcode: string }
const call = async (method: string, p: string, body?: unknown, token?: string) => {
  const r = await realFetch(`${base}${p}`, { method, headers: { "Content-Type": "application/json", "x-titan-sync-schema": "6", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) })
  return { status: r.status, body: (await r.json().catch(() => null)) as any }
}
const login = async (pin: string) => (await call("POST", "/api/auth/login", { pin, tenantSubdomain: SUB })).body?.token as string
const staffRow = (name: string) => prisma.staffUser.findFirst({ where: { tenantId: T, name } })
const localProduct = () => (JSON.parse(storage.getItem("lebanonpos.products.v1") ?? "[]") as any[]).find((p) => p.syncId === product.syncId)
const ask = (entity: string, action: string, payload: any, permission: string, pin: string, extra: Record<string, unknown> = {}) =>
  d.approval.requestManagerApproval({ entity, action, payload, permission, pin, ...extra }).finally(dispose)
function sale(qty: number, discount = 0) {
  const p = localProduct(); const id = randomUUID(); const gross = qty * 5
  return d.sales.buildSale({ saleNumber: `S-RPIN-${id.slice(0, 6)}`, paymentMethod: "Cash", subtotal: gross - discount, discountTotal: discount, tax: 0, total: gross - discount,
    items: [{ id: p.id, productSyncId: p.syncId, name: p.name, barcode: p.barcode ?? "", quantity: qty, unitPrice: 5, total: gross, batchAllocations: [] }] }, id)
}
const lots = (qty: number) => { const p = localProduct(); return { lots: [{ productId: p.id, productName: p.name, barcode: p.barcode ?? "", quantity: qty, fallbackUnitCost: 0 }], stock: [{ productId: p.id, quantity: qty }] } }

beforeAll(async () => {
  vi.setConfig({ testTimeout: 90_000 })
  prisma = (await import("../src/lib/prisma.js")).default
  verifier = await import("../src/lib/pinVerifier.js")
  const bcrypt = (await import("bcryptjs")).default
  const app = (await import("../src/app.js")).default
  process.env.IS_LOCAL_SERVER = "false"
  server = http.createServer(app)
  await new Promise<void>((r) => server.listen(0, r))
  base = `http://localhost:${(server.address() as AddressInfo).port}`
  await prisma.tenant.create({ data: { id: T, name: "Register PIN IT (disposable)", subdomain: SUB } })
  await prisma.staffUser.create({ data: { id: OWNER, tenantId: T, name: "Owner", mobile: `rp-${OWNER.slice(0, 8)}`, pin: await bcrypt.hash(PIN.owner, 12), role: "Admin", pinChanged: true } as any })
  const p = await prisma.product.create({ data: { tenantId: T, syncId: randomUUID(), name: "Coffee bag", price: 5, cost: 2, stock: 60, barcode: `rp-${T.slice(0, 6)}`, category: "Coffee" } })
  product = { id: p.id, syncId: p.syncId!, name: p.name, barcode: p.barcode ?? "" }
  storage.setItem("lebanonpos.api-url", base)
  storage.setItem("lebanonpos.store-subdomain.v1", SUB)
  storage.setItem("lebanonpos.tenant-id.v1", T)
  storage.setItem("lebanonpos.device-id.v1", "rpin-till")
  storage.setItem("lebanonpos.users.v1", "[]")
  d = {
    sync: await mod("services/sync.service"), security: await mod("services/security.service"), sales: await mod("services/sales.service"),
    approval: await mod("services/approval.service"), devices: await mod("services/deviceRegistry.service"), grants: await mod("lib/approvalGrants"),
  }
  const owner = await login(PIN.owner)
  const code = (await call("POST", "/api/device/generate-code", {}, owner)).body.code
  storage.setItem("lebanonpos.auth-token", owner)
  expect((await d.devices.pairDevice(code, "rpin-till", "Counter 1")).ok).toBe(true)
  await d.sync.pullFromServer(true); await dispose()
  expect((await d.security.unlockWithPin(PIN.owner))?.id).toBe(OWNER); await dispose()
  // the owner adds a manager and a cashier ON THE REGISTER (as the Staff screen does)
  await d.security.createUser({ name: "Lina", mobile: "000-083-01", pin: PIN.lina, role: "Manager" })
  await d.security.createUser({ name: "Sami", mobile: "000-083-02", pin: PIN.sami, role: "Cashier" })
  await flush()
  expect(queue().filter((op) => op.status !== "Synced").map((op) => [op.entity, op.action, errOf(op)])).toEqual([])
})

afterAll(async () => {
  await dispose()
  for (const m of ["managerApproval", "auditEvent", "operationEvidence", "syncOperation", "syncClient", "stockMovement", "cashMovement", "saleItem", "sale", "shift", "staffSession", "pairingCode", "device", "product", "staffUser"])
    await (prisma as any)[m]?.deleteMany({ where: { tenantId: T } }).catch(() => undefined)
  await (prisma as any).refundItem.deleteMany({ where: { refund: { tenantId: T } } }).catch(() => undefined)
  await prisma.saleRefund.deleteMany({ where: { tenantId: T } }).catch(() => undefined)
  await prisma.tenant.deleteMany({ where: { id: T } })
  await new Promise<void>((r) => server.close(() => r()))
})

describe("PIN verifiers", () => {
  it("one rule: bcrypt and a register's SHA-256 (base64) match; hex, withheld and malformed never do", async () => {
    const bcrypt = (await import("bcryptjs")).default
    const { createHash } = await import("node:crypto")
    const b = await bcrypt.hash("4242", 4)
    expect([verifier.verifierKind(b), await verifier.pinMatches(b, "4242"), await verifier.pinMatches(b, "4243")]).toEqual(["bcrypt", true, false])
    const s = createHash("sha256").update("4242").digest("base64")
    expect([verifier.verifierKind(s), await verifier.pinMatches(s, "4242"), await verifier.pinMatches(s, "4243")]).toEqual(["sha256", true, false])
    for (const bad of [createHash("sha256").update("4242").digest("hex"), "$2-withheld", "4242", "", null, s.slice(1), `${b}x`])
      expect([verifier.verifierKind(bad), await verifier.pinMatches(bad, "4242")]).toEqual(["invalid", false])
    expect(await verifier.pinMatches(s, "")).toBe(false)
    // duplicates: decidable, or "unknown" (a register's SHA-256 against bcrypt)
    expect([await verifier.samePin("4242", b), await verifier.samePin(s, s), await verifier.samePin(s, b), await verifier.samePin(b, b)]).toEqual(["same", "same", "unknown", "different"])
  })

  it("staff added on the register are stored with the register's SHA-256 verifier; no PIN in operations or the audit", async () => {
    for (const name of ["Lina", "Sami"]) expect(verifier.verifierKind((await staffRow(name))!.pin)).toBe("sha256")
    const stored = JSON.stringify(await prisma.syncOperation.findMany({ where: { tenantId: T } })) + JSON.stringify(await prisma.auditEvent.findMany({ where: { tenantId: T } }))
    for (const pin of Object.values(PIN)) expect(stored).not.toContain(`"${pin}"`)
  })
})

describe("a manager added on the register approves; wrong and cashier PINs do not", () => {
  it("the cashier signs in with her own PIN: a server-checked staff session", async () => {
    storage.setItem("lebanonpos.auth-token", await login(PIN.sami))
    d.security.lockSession(); await dispose()
    expect((await d.security.unlockWithPin(PIN.sami))?.name).toBe("Sami"); await dispose()
    const s = await call("POST", "/api/auth/staff-session", { pin: PIN.sami }, undefined)
    expect([401, 403]).toContain(s.status) // without the enrolled device's credential, no session
    const { deviceCredentialFor } = await mod("lib/deviceCredentials")
    const r = await realFetch(`${base}/api/auth/staff-session`, { method: "POST", headers: { "Content-Type": "application/json", "x-device-credential": deviceCredentialFor(base) }, body: JSON.stringify({ pin: PIN.sami }) })
    expect([r.status, ((await r.json()) as any).staff?.name]).toEqual([200, "Sami"])
    expect(d.security.openShift(20)).toBeTruthy()
    await flush()
  })

  it("discount, refund, void and payout: Lina's PIN approves (before she ever signs in); a wrong PIN and Sami's PIN are refused", async () => {
    expect(verifier.verifierKind((await staffRow("Lina"))!.pin)).toBe("sha256") // never migrated by a sign-in
    // discount at checkout
    const s1 = sale(2, 1)
    expect((await ask("sale", "create", s1, "sales.discount", "0000", { permissions: ["sales.discount"] })).code).toBe("INVALID_PIN")
    expect((await ask("sale", "create", s1, "sales.discount", PIN.sami, { permissions: ["sales.discount"] })).code).toBe("APPROVER_LACKS_PERMISSION")
    const disc = await ask("sale", "create", s1, "sales.discount", PIN.lina, { permissions: ["sales.discount"] })
    expect([disc.ok, disc.ok && disc.grant.approverName]).toEqual([true, "Lina"])
    expect(d.sales.checkoutLocalSale({ sale: s1, ...lots(2) }).status).toBe("completed")
    // refund
    const s2 = sale(2); expect(d.sales.checkoutLocalSale({ sale: s2, ...lots(2) }).status).toBe("completed")
    const stored2 = d.sales.getSales().find((x: any) => x.id === s2.id)
    const quantities = { [d.sales.refundLineKeyOf(stored2.items[0])]: 1 }
    const refundId = randomUUID()
    const payload = d.sales.refundApprovalPayload({ saleId: s2.id, quantities, reason: "IT", id: refundId })
    expect((await ask("refund", "create", payload, "sales.refund", PIN.lina)).ok).toBe(true)
    d.sales.processRefund({ saleId: s2.id, quantities, reason: "IT", id: refundId })
    // void (a clean sale)
    const s3 = sale(1); expect(d.sales.checkoutLocalSale({ sale: s3, ...lots(1) }).status).toBe("completed")
    expect((await ask("sale", "void", { id: s3.id, saleNumber: s3.saleNumber }, "sales.void", PIN.lina)).ok).toBe(true)
    d.sales.voidSale(s3.id)
    // payout
    const draw = { id: randomUUID(), type: "PettyCash", direction: "Out", amountUsd: 3, reason: "IT milk", recordedById: (await staffRow("Sami"))!.id, recordedByName: "Sami", createdAt: new Date().toISOString() }
    expect((await ask("cash-movement", "create", draw, "cash.manage", PIN.lina)).ok).toBe(true)
    await flush()
    const left = queue().filter((op) => op.status !== "Synced" && op.entity !== "cash-movement").map((op) => [op.entity, op.action, errOf(op).slice(0, 80)])
    expect(left).toEqual([])
    const [srv1, srv3] = await Promise.all([prisma.sale.findFirst({ where: { tenantId: T, id: s1.id } }), prisma.sale.findFirst({ where: { tenantId: T, id: s3.id } })])
    expect([Number(srv1?.discountTotal), srv3?.status, await prisma.saleRefund.count({ where: { tenantId: T, id: refundId } })]).toEqual([1, "Voided", 1])
    const approvals = await prisma.managerApproval.findMany({ where: { tenantId: T, approverName: "Lina" } })
    expect(approvals.map((a) => a.permission).sort()).toEqual(["cash.manage", "sales.discount", "sales.refund", "sales.void"])
  })

  it("Lina signs in online with the same PIN, and it keeps approving afterwards", async () => {
    expect(await login(PIN.lina)).toBeTruthy()
    const s = sale(1, 0.5)
    expect((await ask("sale", "create", s, "sales.discount", PIN.lina, { permissions: ["sales.discount"] })).ok).toBe(true)
  })
})

describe("duplicate PINs", () => {
  beforeAll(clearLock)
  it("the same PIN as a SHA-256 already stored: refused by the register, and by the server if sent anyway", async () => {
    storage.setItem("lebanonpos.auth-token", await login(PIN.owner))
    d.security.lockSession(); await dispose()
    expect((await d.security.unlockWithPin(PIN.owner))?.id).toBe(OWNER); await dispose()
    await expect(d.security.createUser({ name: "Copy of Sami", mobile: "000-083-03", pin: PIN.sami, role: "Cashier" })).rejects.toThrow(/already in use/)
    const sha = (await import("node:crypto")).createHash("sha256").update(PIN.sami).digest("base64")
    const owner = await login(PIN.owner)
    const r = await call("POST", "/api/sync/push", { deviceId: "rpin-other", operations: [{ id: randomUUID(), entity: "staff", action: "create", payload: { id: randomUUID(), name: "Copy of Sami", mobile: "000-083-04", pin: sha, role: "Cashier" } }] }, owner)
    expect(JSON.stringify(r.body)).toMatch(/already in use/)
    expect(await prisma.staffUser.count({ where: { tenantId: T, name: "Copy of Sami" } })).toBe(0)
  })

  it("a register's SHA-256 equal to someone's bcrypt PIN cannot be detected when added; it never approves or opens a checked session for anyone", async () => {
    // the owner's PIN is bcrypt; a register sends the same PIN as SHA-256 (it cannot know the owner's PIN)
    const sha = (await import("node:crypto")).createHash("sha256").update(PIN.owner).digest("base64")
    const owner = await login(PIN.owner)
    const twinId = randomUUID()
    const r = await call("POST", "/api/sync/push", { deviceId: "rpin-other", operations: [{ id: randomUUID(), entity: "staff", action: "create", payload: { id: twinId, name: "Twin", mobile: "000-083-05", pin: sha, role: "Cashier", permissions: ["sales.checkout"] } }] }, owner)
    expect(r.body.results?.[0]?.status).toBe("ok")
    const s = sale(1, 0.5)
    const amb = await ask("sale", "create", s, "sales.discount", PIN.owner, { permissions: ["sales.discount"] })
    expect([amb.ok, amb.code, amb.candidates]).toEqual([false, "AMBIGUOUS_PIN", undefined])
    // naming the owner does not help: the PIN does not prove who typed it
    expect((await ask("sale", "create", s, "sales.discount", PIN.owner, { permissions: ["sales.discount"], approverId: OWNER })).code).toBe("AMBIGUOUS_PIN")
    const { deviceCredentialFor } = await mod("lib/deviceCredentials")
    const sess = await realFetch(`${base}/api/auth/staff-session`, { method: "POST", headers: { "Content-Type": "application/json", "x-device-credential": deviceCredentialFor(base) }, body: JSON.stringify({ pin: PIN.owner, staffId: OWNER }) })
    const sb = (await sess.json()) as any
    expect([sess.status, sb.code, sb.candidates]).toEqual([409, "AMBIGUOUS_PIN", undefined])
    // the owner gives the twin another PIN (here: deactivated): the owner's PIN approves again
    await prisma.staffUser.update({ where: { id: twinId }, data: { active: false } })
    // (asked for by the cashier: the owner cannot approve the owner's own action)
    storage.setItem("lebanonpos.auth-token", await login(PIN.sami))
    d.security.lockSession(); await dispose()
    expect((await d.security.unlockWithPin(PIN.sami))?.name).toBe("Sami"); await dispose()
    expect((await ask("sale", "create", s, "sales.discount", PIN.owner, { permissions: ["sales.discount"] })).ok).toBe(true)
  })
})

describe("a PIN changed elsewhere while this register was offline", () => {
  beforeAll(clearLock)
  it("the offline change is refused and kept; the new PIN works, the old and the offline one do not", async () => {
    const lina = (await staffRow("Lina"))!
    storage.setItem("lebanonpos.auth-token", await login(PIN.owner))
    d.security.lockSession(); await dispose()
    expect((await d.security.unlockWithPin(PIN.owner))?.id).toBe(OWNER); await dispose()
    offline = true
    await d.security.updateUser(lina.id, { pin: PIN.linaOffline })
    await dispose()
    // meanwhile another register changes it (owner on another device, on the current version)
    const sha = (await import("node:crypto")).createHash("sha256").update(PIN.linaNew).digest("base64")
    const owner = await login(PIN.owner)
    const ch = await call("POST", "/api/sync/push", { deviceId: "rpin-other", operations: [{ id: randomUUID(), entity: "staff", action: "pin", payload: { id: lina.id, pin: sha, basePinVersion: lina.pinVersion } }] }, owner)
    expect(ch.body.results?.[0]?.status).toBe("ok")
    offline = false
    await flush()
    const op = queue().find((o) => o.entity === "staff" && o.action === "pin")
    expect([op?.status !== "Synced", errOf(op)]).toEqual([true, expect.stringMatching(/STALE_STAFF/)]) // kept on the register, never applied
    const s = sale(1, 0.5)
    expect((await ask("sale", "create", s, "sales.discount", PIN.linaOffline, { permissions: ["sales.discount"] })).code).toBe("INVALID_PIN")
    expect((await ask("sale", "create", s, "sales.discount", PIN.lina, { permissions: ["sales.discount"] })).code).toBe("INVALID_PIN")
    expect((await ask("sale", "create", s, "sales.discount", PIN.linaNew, { permissions: ["sales.discount"] })).ok).toBe(true)
  })
})

describe("lockout", () => {
  beforeAll(clearLock)
  it("wrong PINs are counted per register; repeated requests after the lock are refused, even with the right PIN", async () => {
    const s = sale(1, 0.5)
    const codes: string[] = []
    for (let i = 0; i < 6; i++) codes.push((await ask("sale", "create", s, "sales.discount", "0001", { permissions: ["sales.discount"] })).code)
    expect(codes.slice(-1)).toEqual(["APPROVAL_LOCKED"])
    expect((await ask("sale", "create", s, "sales.discount", PIN.linaNew, { permissions: ["sales.discount"] })).code).toBe("APPROVAL_LOCKED")
  })
})

import { describe, it, expect, beforeAll, afterAll } from "vitest"
import http from "node:http"
import type { AddressInfo } from "node:net"
import { randomUUID } from "node:crypto"
import jwt from "jsonwebtoken"

// SHIFT / DRAWER / EXPENSE PERMISSIONS on the sync push (real Postgres).
// The desktop services refuse these too; this proves a client that skips
// them cannot get the records accepted. Two identities are checked:
//  - the pushing account (a cashier's own token);
//  - the staff member the record names (closedById / recordedById), because
//    a store's devices normally push with the store account's token.
process.env.JWT_SECRET = process.env.JWT_SECRET || "shift-perm-secret"

const prisma = (await import("../src/lib/prisma.js")).default
const app = (await import("../src/app.js")).default

let server: http.Server
let baseUrl = ""
const T = randomUUID()
const ADMIN = randomUUID(), MANAGER = randomUUID(), CASH1 = randomUUID(), CASH2 = randomUUID()
const DEV = `SP-${T.slice(0, 8)}`
const tokens: Record<string, string> = {}

async function push(as: "admin" | "cash1" | "cash2", entity: string, action: string, payload: Record<string, unknown>) {
  const res = await fetch(`${baseUrl}/api/sync/push`, {
    method: "POST",
    headers: { Authorization: `Bearer ${tokens[as]}`, "Content-Type": "application/json" },
    body: JSON.stringify({ deviceId: DEV, operations: [{ id: randomUUID(), entity, action, payload }] }),
  })
  const body = (await res.json()) as any
  if (!body?.results) throw new Error(`push refused: HTTP ${res.status} ${JSON.stringify(body).slice(0, 300)}`)
  return body.results[0] as { status: string; error?: string }
}
const now = () => new Date().toISOString()
const shiftRow = (id: string) => prisma.shift.findUnique({ where: { id } })
async function openShiftAs(opener: string, token: "admin" | "cash1" | "cash2" = "admin") {
  const id = randomUUID()
  const r = await push(token, "shift", "open", { id, shiftNumber: `SHIFT-${id.slice(0, 4)}`, status: "Open", openedAt: now(), openedById: opener, openedByName: "x", openingFloatUsd: 100 })
  expect(r.status).toBe("ok")
  return id
}
const closePayload = (id: string, closer: string) => ({ id, status: "Closed", closedAt: now(), closedById: closer, closedByName: "x", expectedCashUsd: 100, closingCashUsd: 100, differenceUsd: 0 })

beforeAll(async () => {
  server = http.createServer(app)
  await new Promise<void>((resolve) => server.listen(0, resolve))
  baseUrl = `http://localhost:${(server.address() as AddressInfo).port}`
  await prisma.tenant.create({ data: { id: T, name: "Shift permissions IT (disposable)", subdomain: `sp-${T.slice(0, 8)}` } })
  for (const [id, role, name] of [[ADMIN, "Admin", "Owner"], [MANAGER, "Manager", "Rania"], [CASH1, "Cashier", "Omar"], [CASH2, "Cashier", "Lea"]] as const) {
    await prisma.staffUser.create({ data: { id, tenantId: T, name, mobile: `sp-${id.slice(0, 8)}`, pin: "x", role } })
  }
  await prisma.device.create({ data: { tenantId: T, deviceId: DEV, deviceName: DEV, status: "APPROVED" } })
  for (const [k, id, role] of [["admin", ADMIN, "Admin"], ["cash1", CASH1, "Cashier"], ["cash2", CASH2, "Cashier"]] as const) {
    tokens[k] = jwt.sign({ userId: id, tenantId: T, role }, process.env.JWT_SECRET!, { expiresIn: "1h" })
  }
})

afterAll(async () => {
  await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())))
  for (const m of ["syncOperation", "expense", "cashMovement", "shift", "auditEvent", "device"]) await (prisma as any)[m].deleteMany({ where: { tenantId: T } }).catch(() => {})
  await prisma.staffUser.deleteMany({ where: { tenantId: T } })
  await prisma.tenant.deleteMany({ where: { id: T } })
})

describe("shift close", () => {
  it("a cashier's own token cannot close a shift another user opened; the shift stays open", async () => {
    const id = await openShiftAs(CASH1)
    const r = await push("cash2", "shift", "close", closePayload(id, CASH2))
    expect(r.status).toBe("error")
    expect(r.error).toMatch(/opened this shift or a manager/)
    expect(await shiftRow(id)).toMatchObject({ status: "Open", closedById: null, openedById: CASH1 })
  })

  it("a cashier token cannot close another user's shift even when the record names the opener", async () => {
    const id = await openShiftAs(CASH1)
    const r = await push("cash2", "shift", "close", closePayload(id, CASH1))
    expect(r.status).toBe("error")
    expect(await shiftRow(id)).toMatchObject({ status: "Open", closedById: null })
  })

  it("via the store account, a close recorded by another cashier is refused", async () => {
    const id = await openShiftAs(CASH1)
    const r = await push("admin", "shift", "close", closePayload(id, CASH2))
    expect(r.status).toBe("error")
    expect(await shiftRow(id)).toMatchObject({ status: "Open", closedById: null })
  })

  it("the opener can close their own shift, with their own token or the store account", async () => {
    const a = await openShiftAs(CASH1, "cash1")
    expect((await push("cash1", "shift", "close", closePayload(a, CASH1))).status).toBe("ok")
    expect(await shiftRow(a)).toMatchObject({ status: "Closed", closedById: CASH1 })
    const b = await openShiftAs(CASH1)
    expect((await push("admin", "shift", "close", closePayload(b, CASH1))).status).toBe("ok")
  })

  it("a manager (shifts.manage) can close a cashier's shift", async () => {
    const id = await openShiftAs(CASH1)
    expect((await push("admin", "shift", "close", closePayload(id, MANAGER))).status).toBe("ok")
    expect(await shiftRow(id)).toMatchObject({ status: "Closed", closedById: MANAGER })
  })

  it("a close cannot rewrite who opened the shift or its float", async () => {
    const id = await openShiftAs(CASH1)
    const r = await push("admin", "shift", "close", { ...closePayload(id, CASH1), openedById: CASH2, openingFloatUsd: 9999 })
    expect(r.status).toBe("ok")
    const row = await shiftRow(id)
    expect(row?.openedById).toBe(CASH1)
    expect(Number(row?.openingFloatUsd)).toBe(100)
  })

  it("a close naming a staff member the server does not know fails closed", async () => {
    const id = await openShiftAs(CASH1)
    const r = await push("admin", "shift", "close", closePayload(id, randomUUID()))
    expect(r.status).toBe("error")
    expect(await shiftRow(id)).toMatchObject({ status: "Open" })
  })
})

describe("owner draw (cash movement) and expense", () => {
  const draw = (by: string) => ({ id: randomUUID(), type: "OwnerDraw", direction: "Out", amountUsd: 20, reason: "Owner draw", recordedById: by, recordedByName: "x", createdAt: now() })
  const expense = (by?: string) => ({ id: randomUUID(), expenseNumber: `EXP-${randomUUID().slice(0, 4)}`, vendor: "EDL", category: "Utilities", amount: 12, paymentMethod: "Cash", recordedBy: "x", ...(by ? { recordedById: by } : {}), createdAt: now() })

  it("a cashier cannot take an owner draw, by token or as the recorded user; a manager can", async () => {
    const a = draw(CASH1)
    expect((await push("cash1", "cash-movement", "create", a)).status).toBe("error")
    const b = draw(CASH1)
    expect((await push("admin", "cash-movement", "create", b)).status).toBe("error")
    expect(await prisma.cashMovement.count({ where: { id: { in: [a.id as string, b.id as string] } } })).toBe(0)
    const c = draw(MANAGER)
    expect((await push("admin", "cash-movement", "create", c)).status).toBe("ok")
    expect(await prisma.cashMovement.count({ where: { id: c.id as string } })).toBe(1)
  })

  it("a cashier cannot record an expense, by token or as the recorded user; a manager can", async () => {
    const a = expense()
    expect((await push("cash1", "expense", "create", a)).status).toBe("error")
    const b = expense(CASH1)
    expect((await push("admin", "expense", "create", b)).status).toBe("error")
    expect(await prisma.expense.count({ where: { id: { in: [a.id as string, b.id as string] } } })).toBe(0)
    const c = expense(MANAGER)
    expect((await push("admin", "expense", "create", c)).status).toBe("ok")
    expect(await prisma.expense.count({ where: { id: c.id as string } })).toBe(1)
  })

  it("every refusal is audited", async () => {
    expect(await prisma.auditEvent.count({ where: { tenantId: T, action: "security.permission.denied" } })).toBeGreaterThanOrEqual(6)
  })
})

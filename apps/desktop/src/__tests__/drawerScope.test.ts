// Batch 83: the drawer scope on a register, against the real services (network blocked).
//  - a shift belongs to the register that opened it; another register's open shift is NOT used unless the store
//    chose one shared drawer (settings.drawerScope "shared"), and no second drawer is opened beside it
//  - shared: the register sells into the one open shift; its cash counts once in that shift's expected cash;
//    a cashier cannot close another person's shift, a manager can
//  - a shift opened before registers were recorded (no deviceId) is usable, as before
import { beforeEach, describe, expect, it, vi } from "vitest"

const USERS_KEY = "lebanonpos.users.v1"
const CURRENT_USER_KEY = "lebanonpos.current-user.v1"
const SHIFTS_KEY = "lebanonpos.shifts.v1"
const SALES_KEY = "lebanonpos.sales.v1"
const SETTINGS_KEY = "lebanonpos.settings.v1"
const DEVICE_KEY = "lebanonpos.device-id.v1"
const read = (key: string) => JSON.parse(window.localStorage.getItem(key) ?? "[]")

const PC = "dev-pc", PHONE = "dev-phone"
const pcShift = { id: "sh-pc", shiftNumber: "SHIFT-PC-001", status: "Open", openedAt: "2026-11-03T08:00:00.000Z", openingFloatUsd: 20, openedById: "u-cash", openedByName: "Café Cashier", deviceId: PC, deviceName: "Counter PC" }
function seed(opts: { scope?: "shared" | null; shifts?: unknown[]; user?: string; device?: string } = {}) {
  window.localStorage.setItem(USERS_KEY, JSON.stringify([
    { id: "u-cash", name: "Café Cashier", role: "Cashier", pin: "H1", active: true, permissions: ["sales.checkout", "sales.reprint", "inventory.view"] },
    { id: "u-cash2", name: "Phone Cashier", role: "Cashier", pin: "H2", active: true, permissions: ["sales.checkout", "sales.reprint", "inventory.view"] },
    { id: "u-mgr", name: "Café Manager", role: "Manager", pin: "H3", active: true },
  ]))
  window.localStorage.setItem(CURRENT_USER_KEY, opts.user ?? "u-cash2")
  window.localStorage.setItem(DEVICE_KEY, opts.device ?? PHONE)
  window.localStorage.setItem(SETTINGS_KEY, JSON.stringify({ storeName: "IT", drawerScope: opts.scope ?? null }))
  window.localStorage.setItem(SHIFTS_KEY, JSON.stringify(opts.shifts ?? [pcShift]))
}
const services = async () => ({ security: await import("../features/pos/services/security.service"), shift: await import("../features/pos/services/shift.service") })

beforeEach(() => {
  vi.resetModules()
  window.localStorage.clear()
  vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("network disabled in tests"))))
})

describe("drawer scope not chosen (the default)", () => {
  it("the phone does not use the PC's open shift and cannot open a second drawer; it is told whose shift is open", async () => {
    seed()
    const { security } = await services()
    expect(security.getActiveShift()).toBeUndefined()
    expect(security.getOtherRegistersShift()?.shiftNumber).toBe("SHIFT-PC-001")
    expect(() => security.openShift(10)).toThrow(/SHIFT_OTHER_REGISTER: SHIFT-PC-001 is open on Counter PC \(opened by Café Cashier\)/)
    expect(read(SHIFTS_KEY).filter((s: any) => s.status === "Open")).toHaveLength(1)
  })

  it("the PC keeps using its own shift; a shift opened before registers were recorded is usable as before", async () => {
    seed({ device: PC, user: "u-cash" })
    let { security } = await services()
    expect(security.getActiveShift()?.id).toBe("sh-pc")
    vi.resetModules()
    seed({ shifts: [{ ...pcShift, deviceId: undefined, deviceName: undefined }] })
    ;({ security } = await services())
    expect(security.getActiveShift()?.id).toBe("sh-pc")
  })

  it("with nothing open, the phone opens its own shift, recorded as the phone's", async () => {
    seed({ shifts: [{ ...pcShift, status: "Closed", closedAt: "2026-11-03T09:00:00.000Z", closingCashUsd: 20 }] })
    const { security } = await services()
    const s = security.openShift(10)!
    expect([s.deviceId, s.status, security.getActiveShift()?.id]).toEqual([PHONE, "Open", s.id])
  })
})

describe("one shared drawer (chosen by the owner)", () => {
  it("the phone sells into the PC's shift; its cash counts once in the shift's expected cash", async () => {
    const sale = (id: string, total: number, method = "Cash", shift = "sh-pc") => ({ id, saleNumber: id, paymentMethod: method, subtotal: total, tax: 0, total, status: "Completed", createdAt: "2026-11-03T08:30:00.000Z", shiftId: shift, items: [] })
    seed({ scope: "shared" })
    // the PC's sale (pulled), the phone's cash and card sales, and one from another shift
    window.localStorage.setItem(SALES_KEY, JSON.stringify([sale("pc-1", 5.5), sale("ph-1", 4.75), sale("ph-2", 3.5, "Card"), sale("old", 9, "Cash", "sh-old")]))
    const { security, shift } = await services()
    expect(security.getActiveShift()?.id).toBe("sh-pc")
    expect(security.openShift(10)?.id).toBe("sh-pc") // joins; no second drawer
    expect(read(SHIFTS_KEY).filter((s: any) => s.status === "Open")).toHaveLength(1)
    expect(shift.computeExpectedCash(security.getActiveShift()!)).toBe(20 + 5.5 + 4.75)
  })

  it("closing: the phone's cashier cannot close the PC cashier's shift; a manager can", async () => {
    seed({ scope: "shared" })
    let { security } = await services()
    expect(() => security.closeShift({ shiftId: "sh-pc", expectedCashUsd: 20, closingCashUsd: 20 })).toThrow(/Only the person who opened this shift or a manager/)
    expect(security.getActiveShift()?.status).toBe("Open")
    vi.resetModules()
    seed({ scope: "shared", user: "u-mgr" })
    ;({ security } = await services())
    expect(security.closeShift({ shiftId: "sh-pc", expectedCashUsd: 20, closingCashUsd: 20 })?.status).toBe("Closed")
  })
})

describe("daily close: each sale counts once across registers", () => {
  const today = new Date().toISOString()
  const rec = (id: string, total: number, shiftId: string, method = "Cash") => ({ id, saleNumber: id, paymentMethod: method, subtotal: total, tax: 0, total, status: "Completed", createdAt: today, shiftId, items: [] })
  const phoneShift = { ...pcShift, id: "sh-phone", shiftNumber: "SHIFT-PH-001", deviceId: PHONE, deviceName: "Phone", status: "Closed", closedAt: today, closingCashUsd: 10 }
  it("separate drawers (not shared): a register's close counts its own shifts' sales, not another register's", async () => {
    seed({ device: PC, user: "u-mgr", shifts: [{ ...pcShift, status: "Closed", closedAt: today, closingCashUsd: 25.5 }, phoneShift] })
    const { security } = await services()
    const { getAccountingSummary } = await import("../pages/accounting/accounting.helpers")
    const sales = [rec("pc-1", 5.5, "sh-pc"), rec("ph-1", 4.75, "sh-phone"), rec("legacy", 2, "")] as any[]
    const pc = getAccountingSummary(sales, [], [], [], security.recordInThisDrawer)
    expect([pc.grossSales, pc.saleIds.sort()]).toEqual([7.5, ["legacy", "pc-1"]])
    vi.resetModules()
    seed({ device: PHONE, user: "u-mgr", shifts: [{ ...pcShift, status: "Closed", closedAt: today, closingCashUsd: 25.5 }, phoneShift] })
    const s2 = await services()
    const { getAccountingSummary: g2 } = await import("../pages/accounting/accounting.helpers")
    const ph = g2(sales, [], [], [], s2.security.recordInThisDrawer)
    // the PC's and the phone's closes together count pc-1 and ph-1 once each (a legacy record without a shift
    // is counted by every register, as before)
    expect(ph.saleIds.filter((id: string) => pc.saleIds.includes(id))).toEqual(["legacy"])
  })

  it("one shared drawer: the store's close; a second register closing the same date corrects it (never adds)", async () => {
    seed({ scope: "shared", device: PC, user: "u-mgr", shifts: [{ ...pcShift, status: "Closed", closedAt: today, closingCashUsd: 30.25 }] })
    const closeInput = (gross: number) => ({ dateKey: today.slice(0, 10), grossSales: gross, refunds: 0, netSales: gross, costOfGoods: 0, returnedCost: 0, grossMargin: gross, expenses: 0, supplierPayments: 0, netProfit: gross, cashIn: gross, cashOut: 0, note: "", saleIds: [], refundIds: [] })
    let dc = await import("../features/pos/services/dailyClose.service")
    const first = dc.closeBusinessDay(closeInput(10.25) as any)
    expect([first.registerId, first.deviceId, first.shiftId, first.revision]).toEqual(["SHARED-DRAWER", undefined, undefined, 1])
    // the phone (same store, local closes pulled) closes the same date
    const closes = window.localStorage.getItem("lebanonpos.daily-closes.v1")
    vi.resetModules()
    seed({ scope: "shared", device: PHONE, user: "u-mgr", shifts: [{ ...pcShift, status: "Closed", closedAt: today, closingCashUsd: 30.25 }] })
    if (closes) window.localStorage.setItem("lebanonpos.daily-closes.v1", closes)
    dc = await import("../features/pos/services/dailyClose.service")
    const second = dc.closeBusinessDay(closeInput(10.25) as any)
    expect([second.registerId, second.revision, second.correctsId]).toEqual(["SHARED-DRAWER", 2, first.id])
    expect(dc.currentDailyCloses(dc.getDailyCloses()).filter((c: any) => c.dateKey === first.dateKey)).toHaveLength(1)
  })
})

describe("the refusal is shown in the register's language", () => {
  it("names the open shift, its register and who opened it (en, ar)", async () => {
    seed()
    const { security } = await services()
    const { shiftOpenRefusal } = await import("../features/pos/lib/shiftScope")
    const { en } = await import("../../../../packages/shared/src/i18n/en")
    const { ar } = await import("../../../../packages/shared/src/i18n/ar")
    let err: unknown
    try { security.openShift(10) } catch (e) { err = e }
    for (const dict of [en, ar] as Array<Record<string, string>>) {
      const t = (k: string, v: Record<string, string | number> = {}) => (dict[k] ?? k).replace(/\{(\w+)\}/g, (_, n) => String(v[n] ?? ""))
      const text = shiftOpenRefusal(err, t)
      expect(text).toContain("SHIFT-PC-001"); expect(text).toContain("Counter PC"); expect(text).toContain("Café Cashier")
      expect(text).not.toContain("SHIFT_OTHER_REGISTER")
    }
  })
})

describe("what a register sends stays readable by an older server (rollout safety)", () => {
  it("shift open/close never carry the register's name; a routine settings save never carries the drawer scope", async () => {
    seed({ device: PHONE, shifts: [{ ...pcShift, status: "Closed", closedAt: "2026-11-03T09:00:00.000Z", closingCashUsd: 20 }] })
    const { security } = await services()
    const s = security.openShift(10)!
    // a pulled copy of the shift (from a schema-7 hub) carries the name; the close still does not send it
    window.localStorage.setItem(SHIFTS_KEY, JSON.stringify(read(SHIFTS_KEY).map((x: any) => (x.id === s.id ? { ...x, deviceName: "Phone" } : x))))
    window.localStorage.setItem(CURRENT_USER_KEY, "u-mgr")
    security.closeShift({ shiftId: s.id, expectedCashUsd: 10, closingCashUsd: 10 })
    await new Promise((r) => setTimeout(r, 30))
    const ops = read("lebanonpos.sync-queue.v1").filter((o: any) => o.entity === "shift")
    expect(ops.map((o: any) => o.action)).toEqual(expect.arrayContaining(["open", "close"]))
    for (const o of ops) expect("deviceName" in o.payload).toBe(false)
    const { saveSettings, getSettings } = await import("../features/pos/services/settings.service")
    saveSettings({ ...getSettings(), storeName: "IT 2" })
    await new Promise((r) => setTimeout(r, 30))
    saveSettings({ ...getSettings(), drawerScope: "shared" }, { drawerScopeChange: true })
    await new Promise((r) => setTimeout(r, 30))
    const set = read("lebanonpos.sync-queue.v1").filter((o: any) => o.entity === "settings").map((o: any) => o.payload).reverse() // the queue is newest first
    expect(["drawerScope" in set[0], set[1]?.drawerScope]).toEqual([false, "shared"])
  })
})

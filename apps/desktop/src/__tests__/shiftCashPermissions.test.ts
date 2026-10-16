import { describe, it, expect, beforeEach, vi } from "vitest"

// Shift / drawer / expense permissions are enforced by the SERVICES, not only
// by disabled buttons: a Cashier cannot close another user's shift, take an
// owner draw, or record an expense, and nothing is written or queued when
// refused. The server enforces the same rules on push (api shift-cash-permissions test).

const { enqueueMock } = vi.hoisted(() => ({ enqueueMock: vi.fn() }))
vi.mock("../features/pos/services/sync.service", () => ({
  enqueueSyncOperation: (op: unknown) => enqueueMock(op),
  // Money/stock writers stage their operation before the record and commit it after it: a staged
  // operation is the same operation the plain enqueue used to receive.
  stageSyncOperation: (op: { id?: string }) => { enqueueMock(op); return { ...op, id: op.id ?? "staged-op" } },
  commitStagedSyncOperation: () => "pending",
  settleStagedSyncOperation: () => "unknown",
  discardStagedSyncOperation: () => {},
  isSyncOperationRecorded: () => true,
  isRecordAcknowledged: () => false,
  assertCanWrite: () => {},
  getDeviceId: () => "DEV-TEST",
  getApiUrl: () => "",
  isSuspensionGracePeriodExpired: () => false,
  nextDocumentReference: (prefix: string, digits: number) => `${prefix}-TEST-${"1".padStart(digits, "0")}`,
  getDeviceTag: () => "TEST",
  getCurrentTenantId: () => null,
  getSyncQueue: () => [],
}))

const USERS_KEY = "lebanonpos.users.v1"
const CURRENT_USER_KEY = "lebanonpos.current-user.v1"
const SHIFTS_KEY = "lebanonpos.shifts.v1"

function seed(current: "mgr" | "cash1" | "cash2") {
  window.localStorage.setItem(USERS_KEY, JSON.stringify([
    { id: "mgr", name: "Rania", role: "Manager", pin: "HASH", code: "MGR", permissions: [], active: true },
    { id: "cash1", name: "Omar", role: "Cashier", pin: "HASH", code: "C1", permissions: [], active: true },
    { id: "cash2", name: "Lea", role: "Cashier", pin: "HASH", code: "C2", permissions: [], active: true },
  ]))
  window.localStorage.setItem(CURRENT_USER_KEY, current)
}
const as = (id: string) => window.localStorage.setItem(CURRENT_USER_KEY, id)
const queued = (entity: string) => enqueueMock.mock.calls.map((c) => c[0] as { entity: string; action: string }).filter((o) => o.entity === entity)
const closeInput = (shiftId: string) => ({ shiftId, expectedCashUsd: 100, closingCashUsd: 100 })

describe("shift, owner draw and expense permissions (service layer)", () => {
  beforeEach(() => { window.localStorage.clear(); enqueueMock.mockClear(); vi.resetModules() })

  it("a Cashier can open a shift and close their own", async () => {
    seed("cash1")
    const { openShift, closeShift, getActiveShift } = await import("../features/pos/services/security.service")
    const shift = openShift(100)!
    expect(shift.openedById).toBe("cash1")
    const closed = closeShift(closeInput(shift.id))
    expect(closed?.status).toBe("Closed")
    expect(getActiveShift()).toBeUndefined()
    expect(queued("shift").map((o) => o.action)).toEqual(["open", "close"])
  })

  it("a Cashier cannot close a shift another user opened: refused, unchanged, nothing queued", async () => {
    seed("cash1")
    const { openShift, closeShift, getActiveShift, PermissionError } = await import("../features/pos/services/security.service")
    const shift = openShift(100)!
    enqueueMock.mockClear()
    as("cash2")
    expect(() => closeShift(closeInput(shift.id))).toThrow(PermissionError)
    expect(getActiveShift()?.id).toBe(shift.id)
    const stored = JSON.parse(window.localStorage.getItem(SHIFTS_KEY) ?? "[]")
    expect(stored[0]).toMatchObject({ id: shift.id, status: "Open" })
    expect(stored[0].closedById).toBeUndefined()
    expect(queued("shift")).toHaveLength(0)
  })

  it("a Manager (shifts.manage) can close a Cashier's shift", async () => {
    seed("cash1")
    const { openShift, closeShift } = await import("../features/pos/services/security.service")
    const shift = openShift(100)!
    as("mgr")
    expect(closeShift(closeInput(shift.id))?.closedById).toBe("mgr")
  })

  it("a Cashier cannot take an owner draw (no cash.manage); a Manager can", async () => {
    seed("cash1")
    const { openShift } = await import("../features/pos/services/security.service")
    const { createCashMovement, getCashMovements } = await import("../features/pos/services/cashMovement.service")
    openShift(100)
    expect(createCashMovement({ type: "OwnerDraw", amountUsd: 20, reason: "Owner draw" })).toBeNull()
    expect(getCashMovements()).toHaveLength(0)
    expect(queued("cash-movement")).toHaveLength(0)
    as("mgr")
    expect(createCashMovement({ type: "OwnerDraw", amountUsd: 20, reason: "Owner draw" })?.amountUsd).toBe(20)
    expect(queued("cash-movement")).toHaveLength(1)
  })

  it("a Cashier cannot record an expense; a Manager (accounting.manage) can", async () => {
    seed("cash1")
    const { openShift, PermissionError } = await import("../features/pos/services/security.service")
    const { createExpense, getExpenses } = await import("../features/pos/services/expense.service")
    openShift(100)
    const input = { vendor: "EDL", category: "Utilities" as const, amount: 12, paymentMethod: "Cash" as const, invoiceNumber: "", note: "" }
    expect(() => createExpense(input)).toThrow(PermissionError)
    expect(getExpenses()).toHaveLength(0)
    expect(queued("expense")).toHaveLength(0)
    as("mgr")
    expect(createExpense(input).amount).toBe(12)
    expect(queued("expense")).toHaveLength(1)
    // The queued record names its recorder, so the server can check that staff member's permission.
    expect((enqueueMock.mock.calls.at(-1)![0] as { payload: { recordedById?: string } }).payload.recordedById).toBe("mgr")
  })

  it("a user with no selling or shift permission cannot open a shift", async () => {
    window.localStorage.setItem(USERS_KEY, JSON.stringify([{ id: "v", name: "Viewer", role: "Cashier", pin: "HASH", code: "V", permissions: ["inventory.view"], active: true }]))
    window.localStorage.setItem(CURRENT_USER_KEY, "v")
    const { openShift, getActiveShift, PermissionError } = await import("../features/pos/services/security.service")
    expect(() => openShift(100)).toThrow(PermissionError)
    expect(getActiveShift()).toBeUndefined()
    expect(queued("shift")).toHaveLength(0)
  })
})

import { describe, it, expect, beforeEach, vi } from "vitest"

// SALES-CHECKOUT-1 — live acceptance for the sale path behind the field report
// "Checkout failed. Cart preserved, try again." on every sell. Exercises the
// REAL sales + shift services (only the sync transport is stubbed), proving:
//   1. a fresh register has NO open shift (production seed is inert), and a sale
//      is correctly blocked with the "No open shift" error, persisting nothing;
//   2. once a shift is open, a sale completes, persists, links to the shift, and
//      computes profit — i.e. selling works as soon as a shift exists.

const { enqueueMock } = vi.hoisted(() => ({ enqueueMock: vi.fn() }))

vi.mock("../features/pos/services/sync.service", () => ({
  enqueueSyncOperation: (op: unknown) => enqueueMock(op),
  assertCanWrite: () => {},
  getDeviceId: () => "DEV-TEST",
  getApiUrl: () => "",
  isSuspensionGracePeriodExpired: () => false,
}))

const USERS_KEY = "lebanonpos.users.v1"
const CURRENT_USER_KEY = "lebanonpos.current-user.v1"
const SALES_KEY = "lebanonpos.sales.v1"

function seedAdmin() {
  window.localStorage.setItem(
    USERS_KEY,
    JSON.stringify([{ id: "u1", name: "Owner", role: "Admin", pin: "HASH", code: "OWN", permissions: [] }])
  )
  window.localStorage.setItem(CURRENT_USER_KEY, "u1")
}

const saleInput = {
  saleNumber: "S-TEST01",
  paymentMethod: "Cash" as const,
  subtotal: 10,
  discountTotal: 0,
  tax: 0,
  total: 10,
  soldAtCost: false,
  items: [{ id: 1, name: "Cola", barcode: "111", cost: 4, quantity: 2, unitPrice: 5, total: 10 }],
}

describe("SALES-CHECKOUT-1 — sale requires an open shift", () => {
  beforeEach(() => {
    window.localStorage.clear()
    enqueueMock.mockClear()
  })

  it("a fresh register has no open shift and blocks the sale (the reported bug)", async () => {
    seedAdmin()
    const { recordSale } = await import("../features/pos/services/sales.service")
    const { getActiveShift } = await import("../features/pos/services/security.service")

    // Production seed is inert (initialUsers === []) → no auto shift.
    expect(getActiveShift()).toBeUndefined()

    // The sale is refused with the exact message the POS now surfaces/guards on…
    expect(() => recordSale(saleInput)).toThrow(/No open shift/i)

    // …and nothing is persisted, so the cart is safe to retry.
    expect(window.localStorage.getItem(SALES_KEY)).toBeNull()
  })

  it("completes and persists the sale once a shift is open", async () => {
    seedAdmin()
    const { openShift, getActiveShift } = await import("../features/pos/services/security.service")
    const { recordSale, getSales } = await import("../features/pos/services/sales.service")

    const shift = openShift(100)
    expect(shift).toBeTruthy()
    expect(getActiveShift()?.id).toBe(shift!.id)

    const sale = recordSale(saleInput)

    expect(sale.status).toBe("Completed")
    expect(sale.shiftId).toBe(shift!.id)
    expect(sale.total).toBe(10)
    expect(sale.profit).toBe(10 - 4 * 2) // subtotal − cost
    expect(sale.cashier).toBe("Owner")

    const persisted = getSales()
    expect(persisted.some((s) => s.saleNumber === "S-TEST01")).toBe(true)

    // The sale was enqueued for cloud sync exactly once.
    const saleOps = enqueueMock.mock.calls.map((c) => c[0] as { entity: string; action: string })
    expect(saleOps.filter((op) => op.entity === "sale" && op.action === "create").length).toBe(1)
  })
})

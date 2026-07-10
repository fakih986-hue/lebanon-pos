import { getShifts, recordBelongsToShift, type Shift } from "./security.service"
import { getSales, getRefunds } from "./sales.service"
import { getExpenses } from "./expense.service"
import { getSupplierPayments } from "./supplier.service"
import { getCashMovements } from "./cashMovement.service"

export type ShiftCashBreakdown = {
  openingFloat: number
  cashSales: number
  cashRefunds: number
  cashExpenses: number
  cashSupplierPayments: number
  cashIn: number
  cashOut: number
  expectedCash: number
}

export type RegisterShiftSummary = {
  shiftId: string
  shiftNumber: string
  status: "Open" | "Closed"
  registerId: string
  deviceId: string
  cashierName: string
  openedAt: string
  closedAt?: string
  openingFloat: number
  expectedCash: number
  countedCash?: number
  difference?: number
  needsReview: boolean
  breakdown: ShiftCashBreakdown
}

export type RegisterCashTotals = {
  openShiftCount: number
  closedShiftCount: number
  needsReviewCount: number
  expectedCash: number
  countedCash: number
  variance: number
  cashSales: number
  cashRefunds: number
  cashExpenses: number
  cashSupplierPayments: number
  ownerDraws: number
  cashIn: number
  cashOut: number
}

function toLocalDateKey(value: string): string {
  const date = new Date(value)
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}

export function computeShiftCashBreakdown(shift: Shift): ShiftCashBreakdown {
  const openingFloat = shift.openingFloatUsd ?? 0

  const cashSales = getSales()
    .filter(s => s.paymentMethod === "Cash" && s.status !== "Voided" && recordBelongsToShift(s, shift))
    .reduce((sum, s) => sum + s.total, 0)

  const cashRefunds = getRefunds()
    .filter(r => r.method === "Cash" && recordBelongsToShift(r, shift))
    .reduce((sum, r) => sum + r.total, 0)

  const cashExpenses = getExpenses()
    .filter(e => e.paymentMethod === "Cash" && recordBelongsToShift(e, shift))
    .reduce((sum, e) => sum + e.amount, 0)

  const cashSupplierPayments = getSupplierPayments()
    .filter(p => p.method === "Cash" && recordBelongsToShift(p, shift))
    .reduce((sum, p) => sum + p.amount, 0)

  const movements = getCashMovements()
    .filter(m => recordBelongsToShift(m, shift))

  const cashIn = movements
    .filter(m => m.direction === "In")
    .reduce((sum, m) => sum + m.amountUsd, 0)

  const cashOut = movements
    .filter(m => m.direction === "Out")
    .reduce((sum, m) => sum + m.amountUsd, 0)

  return {
    openingFloat,
    cashSales,
    cashRefunds,
    cashExpenses,
    cashSupplierPayments,
    cashIn,
    cashOut,
    expectedCash: openingFloat + cashSales - cashRefunds - cashExpenses - cashSupplierPayments + cashIn - cashOut,
  }
}

export function computeExpectedCash(shift: Shift): number {
  return computeShiftCashBreakdown(shift).expectedCash
}

export function getRegisterShiftSummaries(dateKey?: string): RegisterShiftSummary[] {
  return getShifts()
    .filter((shift) => !dateKey || toLocalDateKey(shift.openedAt) === dateKey || (shift.closedAt && toLocalDateKey(shift.closedAt) === dateKey))
    .map((shift) => {
      const breakdown = computeShiftCashBreakdown(shift)
      const countedCash = shift.status === "Closed" ? shift.closingCashUsd ?? 0 : undefined
      const difference = shift.status === "Closed"
        ? shift.differenceUsd ?? ((countedCash ?? 0) - breakdown.expectedCash)
        : undefined
      return {
        shiftId: shift.id,
        shiftNumber: shift.shiftNumber,
        status: shift.status,
        registerId: shift.registerId ?? "REG-001",
        deviceId: shift.deviceId ?? "unknown",
        cashierName: shift.openedByName,
        openedAt: shift.openedAt,
        closedAt: shift.closedAt,
        openingFloat: shift.openingFloatUsd ?? 0,
        expectedCash: breakdown.expectedCash,
        countedCash,
        difference,
        needsReview: shift.status === "Open" || Math.abs(difference ?? 0) >= 0.01,
        breakdown,
      }
    })
}

export function getRegisterCashTotals(dateKey?: string): RegisterCashTotals {
  const summaries = getRegisterShiftSummaries(dateKey)
  const closed = summaries.filter((summary) => summary.status === "Closed")

  return {
    openShiftCount: summaries.filter((summary) => summary.status === "Open").length,
    closedShiftCount: closed.length,
    needsReviewCount: summaries.filter((summary) => summary.needsReview).length,
    expectedCash: closed.reduce((sum, summary) => sum + summary.expectedCash, 0),
    countedCash: closed.reduce((sum, summary) => sum + (summary.countedCash ?? 0), 0),
    variance: closed.reduce((sum, summary) => sum + (summary.difference ?? 0), 0),
    cashSales: summaries.reduce((sum, summary) => sum + summary.breakdown.cashSales, 0),
    cashRefunds: summaries.reduce((sum, summary) => sum + summary.breakdown.cashRefunds, 0),
    cashExpenses: summaries.reduce((sum, summary) => sum + summary.breakdown.cashExpenses, 0),
    cashSupplierPayments: summaries.reduce((sum, summary) => sum + summary.breakdown.cashSupplierPayments, 0),
    ownerDraws: getCashMovements()
      .filter((movement) => movement.type === "OwnerDraw" && (!dateKey || toLocalDateKey(movement.createdAt) === dateKey))
      .reduce((sum, movement) => sum + movement.amountUsd, 0),
    cashIn: summaries.reduce((sum, summary) => sum + summary.breakdown.cashIn, 0),
    cashOut: summaries.reduce((sum, summary) => sum + summary.breakdown.cashOut, 0),
  }
}

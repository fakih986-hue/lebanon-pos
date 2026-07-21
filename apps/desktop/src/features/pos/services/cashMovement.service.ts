import { assertCanWrite, enqueueSyncOperation, getSyncQueue, getDeviceId } from "./sync.service"
import { writeLocalWithIndexedDB } from "./storage.service"
import { canUseStorage, createId } from "../lib/storage"
import { getCurrentUser, getActiveShift, recordAuditEvent, userCan } from "./security.service"
import { getRegisterId } from "./settings.service"

const MOVEMENTS_KEY = "lebanonpos.cash-movements.v1"
const MOVEMENTS_EVENT = "lebanonpos-cash-movements-changed"

export type CashMovementType = "CashIn" | "CashOut" | "SafeDrop" | "DrawerCorrection" | "PettyCash" | "OwnerDraw"
export type CashDirection = "In" | "Out"

export interface CashMovement {
  id: string
  shiftId?: string
  shiftNumber?: string
  registerId?: string
  deviceId?: string
  type: CashMovementType
  direction: CashDirection
  amountUsd: number
  reason: string
  note: string
  referenceEntity?: string
  referenceId?: string
  recordedById?: string
  recordedByName: string
  createdAt: string
}

const TYPE_DIRECTION: Record<CashMovementType, CashDirection> = {
  CashIn: "In",
  CashOut: "Out",
  SafeDrop: "Out",
  PettyCash: "Out",
  DrawerCorrection: "Out", // user must explicitly override direction
  OwnerDraw: "Out",
}

export interface CreateCashMovementInput {
  type: CashMovementType
  amountUsd: number
  reason: string
  note?: string
  referenceEntity?: string
  referenceId?: string
  direction?: CashDirection
}

export function getCashMovements(): CashMovement[] {
  if (!canUseStorage()) return []
  try {
    const raw = localStorage.getItem(MOVEMENTS_KEY)
    return raw ? JSON.parse(raw) : []
  } catch { return [] }
}

export function createCashMovement(input: CreateCashMovementInput): CashMovement | null {
  assertCanWrite("create cash movement")

  // Permission: cash in/out (drawer) — POS-PERMISSIONS-1 split from accounting.
  if (!userCan("cash.manage")) return null

  // Validation
  if (input.amountUsd <= 0) return null
  if (!input.reason.trim()) return null

  const user = getCurrentUser()
  const shift = getActiveShift()

  // Shift gate — cash movements require an open shift
  if (!shift) return null

  const direction = input.direction ?? TYPE_DIRECTION[input.type] ?? "Out"

  const movement: CashMovement = {
    id: createId("cashmv"),
    shiftId: shift.id,
    shiftNumber: shift.shiftNumber,
    registerId: getRegisterId(),
    deviceId: getDeviceId(),
    type: input.type,
    direction,
    amountUsd: input.amountUsd,
    reason: input.reason.trim(),
    note: input.note?.trim() ?? "",
    referenceEntity: input.referenceEntity,
    referenceId: input.referenceId,
    recordedById: user?.id,
    recordedByName: user?.name ?? "Unknown",
    createdAt: new Date().toISOString(),
  }

  const existing = getCashMovements()
  writeLocalWithIndexedDB(MOVEMENTS_KEY, [movement, ...existing])
  window.dispatchEvent(new Event(MOVEMENTS_EVENT))

  recordAuditEvent({
    action: `cash.${input.type.toLowerCase()}`,
    entity: "cash-movement",
    summary: `${direction}$ ${input.amountUsd.toFixed(2)} — ${input.reason}`,
    metadata: { movementId: movement.id, type: input.type, direction, amount: input.amountUsd, shiftId: shift?.id },
  })

  enqueueSyncOperation({
    entity: "cash-movement",
    action: "create",
    summary: `Cash ${direction} $${input.amountUsd.toFixed(2)} — ${input.reason}`,
    payload: movement,
  })

  return movement
}

export function getShiftCashMovements(shiftId: string): CashMovement[] {
  return getCashMovements().filter(m => m.shiftId === shiftId)
}

export function getCashMovementDirectionTotal(shiftId: string, direction: CashDirection): number {
  return getShiftCashMovements(shiftId)
    .filter(m => m.direction === direction)
    .reduce((sum, m) => sum + m.amountUsd, 0)
}

export function subscribeCashMovements(callback: () => void) {
  if (!canUseStorage()) return () => undefined
  window.addEventListener(MOVEMENTS_EVENT, callback)
  return () => window.removeEventListener(MOVEMENTS_EVENT, callback)
}

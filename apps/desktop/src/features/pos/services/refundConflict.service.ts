/**
 * REFUND-INTEGRITY-1 — money conflicts: refunds (and voids) this device issued
 * offline that the server later rejected, typically because another device had
 * already refunded the same items. Policy: docs/REFUND-INTEGRITY.md.
 *
 * Never silently reversed, discarded or hidden. The rejected sync operation is
 * the durable record (protected from "clear stuck"/remove, stashed across store
 * switches) until a manager settles it. Until then the refund keeps counting on
 * this device, because the money really moved; the server's books never had it.
 *
 * Settling makes BOTH books tell the same story, exactly once:
 *
 *  resolution   meaning                                  entries recorded (synced)
 *  ──────────   ──────────────────────────────────────   ─────────────────────────────────────────
 *  loss         money left and is not coming back        cash/card/wallet → Expense (refund method)
 *                                                        debt credit      → the credit is made real
 *                                                                           (Refund Credit payment)
 *  recovered    money left and came back (evidence:      cash back to drawer → CashOut payout +
 *               method + reference required)                                  CashIn recovery (net 0)
 *                                                        cash refund, money back by bank/card/wallet
 *                                                                         → CashOut payout only
 *                                                        card/wallet refund → none (evidence kept)
 *  not_paid     recorded, but the customer never got     none (a debt credit is reversed)
 *               the money
 *
 * In every case the refund stops counting locally once settled, so the money
 * is counted once: by the refund before settlement, by the entries after it.
 *
 * Settlement is journaled (one record per conflict, written first) and every
 * entry has a deterministic id derived from the conflict, checked before it is
 * created: retries, double clicks and a restart mid-settlement never create a
 * second expense, movement or credit. resumeMoneyConflictSettlements() finishes
 * interrupted settlements at startup. If the server rejects a settlement entry,
 * that rejected operation is itself a protected money conflict (see
 * isMoneyConflictOperation) and is shown for retry.
 */
import { createCashMovement, getCashMovements } from "./cashMovement.service"
import { getDebtPayments, recordDebtPayment, removeLocalDebtPayment } from "./customer.service"
import { createExpense, getExpenses, type ExpensePaymentMethod } from "./expense.service"
import {
  getAllRefunds, getRefunds, getSales, markRefundConflictResolved, refundCreditId, type SaleRefund,
} from "./sales.service"
import { getActiveShift, getCurrentUser, recordAuditEvent, userCan } from "./security.service"
import {
  getSyncQueue, isMoneyConflictOperation, isSettlementEntryOperation, removeSettledConflictOperation,
  retrySingleSyncOperation, type SyncOperation,
} from "./sync.service"
import { canUseStorage } from "../lib/storage"

const SETTLEMENTS_KEY = "lebanonpos.money-conflict-settlements.v1"

export type MoneyConflictKind = "refund" | "void" | "settlement_entry"
export type SettlementResolution = "loss" | "recovered" | "not_paid"
export type RecoveryMethod = "Cash" | "Card" | "Bank Transfer" | "Wallet"

export type MoneyConflict = {
  opId: string
  kind: MoneyConflictKind
  saleId: string
  saleNumber: string
  refundId?: string
  refundNumber?: string
  customerId?: string
  /** Money at stake (USD): the refund total, or what the void returned. */
  amount: number
  /** How the money left: Cash, Card, Wallet, Debt_Credit (refund) / Debt (void). */
  method: string
  code: string
  message: string
  rejectedAt: string
  issuedAt?: string
  cashier?: string
  shiftNumber?: string
}

export type SettlementEntries = { expenseId?: string; cashOutId?: string; cashInId?: string; debtCreditId?: string }

export type MoneyConflictSettlement = {
  opId: string
  conflict: MoneyConflict
  resolution: SettlementResolution
  note: string
  recovery?: { method: RecoveryMethod; reference: string }
  status: "settling" | "settled"
  startedAt: string
  settledAt?: string
  settledBy: string
  entries: SettlementEntries
  steps: { money: boolean; refund: boolean; audit: boolean; op: boolean }
}

// ── Deterministic entry ids (derived from the conflict's operation id) ─────
export const settlementIds = (opId: string) => ({
  expense: `settle-loss-${opId}`,
  cashOut: `settle-out-${opId}`,
  cashIn: `settle-in-${opId}`,
  debtCredit: `settle-credit-${opId}`,
})

function parseRejection(error: string | undefined) {
  const text = (error ?? "").trim() || "Rejected by server"
  const match = /^([A-Z][A-Z_]+):\s*(.*)$/.exec(text)
  return match ? { code: match[1], message: match[2] || text } : { code: "REJECTED", message: text }
}

function toConflict(op: SyncOperation): MoneyConflict {
  const { code, message } = parseRejection(op.error)
  const payload = (op.payload ?? {}) as Record<string, any>
  const rejectedAt = op.lastAttemptAt ?? op.createdAt
  if (op.entity === "refund") {
    const refund = payload as Partial<SaleRefund>
    return {
      opId: op.id, kind: "refund",
      saleId: String(refund.saleId ?? ""), saleNumber: String(refund.saleNumber ?? ""),
      refundId: refund.id, refundNumber: refund.refundNumber, customerId: refund.customerId,
      amount: Number(refund.total) || 0, method: String(refund.method ?? "Cash"),
      code, message, rejectedAt, issuedAt: refund.createdAt, cashier: refund.cashier, shiftNumber: refund.shiftNumber,
    }
  }
  if (op.entity === "sale") {
    const saleId = String(payload.id ?? "")
    const sale = getSales().find((candidate) => candidate.id === saleId)
    const refunded = getRefunds().filter((r) => r.saleId === saleId).reduce((sum, r) => sum + r.total, 0)
    return {
      opId: op.id, kind: "void",
      saleId, saleNumber: String(payload.saleNumber ?? sale?.saleNumber ?? ""), customerId: sale?.customerId,
      amount: sale ? Math.max(0, sale.total - refunded) : 0, method: sale?.paymentMethod ?? "Cash",
      code, message, rejectedAt, issuedAt: sale?.createdAt, cashier: sale?.cashier, shiftNumber: sale?.shiftNumber,
    }
  }
  // A rejected settlement entry (expense / cash movement / credit).
  return {
    opId: op.id, kind: "settlement_entry", saleId: "", saleNumber: String(payload.invoiceNumber ?? payload.reference ?? ""),
    amount: Number(payload.amount ?? payload.amountUsd) || 0, method: String(payload.paymentMethod ?? payload.method ?? ""),
    code, message, rejectedAt,
  }
}

function readSettlements(): MoneyConflictSettlement[] {
  if (!canUseStorage()) return []
  try {
    const parsed = JSON.parse(window.localStorage.getItem(SETTLEMENTS_KEY) ?? "[]")
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}
function saveSettlement(settlement: MoneyConflictSettlement) {
  const others = readSettlements().filter((s) => s.opId !== settlement.opId)
  window.localStorage.setItem(SETTLEMENTS_KEY, JSON.stringify([settlement, ...others]))
}

export function getSettledMoneyConflicts(): MoneyConflictSettlement[] {
  return readSettlements().filter((s) => s.status === "settled")
}

/** Open money conflicts on this device, newest first. */
export function getMoneyConflicts(): MoneyConflict[] {
  const settling = new Set(readSettlements().filter((s) => s.status === "settling").map((s) => s.opId))
  return getSyncQueue()
    .filter(isMoneyConflictOperation)
    .filter((op) => !settling.has(op.id))
    .map(toConflict)
    .sort((a, b) => String(b.rejectedAt).localeCompare(String(a.rejectedAt)))
}

/** Settlements interrupted before finishing (shown as "finishing…" and resumed at startup). */
export function getPendingSettlements(): MoneyConflictSettlement[] {
  return readSettlements().filter((s) => s.status === "settling")
}

/** Refund ids the server rejected and nobody has settled yet (for history badges). */
export function getOpenConflictRefundIds(): Set<string> {
  return new Set(getMoneyConflicts().map((c) => c.refundId).filter(Boolean) as string[])
}

/** Local refunds whose server rejection is still open (counted locally, absent on the server). */
export function getOpenConflictRefunds(): SaleRefund[] {
  const ids = getOpenConflictRefundIds()
  return getAllRefunds().filter((refund) => ids.has(refund.id))
}

const isDebtMethod = (method: string) => method === "Debt_Credit" || method === "Debt"

function expenseMethodFor(method: string): ExpensePaymentMethod {
  if (method === "Card") return "Card"
  if (method === "Wallet") return "Wallet"
  return "Cash"
}

/** Which resolutions make sense for a conflict (debt credits cannot be "recovered" as money). */
export function allowedResolutions(conflict: MoneyConflict): SettlementResolution[] {
  return isDebtMethod(conflict.method) ? ["loss", "not_paid"] : ["loss", "recovered", "not_paid"]
}

export type SettleMoneyConflictInput = {
  opId: string
  resolution: SettlementResolution
  note: string
  /** Required for "recovered": how the money came back and its receipt/bank reference. */
  recovery?: { method: RecoveryMethod; reference: string }
}

/** What settling would record, without recording anything (used by the confirm step and tests). */
export function planSettlement(conflict: MoneyConflict, resolution: SettlementResolution, recovery?: { method: RecoveryMethod }) {
  const ids = settlementIds(conflict.opId)
  const entries: SettlementEntries = {}
  if (resolution === "loss") {
    if (isDebtMethod(conflict.method)) entries.debtCreditId = ids.debtCredit
    else entries.expenseId = ids.expense
  } else if (resolution === "recovered" && conflict.method === "Cash") {
    entries.cashOutId = ids.cashOut
    if (recovery?.method === "Cash") entries.cashInId = ids.cashIn
  }
  return entries
}

/** Throws a readable error when the current user/shift cannot complete this settlement. */
function assertCanSettle(conflict: MoneyConflict, input: SettleMoneyConflictInput, entries: SettlementEntries) {
  if (!userCan("accounting.manage")) {
    throw new Error("Only a manager with accounting access can settle a rejected refund.")
  }
  if (input.note.trim().length < 3) throw new Error("Write a short note explaining how this was settled.")
  if (!allowedResolutions(conflict).includes(input.resolution)) {
    throw new Error("That resolution does not apply to a customer-credit refund.")
  }
  if (input.resolution === "recovered") {
    if (!input.recovery?.method) throw new Error("Choose how the money came back.")
    if ((input.recovery.reference ?? "").trim().length < 2) {
      throw new Error("Enter the receipt or bank reference for the money that came back.")
    }
  }
  if ((entries.expenseId || entries.cashOutId || entries.cashInId) && !getActiveShift()) {
    throw new Error("Open a shift first: the settlement is recorded in the current shift.")
  }
  if ((entries.cashOutId || entries.cashInId) && !userCan("cash.manage")) {
    throw new Error("Recording the drawer payout and recovery needs the Cash in/out permission.")
  }
  if (entries.debtCreditId && !conflict.customerId) {
    throw new Error("This refund has no customer to credit.")
  }
}

/** Each step checks for its own entry first, so running it again is harmless. */
function runSettlementSteps(settlement: MoneyConflictSettlement) {
  const { conflict, entries } = settlement
  const label = conflict.refundNumber ?? `void of ${conflict.saleNumber}`
  const reference = conflict.refundNumber ?? conflict.saleNumber

  if (!settlement.steps.money) {
    if (entries.expenseId && !getExpenses().some((e) => e.id === entries.expenseId)) {
      createExpense({
        id: entries.expenseId, vendor: `Refund conflict ${label}`, category: "Other", amount: conflict.amount,
        paymentMethod: expenseMethodFor(conflict.method), invoiceNumber: reference,
        note: `Server rejected ${conflict.kind} (${conflict.code}) for sale ${conflict.saleNumber}. ${settlement.note}`,
      })
    }
    const movements = getCashMovements()
    if (entries.cashOutId && !movements.some((m) => m.id === entries.cashOutId)) {
      const out = createCashMovement({
        id: entries.cashOutId, type: "CashOut", amountUsd: conflict.amount,
        reason: `Refund conflict payout ${label}`, note: settlement.note,
        referenceEntity: "refund-conflict", referenceId: conflict.refundId ?? conflict.saleId,
      })
      if (!out) throw new Error("Could not record the drawer payout (shift or permission).")
    }
    if (entries.cashInId && !getCashMovements().some((m) => m.id === entries.cashInId)) {
      const back = createCashMovement({
        id: entries.cashInId, type: "CashIn", amountUsd: conflict.amount,
        reason: `Refund conflict recovered ${label}`,
        note: `Recovered by ${settlement.recovery?.method}, ref ${settlement.recovery?.reference}. ${settlement.note}`,
        referenceEntity: "refund-conflict", referenceId: conflict.refundId ?? conflict.saleId,
      })
      if (!back) throw new Error("Could not record the money that came back (shift or permission).")
    }
    if (entries.debtCreditId && !getDebtPayments().some((p) => p.id === entries.debtCreditId)) {
      recordDebtPayment({
        id: entries.debtCreditId, customerId: conflict.customerId!, amount: conflict.amount, method: "Refund Credit",
        reference: `Settlement of rejected refund ${label}`,
      })
    }
    // The refund's own local-only credit never reached the server: drop it.
    // ("loss" re-creates it as a real credit above; "not_paid" reverses it.)
    if (conflict.refundId) removeLocalDebtPayment(refundCreditId(conflict.refundId))
    settlement.steps.money = true
    saveSettlement(settlement)
  }

  if (!settlement.steps.refund) {
    if (conflict.kind === "refund" && conflict.refundId) {
      markRefundConflictResolved(conflict.refundId, {
        code: conflict.code, message: conflict.message, resolution: settlement.resolution,
        note: settlement.note, resolvedAt: settlement.startedAt, resolvedBy: settlement.settledBy,
        ...(entries.expenseId ? { expenseId: entries.expenseId } : {}),
      })
    }
    settlement.steps.refund = true
    saveSettlement(settlement)
  }

  if (!settlement.steps.audit) {
    recordAuditEvent({
      action: "sale.refund.conflict_settled",
      entity: "sale",
      summary: `${label} was rejected by the server (${conflict.code}); settled as ${settlement.resolution}.`,
      metadata: {
        opId: conflict.opId, kind: conflict.kind, saleId: conflict.saleId, refundId: conflict.refundId ?? null,
        amount: conflict.amount, method: conflict.method, code: conflict.code, resolution: settlement.resolution,
        recoveryMethod: settlement.recovery?.method ?? null, recoveryReference: settlement.recovery?.reference ?? null,
        note: settlement.note, expenseId: entries.expenseId ?? null, cashOutId: entries.cashOutId ?? null,
        cashInId: entries.cashInId ?? null, debtCreditId: entries.debtCreditId ?? null,
      },
    })
    settlement.steps.audit = true
    saveSettlement(settlement)
  }

  if (!settlement.steps.op) {
    // Only now may the rejected operation leave the queue.
    removeSettledConflictOperation(conflict.opId)
    settlement.steps.op = true
    settlement.status = "settled"
    settlement.settledAt = new Date().toISOString()
    saveSettlement(settlement)
  }
}

export function settleMoneyConflict(input: SettleMoneyConflictInput): MoneyConflictSettlement {
  const existing = readSettlements().find((s) => s.opId === input.opId)
  if (existing?.status === "settled") return existing // retry / double click: nothing new is recorded
  if (existing) {
    runSettlementSteps(existing) // resume an interrupted settlement with its original decision
    return existing
  }

  const op = getSyncQueue().find((candidate) => candidate.id === input.opId)
  if (!op || !isMoneyConflictOperation(op)) throw new Error("This conflict is no longer open.")
  const conflict = toConflict(op)
  if (conflict.kind === "settlement_entry") throw new Error("Retry this settlement entry instead of settling it.")
  const entries = planSettlement(conflict, input.resolution, input.recovery)
  assertCanSettle(conflict, input, entries)

  const settlement: MoneyConflictSettlement = {
    opId: input.opId, conflict, resolution: input.resolution, note: input.note.trim(),
    ...(input.resolution === "recovered" && input.recovery
      ? { recovery: { method: input.recovery.method, reference: input.recovery.reference.trim() } }
      : {}),
    status: "settling", startedAt: new Date().toISOString(), settledBy: getCurrentUser().name,
    entries, steps: { money: false, refund: false, audit: false, op: false },
  }
  saveSettlement(settlement) // journal first: a crash from here on resumes, never re-decides
  runSettlementSteps(settlement)
  return settlement
}

/** Retry a settlement entry the server rejected (it is never re-created, only re-sent). */
export function retrySettlementEntry(opId: string) {
  const op = getSyncQueue().find((candidate) => candidate.id === opId)
  if (op && isSettlementEntryOperation(op)) retrySingleSyncOperation(opId)
}

/** Startup: finish settlements interrupted by a crash or restart. */
export function resumeMoneyConflictSettlements(): number {
  let resumed = 0
  for (const settlement of getPendingSettlements()) {
    try {
      runSettlementSteps(settlement)
      resumed++
    } catch (error) {
      console.error("[money-conflict] could not resume settlement", settlement.opId, error)
    }
  }
  return resumed
}

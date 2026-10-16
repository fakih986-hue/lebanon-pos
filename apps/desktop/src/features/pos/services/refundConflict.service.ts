/**
 * REFUND-INTEGRITY-1 — money conflicts: refunds (and voids) this device
 * issued offline that the server later rejected, typically because another
 * device already refunded the same items.
 *
 * Policy (docs/REFUND-INTEGRITY.md):
 * - The money has already changed hands, so the refund is NEVER silently
 *   reversed, discarded or hidden. Its rejected sync operation stays queued as
 *   the durable record (protected from "clear stuck"/"remove") and the local
 *   refund stays in history.
 * - Until settled it keeps counting locally (the cash really left the drawer)
 *   while the server's books do not include it; the conflict list shows this.
 * - A manager with accounting.manage settles it with a required note:
 *     "loss"      — the money is not coming back: an expense of the same
 *                   amount is recorded (and synced), and the refund stops
 *                   counting, so local and server books agree;
 *     "recovered" — the customer returned the money: the refund stops
 *                   counting; no money entry is needed.
 *   Stock always follows the server (it rejected the restore), via the
 *   normal pull.
 */
import { createExpense, type ExpensePaymentMethod } from "./expense.service"
import { getAllRefunds, getRefunds, getSales, markRefundConflictResolved, type SaleRefund } from "./sales.service"
import { getCurrentUser, recordAuditEvent, userCan } from "./security.service"
import { getSyncQueue, isMoneyConflictOperation, removeSettledConflictOperation, type SyncOperation } from "./sync.service"
import { canUseStorage } from "../lib/storage"

const SETTLEMENTS_KEY = "lebanonpos.money-conflict-settlements.v1"

export type MoneyConflict = {
  opId: string
  kind: "refund" | "void"
  saleId: string
  saleNumber: string
  refundId?: string
  refundNumber?: string
  /** Money at stake (USD): the refund total, or what the void returned. */
  amount: number
  method: string
  code: string
  message: string
  rejectedAt: string
  issuedAt?: string
  cashier?: string
  shiftNumber?: string
}

export type MoneyConflictSettlement = MoneyConflict & {
  resolution: "loss" | "recovered"
  note: string
  settledAt: string
  settledBy: string
  expenseId?: string
}

function parseRejection(error: string | undefined) {
  const text = (error ?? "").trim() || "Rejected by server"
  const match = /^([A-Z][A-Z_]+):\s*(.*)$/.exec(text)
  return match ? { code: match[1], message: match[2] || text } : { code: "REJECTED", message: text }
}

function toConflict(op: SyncOperation): MoneyConflict {
  const { code, message } = parseRejection(op.error)
  const payload = (op.payload ?? {}) as Record<string, any>
  if (op.entity === "refund") {
    const refund = payload as Partial<SaleRefund>
    return {
      opId: op.id, kind: "refund",
      saleId: String(refund.saleId ?? ""), saleNumber: String(refund.saleNumber ?? ""),
      refundId: refund.id, refundNumber: refund.refundNumber,
      amount: Number(refund.total) || 0, method: String(refund.method ?? "Cash"),
      code, message, rejectedAt: op.lastAttemptAt ?? op.createdAt,
      issuedAt: refund.createdAt, cashier: refund.cashier, shiftNumber: refund.shiftNumber,
    }
  }
  const saleId = String(payload.id ?? "")
  const sale = getSales().find((candidate) => candidate.id === saleId)
  const refunded = getRefunds().filter((r) => r.saleId === saleId).reduce((sum, r) => sum + r.total, 0)
  return {
    opId: op.id, kind: "void",
    saleId, saleNumber: String(payload.saleNumber ?? sale?.saleNumber ?? ""),
    amount: sale ? Math.max(0, sale.total - refunded) : 0, method: sale?.paymentMethod ?? "Cash",
    code, message, rejectedAt: op.lastAttemptAt ?? op.createdAt,
    issuedAt: sale?.createdAt, cashier: sale?.cashier, shiftNumber: sale?.shiftNumber,
  }
}

/** Open money conflicts on this device, newest first. */
export function getMoneyConflicts(): MoneyConflict[] {
  return getSyncQueue()
    .filter(isMoneyConflictOperation)
    .map(toConflict)
    .sort((a, b) => String(b.rejectedAt).localeCompare(String(a.rejectedAt)))
}

/** Refund ids the server rejected and nobody has settled yet (for history badges). */
export function getOpenConflictRefundIds(): Set<string> {
  return new Set(getMoneyConflicts().map((c) => c.refundId).filter(Boolean) as string[])
}

export function getSettledMoneyConflicts(): MoneyConflictSettlement[] {
  if (!canUseStorage()) return []
  try {
    const parsed = JSON.parse(window.localStorage.getItem(SETTLEMENTS_KEY) ?? "[]")
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function expenseMethodFor(method: string): ExpensePaymentMethod {
  if (method === "Card") return "Card"
  if (method === "Wallet") return "Wallet"
  if (method === "Debt_Credit" || method === "Debt") return "On Account"
  return "Cash"
}

export type SettleMoneyConflictInput = {
  opId: string
  resolution: "loss" | "recovered"
  note: string
}

export function settleMoneyConflict(input: SettleMoneyConflictInput): MoneyConflictSettlement {
  if (!userCan("accounting.manage")) {
    throw new Error("Only a manager with accounting access can settle a rejected refund.")
  }
  const note = input.note.trim()
  if (note.length < 3) throw new Error("Write a short note explaining how this was settled.")
  const conflict = getMoneyConflicts().find((candidate) => candidate.opId === input.opId)
  if (!conflict) throw new Error("This conflict is no longer open.")

  const user = getCurrentUser()
  let expenseId: string | undefined
  if (input.resolution === "loss" && conflict.amount > 0) {
    // createExpense enforces the license check and the open-shift rule.
    const expense = createExpense({
      vendor: `Refund conflict ${conflict.refundNumber ?? conflict.saleNumber}`,
      category: "Other",
      amount: conflict.amount,
      paymentMethod: expenseMethodFor(conflict.method),
      invoiceNumber: conflict.refundNumber ?? conflict.saleNumber,
      note: `Server rejected ${conflict.kind} (${conflict.code}) for sale ${conflict.saleNumber}. ${note}`,
    })
    expenseId = expense.id
  }

  const settledAt = new Date().toISOString()
  if (conflict.kind === "refund" && conflict.refundId) {
    markRefundConflictResolved(conflict.refundId, {
      code: conflict.code, message: conflict.message, resolution: input.resolution, note,
      resolvedAt: settledAt, resolvedBy: user.name, ...(expenseId ? { expenseId } : {}),
    })
  }

  const settlement: MoneyConflictSettlement = { ...conflict, resolution: input.resolution, note, settledAt, settledBy: user.name, ...(expenseId ? { expenseId } : {}) }
  window.localStorage.setItem(SETTLEMENTS_KEY, JSON.stringify([settlement, ...getSettledMoneyConflicts()]))
  recordAuditEvent({
    action: "sale.refund.conflict_settled",
    entity: "sale",
    summary: `${conflict.kind === "refund" ? conflict.refundNumber : `Void of ${conflict.saleNumber}`} was rejected by the server (${conflict.code}); settled as ${input.resolution === "loss" ? "a loss" : "recovered from the customer"}.`,
    metadata: {
      opId: conflict.opId, kind: conflict.kind, saleId: conflict.saleId, refundId: conflict.refundId,
      amount: conflict.amount, code: conflict.code, resolution: input.resolution, note, expenseId: expenseId ?? null,
    },
  })
  // Only now may the rejected operation leave the queue.
  removeSettledConflictOperation(conflict.opId)
  return settlement
}

/** Local refunds whose server rejection is still open (counted locally, absent on the server). */
export function getOpenConflictRefunds(): SaleRefund[] {
  const ids = getOpenConflictRefundIds()
  return getAllRefunds().filter((refund) => ids.has(refund.id))
}

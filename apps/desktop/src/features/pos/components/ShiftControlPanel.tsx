import { useEffect, useState } from "react"
import { Clock, LockKeyhole, Play } from "lucide-react"
import {
  getActiveShift,
  openShift,
  closeShift,
  subscribeSecurity,
  userCan,
} from "../services/security.service"
import { computeShiftCashBreakdown } from "../services/shift.service"
import { formatCurrency } from "../lib/currency"
import { parseMoney, formatDateTime } from "../lib/helpers"
import { showToast } from "../services/toast.service"
import ConfirmDialog from "../../../components/ConfirmDialog"

/**
 * POS-UX-IA-1B — shift Open/Close in a daily-operations context (Accounting),
 * so Managers (who have `shifts.manage` but not `staff.manage`) can open/close
 * the till without going through the Admin-only Staff page. Gated by
 * `shifts.manage`. Cashiers (no such permission) never see it. Uses the same
 * shift-service functions as the Staff page — one source of truth, no logic change.
 */
export default function ShiftControlPanel() {
  const [, setTick] = useState(0) // bump to re-read localStorage-backed shift state
  const [openingFloat, setOpeningFloat] = useState("250")
  const [closingCash, setClosingCash] = useState("")
  const [notes, setNotes] = useState("")
  const [confirmClose, setConfirmClose] = useState(false)

  useEffect(() => subscribeSecurity(() => setTick((n) => n + 1)), [])

  if (!userCan("shifts.manage")) {
    return (
      <section className="card p-6 text-center text-[13px] font-medium" style={{ color: "var(--text-3)" }}>
        <LockKeyhole size={18} className="mx-auto mb-2" />
        You don't have permission to manage shifts.
      </section>
    )
  }

  const active = getActiveShift()
  const breakdown = active ? computeShiftCashBreakdown(active) : null
  const expected = breakdown?.expectedCash ?? 0
  const difference = active ? parseMoney(closingCash) - expected : 0

  const doOpen = () => {
    const s = openShift(parseMoney(openingFloat))
    if (s) { showToast("Shift opened.", "success"); setTick((n) => n + 1) }
    else showToast("Could not open shift — enter a valid opening float.", "error")
  }

  const doClose = () => {
    if (!active || !breakdown) return
    const closed = closeShift({
      shiftId: active.id,
      expectedCashUsd: expected,
      closingCashUsd: parseMoney(closingCash),
      cashSalesUsd: breakdown.cashSales,
      cashRefundsUsd: breakdown.cashRefunds,
      cashExpensesUsd: breakdown.cashExpenses,
      supplierPaymentsUsd: breakdown.cashSupplierPayments,
      notes: notes.trim() || undefined,
    })
    setConfirmClose(false)
    if (closed) { showToast("Shift closed.", "success"); setClosingCash(""); setNotes(""); setTick((n) => n + 1) }
    else showToast("Could not close shift — enter the counted closing cash.", "error")
  }

  return (
    <section className="card overflow-hidden">
      <div className="flex items-center gap-3 border-b p-4" style={{ borderColor: "var(--border)" }}>
        <div className="flex h-11 w-11 items-center justify-center rounded-lg" style={{ backgroundColor: "var(--brand-soft)", color: "var(--brand-text)" }}>
          <Clock size={21} />
        </div>
        <div>
          <h2 className="text-[16px] font-bold" style={{ color: "var(--text)" }}>Shift</h2>
          <p className="text-[12px]" style={{ color: "var(--text-3)" }}>Open or close the register drawer.</p>
        </div>
      </div>

      {!active ? (
        <div className="p-4">
          <p className="mb-3 text-[13px]" style={{ color: "var(--text-2)" }}>No shift is open. Open one to start the day.</p>
          <label className="block text-[12px] font-semibold" style={{ color: "var(--text-3)" }}>Opening float (USD)</label>
          <input
            inputMode="decimal"
            value={openingFloat}
            onChange={(e) => setOpeningFloat(e.target.value)}
            className="mt-1 w-full rounded-lg border px-3 py-2 text-[14px]"
            style={{ borderColor: "var(--border)", background: "var(--bg)", color: "var(--text)" }}
          />
          <button onClick={doOpen} className="btn-primary btn-md mt-4 w-full">
            <Play size={16} /> Open shift
          </button>
        </div>
      ) : (
        <div className="p-4">
          <div className="rounded-lg border p-3" style={{ borderColor: "var(--border)", background: "var(--surface-2, var(--bg))" }}>
            <div className="flex items-center justify-between text-[13px]">
              <span className="font-bold" style={{ color: "var(--text)" }}>{active.shiftNumber}</span>
              <span style={{ color: "var(--text-3)" }}>Opened {formatDateTime(active.openedAt)}</span>
            </div>
            <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-[12px]" style={{ color: "var(--text-2)" }}>
              <span>Opening float</span><span className="text-end tabular-nums">{formatCurrency(breakdown!.openingFloat)}</span>
              <span>Cash sales</span><span className="text-end tabular-nums">{formatCurrency(breakdown!.cashSales)}</span>
              <span>Cash refunds</span><span className="text-end tabular-nums">−{formatCurrency(breakdown!.cashRefunds)}</span>
              <span>Cash expenses</span><span className="text-end tabular-nums">−{formatCurrency(breakdown!.cashExpenses)}</span>
              <span>Supplier payments</span><span className="text-end tabular-nums">−{formatCurrency(breakdown!.cashSupplierPayments)}</span>
              <span className="font-bold" style={{ color: "var(--text)" }}>Expected in drawer</span>
              <span className="text-end font-bold tabular-nums" style={{ color: "var(--text)" }}>{formatCurrency(expected)}</span>
            </div>
          </div>

          <label className="mt-4 block text-[12px] font-semibold" style={{ color: "var(--text-3)" }}>Counted closing cash (USD)</label>
          <input
            inputMode="decimal"
            value={closingCash}
            onChange={(e) => setClosingCash(e.target.value)}
            placeholder="0.00"
            className="mt-1 w-full rounded-lg border px-3 py-2 text-[14px]"
            style={{ borderColor: "var(--border)", background: "var(--bg)", color: "var(--text)" }}
          />
          {closingCash.trim() ? (
            <p className="mt-1 text-[12px] font-semibold" style={{ color: Math.abs(difference) < 0.001 ? "var(--success-text, var(--text-3))" : "var(--danger-text)" }}>
              {difference === 0 ? "Balanced" : `${difference > 0 ? "Over" : "Short"} ${formatCurrency(Math.abs(difference))}`}
            </p>
          ) : null}

          <label className="mt-3 block text-[12px] font-semibold" style={{ color: "var(--text-3)" }}>Notes (optional)</label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            className="mt-1 w-full rounded-lg border px-3 py-2 text-[13px]"
            style={{ borderColor: "var(--border)", background: "var(--bg)", color: "var(--text)" }}
          />

          <button onClick={() => setConfirmClose(true)} disabled={!closingCash.trim()} className="btn-primary btn-md mt-4 w-full">
            Close shift
          </button>
        </div>
      )}

      <ConfirmDialog
        open={confirmClose}
        title="Close shift?"
        confirmLabel="Close shift"
        confirmDestructive
        onConfirm={doClose}
        onCancel={() => setConfirmClose(false)}
      >
        {active ? `Close ${active.shiftNumber}? Expected ${formatCurrency(expected)}, counted ${formatCurrency(parseMoney(closingCash))} (${difference === 0 ? "balanced" : `${difference > 0 ? "over" : "short"} ${formatCurrency(Math.abs(difference))}`}).` : ""}
      </ConfirmDialog>
    </section>
  )
}

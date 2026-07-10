import { useEffect, useState } from "react"
import { ChevronDown, CircleDollarSign, Clock, HandCoins, Landmark, Lock } from "lucide-react"
import { getActiveShift, getShifts, openShift, closeShift, subscribeSecurity, type Shift } from "../services/security.service"
import { formatCurrency, formatLbpCurrency, usdToLbp } from "../lib/currency"
import { getSettings } from "../services/settings.service"
import { showToast } from "../services/toast.service"
import { subscribeSales, subscribeRefunds } from "../services/sales.service"
import { subscribeExpenses } from "../services/expense.service"
import { subscribeSuppliers } from "../services/supplier.service"
import { createCashMovement, subscribeCashMovements } from "../services/cashMovement.service"
import { computeExpectedCash } from "../services/shift.service"

export default function CashDrawerPanel({ expanded, onToggle }: { expanded: boolean; onToggle: () => void }) {
  const [shift, setShift] = useState<Shift | undefined>(getActiveShift())
  const [floatInput, setFloatInput] = useState("")
  const [countedCash, setCountedCash] = useState("")
  const [note, setNote] = useState("")
  const [showHistory, setShowHistory] = useState(false)
  const [drawerNote, setDrawerNote] = useState("")
  const [renderTick, setRenderTick] = useState(0)
  const rate = getSettings().usdToLbpRate

  useEffect(() => {
    const unsubSecurity = subscribeSecurity(() => setShift(getActiveShift()))
    const unsubSales = subscribeSales(() => setRenderTick(t => t + 1))
    const unsubRefunds = subscribeRefunds(() => setRenderTick(t => t + 1))
    const unsubExpenses = subscribeExpenses(() => setRenderTick(t => t + 1))
    const unsubSuppliers = subscribeSuppliers(() => setRenderTick(t => t + 1))
    const unsubMovements = subscribeCashMovements(() => setRenderTick(t => t + 1))
    return () => { unsubSecurity(); unsubSales(); unsubRefunds(); unsubExpenses(); unsubSuppliers(); unsubMovements() }
  }, [])

  const expectedCash = shift ? computeExpectedCash(shift) : 0
  const countedVal = parseFloat(countedCash)
  const diff = countedCash && !isNaN(countedVal) ? countedVal - expectedCash : 0

  const recentClosed = getShifts()
    .filter((s) => s.status === "Closed")
    .sort((a, b) => new Date(b.closedAt ?? b.openedAt).getTime() - new Date(a.closedAt ?? a.openedAt).getTime())
    .slice(0, 5)

  function handleOpenShift() {
    const f = parseFloat(floatInput)
    if (!f || f <= 0) { showToast("Enter a valid float amount", "error"); return }
    const s = openShift(f)
    if (!s) return
    setShift(s)
    setFloatInput("")
    showToast(`${s.shiftNumber} opened with $${f.toFixed(2)}`)
  }

  function handleCloseShift() {
    if (!shift) return
    closeShift({
      shiftId: shift.id,
      expectedCashUsd: expectedCash,
      closingCashUsd: isNaN(countedVal) ? expectedCash : countedVal,
      notes: note || undefined,
    })
    setShift(undefined)
    setCountedCash("")
    setNote("")
    showToast("Shift closed")
  }

  function handleOwnerDraw() {
    if (!shift) return
    const amount = parseFloat(drawerNote)
    if (!amount || amount <= 0) { showToast("Enter a valid amount", "error"); return }
    const result = createCashMovement({
      type: "OwnerDraw",
      amountUsd: amount,
      reason: "Owner draw",
      note: drawerNote,
    })
    if (result) {
      setDrawerNote("")
      showToast(`Owner draw $${amount.toFixed(2)} recorded`)
    }
  }

  return (
    <div>
      <button type="button" onClick={onToggle} className="flex w-full items-center justify-between px-4 py-2.5 text-[12px] font-bold hover:opacity-80"
        style={{ color: "var(--text-2)", background: expanded ? "var(--surface-2)" : "transparent" }}>
        <span className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full shrink-0" style={{ background: shift ? "var(--success)" : "var(--rose)" }} />
          <Landmark size={14} style={{ color: shift ? "var(--success)" : "var(--text-3)" }} />
          Cash Drawer
          {shift && <span className="text-[10px] opacity-50">{shift.shiftNumber}</span>}
          {shift?.registerId && <span className="text-[10px] opacity-40">({shift.registerId})</span>}
        </span>
        <ChevronDown size={14} className={`transition ${expanded ? "rotate-180" : ""}`} style={{ color: "var(--text-3)" }} />
      </button>

      {expanded && (
        <div className="px-4 pb-3 space-y-2">
          {!shift ? (
            <div className="space-y-2">
              <label className="block text-[11px] font-bold" style={{ color: "var(--text-3)" }}>Opening Float (USD)</label>
              <div className="flex gap-2">
                <input type="number" min="0" step="0.01" value={floatInput}
                  onChange={(e) => setFloatInput(e.target.value)}
                  placeholder="e.g. 250"
                  className="input flex-1" style={{ height: 36, fontSize: 14, fontWeight: 700 }} />
                <button onClick={handleOpenShift}
                  className="flex items-center gap-1 rounded-lg px-3 text-[12px] font-bold text-white" style={{ background: "var(--brand)" }}>
                  <Lock size={13} /> Open
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-1.5">
              <div className="flex justify-between text-[11px]" style={{ color: "var(--text-3)" }}>
                <span>Expected in drawer</span>
                <span className="font-bold tabular-nums">{formatCurrency(expectedCash)}</span>
              </div>
              <div className="flex justify-between text-[10px]" style={{ color: "var(--text-3)" }}>
                <span />
                <span className="tabular-nums">{formatLbpCurrency(usdToLbp(expectedCash, rate))}</span>
              </div>
              <div className="flex gap-2 mt-1">
                <input type="number" min="0" step="0.01" value={countedCash}
                  onChange={(e) => setCountedCash(e.target.value)}
                  placeholder={`${expectedCash.toFixed(2)}`}
                  className="input flex-1" style={{ height: 34, fontSize: 13, fontWeight: 600 }} />
                <span className="px-2 text-[11px] font-bold rounded tabular-nums"
                  style={{
                    lineHeight: "34px",
                    ...(countedCash
                      ? diff >= 0
                        ? { color: "var(--success-text)", background: "var(--success-soft)" }
                        : { color: "var(--danger-text)", background: "var(--danger-soft)" }
                      : {}),
                  }}>
                  {countedCash ? (diff > 0 ? `+${formatCurrency(diff)}` : formatCurrency(diff)) : ""}
                </span>
              </div>
              <div className="flex gap-2">
                <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional)"
                  className="input flex-1" style={{ height: 30, fontSize: 11 }} />
                <button onClick={handleCloseShift}
                  className="flex items-center gap-1 rounded-lg px-3 text-[12px] font-bold text-white" style={{ background: "var(--ink)" }}>
                  <CircleDollarSign size={13} /> Close
                </button>
              </div>

              {/* Owner Draw */}
              <div className="flex gap-2 pt-1">
                <input value={drawerNote} onChange={(e) => setDrawerNote(e.target.value)} placeholder="Owner draw amount"
                  type="number" min="0" step="0.01"
                  className="input flex-1" style={{ height: 30, fontSize: 11 }} />
                <button onClick={handleOwnerDraw}
                  className="flex items-center gap-1 rounded-lg px-3 text-[12px] font-bold text-white" style={{ background: "var(--amber)" }}>
                  <HandCoins size={13} /> Draw
                </button>
              </div>
            </div>
          )}

          {/* Shift history */}
          {recentClosed.length > 0 && (
            <div>
              <button
                type="button"
                onClick={() => setShowHistory((v) => !v)}
                className="flex items-center gap-1 text-[10px] font-bold hover:opacity-70"
                style={{ color: "var(--text-3)" }}
              >
                <Clock size={10} />
                History
                <ChevronDown size={10} className={`transition ${showHistory ? "rotate-180" : ""}`} />
              </button>
              {showHistory && (
                <div className="mt-1.5 space-y-1">
                  {recentClosed.map((s) => {
                    const variance = (s.differenceUsd ?? 0)
                    return (
                      <div key={s.id} className="flex items-center justify-between rounded-lg px-2 py-1.5 text-[10px]"
                        style={{ background: "var(--surface-3)" }}>
                        <div>
                          <span className="font-bold" style={{ color: "var(--text-2)" }}>{s.shiftNumber}</span>
                          <span className="ms-1.5 opacity-50" style={{ color: "var(--text-3)" }}>
                            {new Date(s.closedAt ?? s.openedAt).toLocaleDateString()}
                          </span>
                        </div>
                        <div className="text-end">
                          <span className="tabular-nums" style={{ color: "var(--text-2)" }}>
                            {formatCurrency(s.closingCashUsd ?? 0)}
                          </span>
                          {variance !== 0 && (
                            <span className="ms-1.5 font-bold tabular-nums" style={{ color: variance > 0 ? "var(--success)" : "var(--danger)" }}>
                              {variance > 0 ? "+" : ""}{formatCurrency(variance)}
                            </span>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

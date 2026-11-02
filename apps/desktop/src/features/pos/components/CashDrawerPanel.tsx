import { useEffect, useState } from "react"
import { ChevronDown, CircleDollarSign, Clock, HandCoins, Landmark, Lock, ShieldCheck } from "lucide-react"
import { canCloseShift, canOpenShift, getActiveShift, getShifts, openShift, closeShift, subscribeSecurity, userCan, type Shift } from "../services/security.service"
import { formatCurrency, formatLbpCurrency, usdToLbp } from "../lib/currency"
import { getSettings } from "../services/settings.service"
import { showToast } from "../services/toast.service"
import { subscribeSales, subscribeRefunds } from "../services/sales.service"
import { subscribeExpenses } from "../services/expense.service"
import { subscribeSuppliers } from "../services/supplier.service"
import { cashMovementApprovalPayload, createCashMovement, subscribeCashMovements, type CreateCashMovementInput } from "../services/cashMovement.service"
import ManagerApprovalDialog from "../../../components/ManagerApprovalDialog"
import type { ApprovalRequest } from "../services/approval.service"
import { createId } from "../lib/storage"
import { computeExpectedCash } from "../services/shift.service"
import { useI18n } from "@lebanonpos/shared"

export default function CashDrawerPanel({ expanded, onToggle }: { expanded: boolean; onToggle: () => void }) {
  const { t } = useI18n()
  const [shift, setShift] = useState<Shift | undefined>(getActiveShift())
  const [floatInput, setFloatInput] = useState("")
  const [countedCash, setCountedCash] = useState("")
  const [note, setNote] = useState("")
  const [showHistory, setShowHistory] = useState(false)
  const [drawerNote, setDrawerNote] = useState("")
  // SPRINT-2 E: a payout by someone without cash.manage, waiting for a manager's approval
  const [approval, setApproval] = useState<{ request: Omit<ApprovalRequest, "pin" | "approverId">; input: CreateCashMovementInput & { id: string } } | null>(null)
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
  // Permission rules (DESIGN-SYSTEM §6: visible, disabled with the reason).
  const canOpen = canOpenShift()
  const canClose = canCloseShift(shift)
  const canDraw = userCan("cash.manage")
  const countedVal = parseFloat(countedCash)
  // the drawer is closed only on an entered count: blank is "not counted", 0 is a count of nothing
  const counted = countedCash.trim() !== "" && Number.isFinite(countedVal) && countedVal >= 0
  const diff = counted ? countedVal - expectedCash : 0

  const recentClosed = getShifts()
    .filter((s) => s.status === "Closed")
    .sort((a, b) => new Date(b.closedAt ?? b.openedAt).getTime() - new Date(a.closedAt ?? a.openedAt).getTime())
    .slice(0, 5)

  function handleOpenShift() {
    const f = parseFloat(floatInput)
    if (!f || f <= 0) { showToast(t("pos.drawer.invalid_float"), "error"); return }
    let s: Shift | null | undefined
    try { s = openShift(f) } catch (err) { showToast(t("pos.drawer.action_failed", { reason: String((err as Error)?.message ?? err) }), "error"); return }
    if (!s) return
    setShift(s)
    setFloatInput("")
    showToast(t("pos.drawer.opened", { shift: s.shiftNumber, amount: formatCurrency(f) }))
  }

  function handleCloseShift() {
    if (!shift || !canClose) return
    if (!counted) { showToast(t("pos.drawer.count_required"), "error"); return }
    let closed: ReturnType<typeof closeShift>
    try { closed = closeShift({
      shiftId: shift.id,
      expectedCashUsd: expectedCash,
      closingCashUsd: countedVal,
      notes: note || undefined,
    }) } catch (err) { showToast(t("pos.drawer.action_failed", { reason: String((err as Error)?.message ?? err) }), "error"); return }
    if (!closed) { showToast(t("pos.drawer.count_required"), "error"); return }
    setShift(undefined)
    setCountedCash("")
    setNote("")
    showToast(t("pos.drawer.closed"))
  }

  function handleOwnerDraw() {
    if (!shift) return
    const amount = parseFloat(drawerNote)
    if (!amount || amount <= 0) { showToast(t("pos.drawer.invalid_amount"), "error"); return }
    const input = { id: createId("cashmv"), type: "OwnerDraw" as const, amountUsd: amount, reason: "Owner draw", note: drawerNote }
    if (!canDraw) {
      // a manager approves this payout (this record and amount); the amount stays typed if cancelled
      // the exact movement that will be recorded (shift, person, amount, reason, note)
      const payload = cashMovementApprovalPayload(input)
      if (!payload) { showToast(t("pos.drawer.action_failed", { reason: "no open shift" }), "error"); return }
      setApproval({ input, request: { entity: "cash-movement", action: "create", payload: payload as unknown as Record<string, unknown> & { id: string }, permission: "cash.manage" } })
      return
    }
    recordDraw(input)
  }
  function recordDraw(input: CreateCashMovementInput & { id: string }, approvedBy?: string) {
    let result
    try { result = createCashMovement(input) } catch (err) { showToast(t("pos.drawer.action_failed", { reason: String((err as Error)?.message ?? err).replace(/^APPROVAL_CHANGED: /, "") }), "error"); return }
    if (result) {
      setDrawerNote("")
      showToast(`${approvedBy ? `${t("approval.granted", { name: approvedBy })} ` : ""}${t("pos.drawer.draw_recorded", { amount: formatCurrency(input.amountUsd) })}`)
    }
  }

  return (
    <div>
      <button type="button" onClick={onToggle} aria-expanded={expanded} className="flex w-full items-center justify-between px-4 text-[14px] font-semibold hover:opacity-80"
        style={{ minHeight: 48, color: "var(--text-2)", background: expanded ? "var(--surface-2)" : "transparent" }}>
        <span className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full shrink-0" style={{ background: shift ? "var(--success)" : "var(--rose)" }} />
          <Landmark size={14} style={{ color: shift ? "var(--success)" : "var(--text-3)" }} />
          {t("pos.drawer.title")}
          {shift && <span className="text-[10px] opacity-50">{shift.shiftNumber}</span>}
          {shift?.registerId && <span className="text-[10px] opacity-40">({shift.registerId})</span>}
        </span>
        <ChevronDown size={14} className={`transition ${expanded ? "rotate-180" : ""}`} style={{ color: "var(--text-3)" }} />
      </button>

      {expanded && (
        <div className="px-4 pb-3 space-y-2">
          {!shift ? (
            <div className="space-y-2">
              <label className="block text-[11px] font-bold" style={{ color: "var(--text-3)" }}>{t("pos.drawer.opening_float")}</label>
              <div className="flex gap-2">
                <input type="number" min="0" step="0.01" value={floatInput}
                  onChange={(e) => setFloatInput(e.target.value)}
                  placeholder={t("pos.drawer.float_example")}
                  aria-label={t("pos.drawer.opening_float")}
                  className="input flex-1" style={{ minHeight: 44, fontSize: 16, fontWeight: 600 }} />
                <button type="button" onClick={handleOpenShift} disabled={!canOpen} aria-describedby={canOpen ? undefined : "drawer-open-why"}
                  className="mg2-btn mg2-btn-primary" style={{ minHeight: 44 }}>
                  <Lock size={13} /> {t("pos.drawer.open")}
                </button>
              </div>
              {!canOpen && <p id="drawer-open-why" className="text-[14px]" style={{ margin: 0, color: "var(--text-2)" }}>{t("pos.drawer.need_checkout")}</p>}
            </div>
          ) : (
            <div className="space-y-1.5">
              <div className="flex justify-between text-[11px]" style={{ color: "var(--text-3)" }}>
                <span>{t("pos.drawer.expected")}</span>
                <span className="font-bold tabular-nums">{formatCurrency(expectedCash)}</span>
              </div>
              <div className="flex justify-between text-[10px]" style={{ color: "var(--text-3)" }}>
                <span />
                <span className="tabular-nums">{formatLbpCurrency(usdToLbp(expectedCash, rate))}</span>
              </div>
              <div className="flex gap-2 mt-1">
                <input type="number" min="0" step="0.01" value={countedCash}
                  onChange={(e) => setCountedCash(e.target.value)}
                  placeholder={t("pos.drawer.count_placeholder")}
                  aria-label={t("pos.drawer.counted")} aria-describedby={canClose && !counted ? "drawer-count-why" : undefined}
                  className="input flex-1" style={{ minHeight: 44, fontSize: 14, fontWeight: 600 }} />
                <span className="px-2 text-[11px] font-bold rounded tabular-nums"
                  style={{
                    lineHeight: "34px",
                    ...(counted
                      ? diff >= 0
                        ? { color: "var(--success-text)", background: "var(--success-soft)" }
                        : { color: "var(--danger-text)", background: "var(--danger-soft)" }
                      : {}),
                  }}>
                  {counted ? (diff > 0 ? `+${formatCurrency(diff)}` : formatCurrency(diff)) : ""}
                </span>
              </div>
              <div className="flex gap-2">
                <input value={note} onChange={(e) => setNote(e.target.value)} placeholder={t("pos.drawer.note")} aria-label={t("pos.drawer.note")}
                  className="input flex-1" style={{ minHeight: 44, fontSize: 14 }} />
                <button type="button" onClick={handleCloseShift} disabled={!canClose || !counted} aria-describedby={!canClose ? "drawer-close-why" : !counted ? "drawer-count-why" : undefined}
                  className="mg2-btn" style={{ minHeight: 44 }}>
                  <CircleDollarSign size={13} /> {t("pos.drawer.close")}
                </button>
              </div>

              {!canClose && <p id="drawer-close-why" className="text-[14px]" style={{ margin: 0, color: "var(--text-2)" }}>{t("pos.drawer.need_shift_manage")}</p>}
              {canClose && !counted && <p id="drawer-count-why" className="text-[14px]" style={{ margin: 0, color: "var(--text-2)" }}>{t("pos.drawer.count_required")}</p>}

              {/* Owner Draw */}
              {!canDraw && <p className="text-[14px] pt-1" style={{ margin: 0, color: "var(--text-2)", display: "flex", gap: 6, alignItems: "center" }}><ShieldCheck size={14} aria-hidden="true" />{t("approval.needed")}</p>}
              {<div className="flex gap-2 pt-1">
                <input value={drawerNote} onChange={(e) => setDrawerNote(e.target.value)} placeholder={t("pos.drawer.owner_draw")} aria-label={t("pos.drawer.owner_draw")}
                  type="number" min="0" step="0.01"
                  className="input flex-1" style={{ minHeight: 44, fontSize: 14 }} />
                <button type="button" onClick={handleOwnerDraw} className="mg2-btn" style={{ minHeight: 44 }}>
                  {canDraw ? <HandCoins size={13} /> : <ShieldCheck size={13} aria-hidden="true" />} {canDraw ? t("pos.drawer.draw") : t("approval.ask")}
                </button>
              </div>}
              <ManagerApprovalDialog open={!!approval} request={approval?.request ?? null}
                summary={<p style={{ fontWeight: 600, color: "var(--text)" }}>{approval ? t("approval.payout_summary", { amount: formatCurrency(approval.input.amountUsd), reason: approval.input.reason }) : ""}</p>}
                onApproved={(grant) => { const a = approval; setApproval(null); if (a) recordDraw(a.input, grant.approverName) }}
                onCancel={() => setApproval(null)} />
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
                {t("pos.drawer.history")}
                <ChevronDown size={10} className={`transition ${showHistory ? "rotate-180" : ""}`} />
              </button>
              {showHistory && (
                <div className="mt-1.5 space-y-1">
                  {recentClosed.map((s) => {
                    // a shift closed without a recorded count shows "not counted", never a counted 0
                    const uncounted = typeof s.closingCashUsd !== "number"
                    const variance = uncounted ? 0 : (s.differenceUsd ?? 0)
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
                            {uncounted ? t("pos.drawer.not_counted") : formatCurrency(s.closingCashUsd ?? 0)}
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

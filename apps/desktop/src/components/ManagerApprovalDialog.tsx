import { useEffect, useId, useRef, useState, type ReactNode } from "react"
import { ShieldCheck, X } from "lucide-react"
import { useI18n } from "@lebanonpos/shared"
import { requestManagerApproval, type ApprovalFailure, type ApprovalRequest } from "../features/pos/services/approval.service"
import type { ApprovalGrant } from "../features/pos/lib/approvalGrants"

/**
 * SPRINT-2 E: a manager approves one action on this register with their PIN, checked by the server
 * (approval.service). The person signed in stays signed in; cancelling changes nothing. Keyboard: the
 * PIN field has focus, Enter approves, Escape cancels; focus goes back where it was (the scanner field)
 * when the dialog closes. Touch: an on-screen keypad. One request at a time: repeated taps on Approve
 * while the server answers do nothing.
 */
type Props = {
  open: boolean
  /** What is being approved, as the person at the register sees it (amounts, lines). */
  summary: ReactNode
  request: Omit<ApprovalRequest, "pin" | "approverId"> | null
  onApproved: (grant: ApprovalGrant) => void
  onCancel: () => void
  /** After this long without an answer the dialog says it is still waiting (default 5 s). */
  slowMs?: number
}

const SLOW_MS = 5000

export default function ManagerApprovalDialog({ open, summary, request, onApproved, onCancel, slowMs = SLOW_MS }: Props) {
  const titleId = useId()
  const { t } = useI18n()
  const [pin, setPin] = useState("")
  const [busy, setBusy] = useState(false)
  const [slow, setSlow] = useState(false)
  const [error, setError] = useState<ApprovalFailure | null>(null)
  const [candidates, setCandidates] = useState<Array<{ id: string; name: string }> | null>(null)
  const pinRef = useRef<HTMLInputElement>(null)
  const returnFocus = useRef<Element | null>(null)
  const inFlight = useRef<AbortController | null>(null)

  useEffect(() => {
    if (!open) return
    returnFocus.current = document.activeElement
    setPin(""); setBusy(false); setSlow(false); setError(null); setCandidates(null)
    const id = window.setTimeout(() => pinRef.current?.focus(), 0)
    return () => {
      window.clearTimeout(id)
      inFlight.current?.abort()
      inFlight.current = null
      const back = returnFocus.current as HTMLElement | null
      if (back && typeof back.focus === "function") window.setTimeout(() => back.focus(), 0)
    }
  }, [open])

  async function submit(approverId?: string) {
    if (!request || busy || !pin) return
    const controller = new AbortController()
    inFlight.current = controller
    setBusy(true); setError(null)
    const slowTimer = window.setTimeout(() => setSlow(true), slowMs)
    try {
      const result = await requestManagerApproval({ ...request, pin, ...(approverId ? { approverId } : {}) }, { signal: controller.signal })
      if (controller.signal.aborted) return // cancelled while waiting: nothing is used
      if (result.ok) { setPin(""); onApproved(result.grant); return }
      setPin("")
      if (result.code === "AMBIGUOUS_PIN" && result.candidates?.length) { setCandidates(result.candidates); setError(null); setPin(pin); return }
      setError(result)
      setCandidates(null)
      window.setTimeout(() => pinRef.current?.focus(), 0)
    } finally {
      window.clearTimeout(slowTimer)
      setSlow(false)
      setBusy(false)
      if (inFlight.current === controller) inFlight.current = null
    }
  }

  function cancel() {
    inFlight.current?.abort()
    onCancel()
  }

  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") { e.preventDefault(); cancel() } }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  })

  const press = (d: string) => { if (busy) return; setError(null); setPin((p) => (d === "back" ? p.slice(0, -1) : (p + d).slice(0, 12))); pinRef.current?.focus() }
  const errorText = (e: ApprovalFailure) => {
    const key = `approval.err.${e.code}`
    const text = t(key, { remaining: e.remaining ?? 0 })
    return text === key ? e.message : text
  }

  return (
    <div className={`fixed inset-0 z-[320] flex items-center justify-center p-4 ${open ? "" : "pointer-events-none"}`}>
      <div className={`fixed inset-0 transition-opacity duration-200 ${open ? "opacity-100" : "opacity-0"}`} style={{ background: "rgba(0,0,0,0.5)", backdropFilter: "blur(4px)" }} onClick={cancel} />
      {open && (
        <div
          className="relative w-full max-w-sm rounded-2xl border animate-scale-in"
          style={{ background: "var(--surface)", borderColor: "var(--border)", boxShadow: "var(--shadow-xl)" }}
          onClick={(e) => e.stopPropagation()}
          role="dialog" aria-modal="true" aria-labelledby={titleId} aria-busy={busy || undefined}
        >
          <div className="flex items-center justify-between border-b px-5 py-4" style={{ borderColor: "var(--border)" }}>
            <h2 id={titleId} className="flex items-center gap-2 text-[15px] font-bold" style={{ color: "var(--text)" }}>
              <ShieldCheck size={17} style={{ color: "var(--brand)" }} aria-hidden="true" />{t("approval.title")}
            </h2>
            <button type="button" onClick={cancel} className="btn btn-ghost btn-icon h-8 w-8 rounded-lg" aria-label={t("pos.cancel")}><X size={16} /></button>
          </div>

          <form className="space-y-3 px-5 py-4 text-[13px]" style={{ color: "var(--text-2)" }} onSubmit={(e) => { e.preventDefault(); void submit() }}>
            <div>{summary}</div>
            <p className="text-[12px]" style={{ color: "var(--text-3)" }}>{t("approval.explain")}</p>
            {candidates ? (
              <div role="group" aria-label={t("approval.choose")}>
                <p className="mb-2 font-semibold" style={{ color: "var(--text)" }}>{t("approval.choose")}</p>
                <div className="flex flex-wrap gap-2">
                  {candidates.map((c) => <button key={c.id} type="button" className="btn btn-default btn-md" disabled={busy} onClick={() => void submit(c.id)}>{c.name}</button>)}
                </div>
              </div>
            ) : (
              <>
                <label className="block">
                  <span className="mb-1 block font-semibold" style={{ color: "var(--text)" }}>{t("approval.pin")}</span>
                  <input
                    ref={pinRef} type="password" inputMode="numeric" autoComplete="off" dir="ltr" maxLength={12}
                    className="input w-full text-center text-[18px] tracking-[0.4em]" value={pin} disabled={busy}
                    onChange={(e) => { setError(null); setPin(e.target.value.replace(/\D/g, "").slice(0, 12)) }}
                    aria-invalid={error ? true : undefined} aria-describedby={error ? `${titleId}-err` : undefined}
                  />
                </label>
                <div className="grid grid-cols-3 gap-2" dir="ltr">
                  {["1", "2", "3", "4", "5", "6", "7", "8", "9", "back", "0"].map((d) => (
                    <button key={d} type="button" tabIndex={-1} className="btn btn-default h-12 text-[16px] font-bold" disabled={busy} onClick={() => press(d)} aria-label={d === "back" ? t("approval.backspace") : d}>
                      {d === "back" ? "⌫" : d}
                    </button>
                  ))}
                </div>
              </>
            )}
            <div aria-live="polite" className="min-h-[18px]">
              {busy && <p style={{ color: "var(--text-3)" }}>{slow ? t("approval.slow") : t("approval.checking")}</p>}
              {error && <p id={`${titleId}-err`} role="alert" style={{ color: "var(--rose)" }}>{errorText(error)}</p>}
            </div>
            <div className="flex justify-end gap-2 border-t pt-4" style={{ borderColor: "var(--border)" }}>
              <button type="button" onClick={cancel} className="btn btn-default btn-md">{t("pos.cancel")}</button>
              {!candidates && <button type="submit" disabled={busy || !pin || !request} className="btn btn-primary btn-md disabled:opacity-40 disabled:cursor-not-allowed">{t("approval.approve")}</button>}
            </div>
          </form>
        </div>
      )}
    </div>
  )
}

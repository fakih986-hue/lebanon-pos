import { useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { X } from "lucide-react"
import { useI18n } from "@lebanonpos/shared"

import CashDrawerPanel from "./CashDrawerPanel"
import ExpensePanel from "./ExpensePanel"

import { OPEN_SHIFT_SHEET_EVENT } from "./shiftSheetEvents"

/**
 * Shift & drawer sheet (Midnight Gold v2). The same Cash Drawer and Record
 * Expense widgets as the desktop cart rail — which phones and tablets never
 * show — in a bottom sheet on small screens and a side sheet on wide ones.
 * Permission rules live in the widgets themselves, so every placement
 * behaves the same. Modal: focus moves in, Tab stays inside, Esc closes and
 * focus returns to what opened it.
 */
export default function ShiftSheet() {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const [expanded, setExpanded] = useState<string | null>("drawer")
  const panelRef = useRef<HTMLDivElement>(null)
  const returnTo = useRef<HTMLElement | null>(null)

  // Focus the first field (opening float, closing count), not the Close button.
  function focusFirst() {
    const p = panelRef.current
    const first = p?.querySelector<HTMLElement>("input:not([disabled])") ?? p?.querySelector<HTMLElement>("[aria-expanded], button:not([disabled])")
    ;(first ?? p)?.focus()
  }

  useEffect(() => {
    const onOpen = () => {
      const a = document.activeElement as HTMLElement | null
      if (!panelRef.current?.contains(a)) returnTo.current = a
      setExpanded("drawer")
      setOpen(true)
      window.setTimeout(focusFirst, 30)
    }
    window.addEventListener(OPEN_SHIFT_SHEET_EVENT, onOpen)
    return () => window.removeEventListener(OPEN_SHIFT_SHEET_EVENT, onOpen)
  }, [])

  useEffect(() => {
    if (!open) return
    // Esc works wherever focus is; and when the focused control unmounts
    // (e.g. the float field after Open), focus goes back into the sheet
    // instead of falling to <body> outside the modal.
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close() } }
    const keep = new MutationObserver(() => {
      const a = document.activeElement
      if (!a || a === document.body) focusFirst()
    })
    window.addEventListener("keydown", onKey, true)
    if (panelRef.current) keep.observe(panelRef.current, { childList: true, subtree: true })
    return () => { window.removeEventListener("keydown", onKey, true); keep.disconnect() }
  }, [open])

  function close() {
    setOpen(false)
    window.requestAnimationFrame(() => returnTo.current?.focus())
  }

  if (!open) return null
  // Portal: the topbar uses backdrop-filter, which would make `fixed` relative to the header.
  return createPortal(
    <div className="mg2 fixed inset-0 z-[150] flex items-end justify-center lg:items-stretch lg:justify-end" style={{ background: "rgba(5,7,13,.6)" }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) close() }}>
      <div ref={panelRef} role="dialog" aria-modal="true" aria-labelledby="shift-sheet-title" tabIndex={-1}
        className="w-full overflow-y-auto outline-none lg:h-full lg:w-[440px]"
        style={{ maxHeight: "min(88dvh, 720px)", background: "var(--surface)", borderTop: "1px solid var(--border)", borderTopLeftRadius: 16, borderTopRightRadius: 16, boxShadow: "0 -16px 40px rgba(0,0,0,.45)", paddingBottom: "env(safe-area-inset-bottom)" }}
        onKeyDown={(e) => {
          if (e.key === "Tab") {
            const f = [...(panelRef.current?.querySelectorAll<HTMLElement>("button:not([disabled]), input:not([disabled]), select:not([disabled])") ?? [])]
            if (!f.length) return
            const a = document.activeElement
            if (e.shiftKey && (a === f[0] || a === panelRef.current)) { e.preventDefault(); f[f.length - 1].focus() }
            else if (!e.shiftKey && a === f[f.length - 1]) { e.preventDefault(); f[0].focus() }
          }
        }}>
        <div className="flex items-center gap-3 px-4" style={{ minHeight: 60, borderBottom: "1px solid var(--border)" }}>
          <h2 id="shift-sheet-title" className="mg2-sub" style={{ margin: 0, flex: 1, color: "var(--text)" }}>{t("pos.v2.shift_and_drawer")}</h2>
          <button type="button" className="mg2-btn mg2-btn-ghost" style={{ width: 48, padding: 0 }} aria-label={t("pos.v2.close")} onClick={close}>
            <X size={18} />
          </button>
        </div>
        <CashDrawerPanel expanded={expanded === "drawer"} onToggle={() => setExpanded((v) => (v === "drawer" ? null : "drawer"))} />
        <ExpensePanel expanded={expanded === "expense"} onToggle={() => setExpanded((v) => (v === "expense" ? null : "expense"))} />
      </div>
    </div>
  , document.body)
}

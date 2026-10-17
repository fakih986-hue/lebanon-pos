// Midnight Gold v2 back-office building blocks (DESIGN-SYSTEM §7). One
// implementation each, used by Products, Lots and Receiving. Styles:
// features/pos/backoffice-v2.css.
import { useEffect, useId, useRef, type ComponentProps, type ReactNode } from "react"
import { createPortal } from "react-dom"
import { Link, useLocation } from "react-router"
import { CalendarClock, Inbox, X } from "lucide-react"
import { useI18n } from "@lebanonpos/shared"

import ConfirmDialog from "../../../../components/ConfirmDialog"
import { daysToExpiry, expiryTone } from "../../lib/lotTrace"

export type Tone = "ok" | "warn" | "err" | "info" | "muted"

/** Stock workspace nav: Products · Lots & counts · Receiving (links; survive reload; aria-current). */
export function StockNav({ counts }: { counts?: Partial<Record<"products" | "lots" | "receiving", number>> }) {
  const { t } = useI18n()
  const { pathname } = useLocation()
  const items = [
    { to: "/products", key: "products", label: t("inv.nav.products") },
    { to: "/stock", key: "lots", label: t("inv.nav.lots") },
    { to: "/products/new", key: "receiving", label: t("inv.nav.receiving") },
  ] as const
  return (
    <nav className="mg2-nav" aria-label={t("inv.nav.label")}>
      {items.map((i) => (
        <Link key={i.to} to={i.to} aria-current={pathname === i.to ? "page" : undefined}>
          {i.label}
          {counts?.[i.key] !== undefined && <span className="mg2-count num">{counts[i.key]}</span>}
        </Link>
      ))}
    </nav>
  )
}

/** Page tabs (§7): links with a stable ?tab= value (linkable, survive reload), aria-current. */
export function PageTabs({ label, current, items }: { label: string; current: string; items: Array<{ value: string; label: string; count?: number }> }) {
  const { pathname } = useLocation()
  return (
    <nav className="mg2-nav" aria-label={label}>
      {items.map((i) => (
        <Link key={i.value} to={`${pathname}?tab=${i.value}`} aria-current={current === i.value ? "page" : undefined}>
          {i.label}
          {i.count !== undefined && <span className="mg2-count num">{i.count}</span>}
        </Link>
      ))}
    </nav>
  )
}

export function PageHeader({ title, eyebrow, actions }: { title: string; eyebrow?: string; actions?: ReactNode }) {
  return (
    <div className="mg2-head">
      <div>
        {eyebrow && <p className="mg2-eyebrow">{eyebrow}</p>}
        <h1 className="mg2-title">{title}</h1>
      </div>
      {actions && <div className="mg2-head-actions">{actions}</div>}
    </div>
  )
}

/** FilterChip (§7): a toggle button; status tone only in the count badge. */
export function FilterChip({ pressed, onClick, label, count, tone }: { pressed: boolean; onClick: () => void; label: string; count?: number; tone?: "warn" | "err" }) {
  return (
    <button type="button" className="mg2-chip" aria-pressed={pressed} onClick={onClick}>
      {label}
      {count !== undefined && <span className={`mg2-count num${tone && count > 0 ? ` t-${tone}` : ""}`}>{count}</span>}
    </button>
  )
}

export function Badge({ tone, children, icon }: { tone: Tone; children: ReactNode; icon?: ReactNode }) {
  return <span className={`mg2-badge t-${tone}`}>{icon}{children}</span>
}

/** Expiry chip (§8 Lots): word + icon + date; ok > 30 days, warn ≤ 30, err ≤ 7 or expired. */
export function ExpiryChip({ date }: { date?: string }) {
  const { t, locale } = useI18n()
  const days = daysToExpiry(date)
  const tone = expiryTone(days)
  if (tone === "none" || days === null) return <span className="mg2-badge t-muted">{t("inv.lot.no_expiry")}</span>
  const when = new Intl.DateTimeFormat(locale === "ar" ? "ar-LB" : "en-GB", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(`${date}T12:00:00`))
  const text = days < 0 ? t("inv.lot.expired_days", { date: when, n: -days }) : days === 0 ? t("inv.lot.expires_today", { date: when }) : t("inv.lot.expires_in", { date: when, n: days })
  return <span className={`mg2-badge t-${tone}`}><CalendarClock size={14} aria-hidden="true" />{text}</span>
}

export function StatTile({ label, value }: { label: string; value: ReactNode }) {
  return <div className="mg2-stat"><div className="l">{label}</div><div className="v">{value}</div></div>
}

export function EmptyState({ title, text, action, icon }: { title: string; text?: string; action?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="mg2-empty" role="status">
      {icon ?? <Inbox size={28} aria-hidden="true" />}
      <h3>{title}</h3>
      {text && <p>{text}</p>}
      {action}
    </div>
  )
}

export function SkeletonRows({ n = 6 }: { n?: number }) {
  const { t } = useI18n()
  return (
    <div aria-busy="true" aria-label={t("inv.loading")} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {Array.from({ length: n }, (_, i) => <div key={i} className="mg2-skel" />)}
    </div>
  )
}

/** Label above, help or error below (never a placeholder); errors wire aria-invalid + aria-describedby. */
export function Field({ label, help, error, children, id }: { label: string; help?: string; error?: string; id?: string; children: (a11y: { id: string; "aria-invalid"?: true; "aria-describedby"?: string }) => ReactNode }) {
  const auto = useId()
  const fid = id ?? auto
  const describedBy = error ? `${fid}-err` : help ? `${fid}-help` : undefined
  return (
    <label className="mg2-field" htmlFor={fid}>
      <span className="lbl">{label}</span>
      {children({ id: fid, ...(error ? { "aria-invalid": true as const } : {}), ...(describedBy ? { "aria-describedby": describedBy } : {}) })}
      {error ? <p className="err" id={`${fid}-err`}>{error}</p> : help ? <p className="help" id={`${fid}-help`}>{help}</p> : null}
    </label>
  )
}

/**
 * A confirmation that works over an open Drawer: mounted only while open and portalled to <body>
 * (a Drawer makes the page behind it inert, which would also catch a dialog rendered inside the
 * page). Focus moves to Cancel, the safe choice; Esc cancels.
 */
export function ConfirmLayer(props: ComponentProps<typeof ConfirmDialog>) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!props.open) return
    const id = window.requestAnimationFrame(() => {
      const buttons = ref.current?.querySelectorAll<HTMLElement>("[role=alertdialog] button")
      buttons?.[buttons.length - 2]?.focus()
    })
    return () => window.cancelAnimationFrame(id)
  }, [props.open])
  if (!props.open) return null
  return createPortal(<div ref={ref}><ConfirmDialog {...props} /></div>, document.body)
}

/**
 * Drawer (§7): inline-end, 480 / 640 px, header · scroll body · sticky footer; full width on phones.
 * Modal: focus moves in, Tab stays inside, Esc closes, focus returns to what opened it; the page
 * behind is inert while it is open.
 */
export function Drawer({ open, title, subtitle, onClose, children, footer, wide }: {
  open: boolean; title: string; subtitle?: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean
}) {
  const { t } = useI18n()
  const ref = useRef<HTMLDivElement>(null)
  const layerRef = useRef<HTMLDivElement>(null)
  const returnTo = useRef<HTMLElement | null>(null)
  const titleId = useId()
  useEffect(() => {
    if (!open) return
    returnTo.current = document.activeElement as HTMLElement | null
    const id = window.setTimeout(() => {
      // An explicit [data-autofocus] wins; otherwise the first field.
      const first = ref.current?.querySelector<HTMLElement>("[data-autofocus]:not([disabled])") ?? ref.current?.querySelector<HTMLElement>("input:not([disabled]), select:not([disabled]), textarea:not([disabled])")
      ;(first ?? ref.current)?.focus()
    }, 30)
    // Inert background (siblings of the layer up to <body>), restored on close.
    const marked: Element[] = []
    for (let node: Element | null = layerRef.current; node && node !== document.body; node = node.parentElement) {
      for (const sib of Array.from(node.parentElement?.children ?? [])) {
        if (sib !== node && !sib.hasAttribute("inert") && !(sib instanceof HTMLScriptElement)) { sib.setAttribute("inert", ""); marked.push(sib) }
      }
    }
    return () => {
      window.clearTimeout(id)
      for (const el of marked) el.removeAttribute("inert")
      const back = returnTo.current
      window.requestAnimationFrame(() => { if (back && back.isConnected) back.focus() })
    }
  }, [open])
  if (!open) return null
  return createPortal(
    <div ref={layerRef} className="mg2 mg2-bo mg2-drawer-layer" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div ref={ref} className={`mg2-drawer${wide ? " wide" : ""}`} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}
        onKeyDown={(e) => {
          if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); onClose(); return }
          if (e.key === "Tab") {
            const f = [...(ref.current?.querySelectorAll<HTMLElement>("button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])") ?? [])].filter((x) => x.offsetParent !== null)
            if (!f.length) return
            const a = document.activeElement
            if (e.shiftKey && (a === f[0] || a === ref.current)) { e.preventDefault(); f[f.length - 1].focus() }
            else if (!e.shiftKey && a === f[f.length - 1]) { e.preventDefault(); f[0].focus() }
          }
        }}>
        <div className="mg2-drawer-head">
          <div style={{ flex: 1, minWidth: 0 }}>
            <h2 id={titleId}>{title}</h2>
            {subtitle && <div className="mg2-cap" style={{ marginTop: 2 }}>{subtitle}</div>}
          </div>
          <button type="button" className="mg2-btn mg2-btn-ghost" style={{ width: 44, padding: 0 }} onClick={onClose} aria-label={t("inv.close")}>
            <X size={18} />
          </button>
        </div>
        <div className="mg2-drawer-body">{children}</div>
        {footer && <div className="mg2-drawer-foot">{footer}</div>}
      </div>
    </div>,
    document.body,
  )
}

import { useEffect, useState } from "react"
import { ShieldAlert, ShieldCheck, ShieldQuestion } from "lucide-react"
import { useI18n } from "@lebanonpos/shared"

import { getDeviceEnrollment, getStoreIdentityMode, personEvidence } from "../../features/pos/lib/deviceCredentials"
import { getCurrentUser, isSessionUnlocked } from "../../features/pos/services/security.service"
import { getApiUrl } from "../../features/pos/services/sync.service"

/**
 * SPRINT-2: who is signed in on this register and how they were let in — on the POS, not only in
 * Settings. Shows whether the server checked this person's PIN (staff session), only the register
 * did (offline), or neither; and whether the store requires a server check for sales.
 */
export default function StaffSessionBadge() {
  const { t, locale } = useI18n()
  const [, setTick] = useState(0)
  useEffect(() => {
    const refresh = () => setTick((n) => n + 1)
    window.addEventListener("lebanonpos-security-changed", refresh)
    window.addEventListener("storage", refresh)
    const timer = window.setInterval(refresh, 30_000)
    return () => { window.removeEventListener("lebanonpos-security-changed", refresh); window.removeEventListener("storage", refresh); window.clearInterval(timer) }
  }, [])

  const user = isSessionUnlocked() ? getCurrentUser() : null
  if (!user) return null
  const enforced = getStoreIdentityMode() === "enforce-checkout"
  const ev = personEvidence(getApiUrl(), user.id)
  const time = ev.authTime ? new Intl.DateTimeFormat(locale === "ar" ? "ar-LB" : "en-GB", { hour: "2-digit", minute: "2-digit" }).format(new Date(ev.authTime)) : ""
  const enrolled = !!getDeviceEnrollment() && !getDeviceEnrollment()!.revoked

  const look = ev.kind === "server"
    ? { Icon: ShieldCheck, fg: "var(--v2-ok)", bg: "var(--v2-ok-soft)", short: t("pos.identity.server_short", { time }), full: t("devices.session.server", { name: user.name, time }) }
    : ev.kind === "local"
      ? { Icon: ShieldAlert, fg: "var(--v2-warn)", bg: "var(--v2-warn-soft)", short: t("pos.identity.local_short"), full: t("devices.session.local", { name: user.name }) }
      : { Icon: enforced ? ShieldAlert : ShieldQuestion, fg: enforced ? "var(--v2-err)" : "var(--text-2)", bg: enforced ? "var(--v2-err-soft)" : "var(--surface-2)", short: t("pos.identity.none_short"), full: t(enrolled ? "devices.session.none_enrolled" : "devices.session.none", { name: user.name }) }
  const label = enforced && ev.kind !== "server" ? `${look.full} ${t("pos.identity.enforced_note")}` : look.full

  return (
    <span
      role="status"
      aria-label={label}
      title={label}
      data-testid="staff-session-badge"
      data-kind={ev.kind}
      className="flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-2 text-[11px] font-bold"
      style={{ background: look.bg, color: look.fg }}
    >
      <look.Icon size={14} aria-hidden="true" />
      <span className="hidden md:inline">{look.short}</span>
      {enforced && ev.kind !== "server" && <span className="hidden lg:inline">· {t("pos.identity.enforced_short")}</span>}
    </span>
  )
}

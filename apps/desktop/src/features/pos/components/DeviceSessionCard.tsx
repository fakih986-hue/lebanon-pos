import { useEffect, useState } from "react"
import { KeyRound, ShieldCheck } from "lucide-react"
import { useI18n } from "@lebanonpos/shared"

import { getDeviceEnrollment, getStaffSession, getUnlockEvidence } from "../lib/deviceCredentials"
import { enrollThisDevice } from "../services/deviceSession.service"
import { generatePairingCode } from "../services/deviceRegistry.service"
import { getCurrentUser, isSessionUnlocked, userCan } from "../services/security.service"
import { getApiUrl } from "../services/sync.service"
import { getSettings } from "../services/settings.service"

const card = { background: "var(--surface)", border: "1px solid var(--border)", color: "var(--text)" } as const
const muted = { color: "var(--text-2)" } as const
const input = { minHeight: 44, background: "var(--surface-2)", border: "1px solid var(--border-input)", color: "var(--text)", borderRadius: 8, padding: "0 12px", fontSize: 15 } as const
const primary = { minHeight: 44, background: "var(--brand)", color: "var(--text-inverse)", borderRadius: 8, padding: "0 16px", fontWeight: 700, fontSize: 14 } as const
const secondary = { minHeight: 44, background: "var(--surface-2)", border: "1px solid var(--border-strong)", color: "var(--text)", borderRadius: 8, padding: "0 16px", fontWeight: 700, fontSize: 14 } as const

const isPlainHttpLan = (url: string | null) => {
  if (!url?.startsWith("http://")) return false
  try { const h = new URL(url).hostname; return h !== "localhost" && h !== "127.0.0.1" && h !== "[::1]" } catch { return false }
}

/**
 * SPRINT-2 C: this register's enrollment and who is signed in (observe mode). Managers create the
 * one-time code here (on any register, hub or cloud); the register being enrolled enters it here.
 */
export default function DeviceSessionCard() {
  const { t, locale } = useI18n()
  const tag = locale === "ar" ? "ar-LB" : "en-GB"
  const [, setTick] = useState(0)
  const [code, setCode] = useState("")
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null)
  const [issued, setIssued] = useState<{ code: string; expiresAt: string } | null>(null)

  useEffect(() => {
    const refresh = () => setTick((n) => n + 1)
    window.addEventListener("lebanonpos-security-changed", refresh)
    window.addEventListener("storage", refresh)
    return () => { window.removeEventListener("lebanonpos-security-changed", refresh); window.removeEventListener("storage", refresh) }
  }, [])

  const apiUrl = getApiUrl()
  const enrollment = getDeviceEnrollment()
  const enrolledHere = !!enrollment && !!apiUrl && enrollment.apiUrl.replace(/\/+$/, "").toLowerCase() === apiUrl.replace(/\/+$/, "").toLowerCase()
  const status: "enrolled" | "invalid" | "none" = enrolledHere ? (enrollment!.revoked ? "invalid" : "enrolled") : "none"
  const user = isSessionUnlocked() ? getCurrentUser() : null
  const unlock = getUnlockEvidence()
  const session = getStaffSession()
  const time = (iso: string) => new Intl.DateTimeFormat(tag, { hour: "2-digit", minute: "2-digit" }).format(new Date(iso))

  let who: string
  if (!user) who = t("devices.session.locked")
  else if (unlock?.userId === user.id && unlock.by === "local") who = t("devices.session.local", { name: user.name })
  else if (session && session.staffId === user.id && unlock?.userId === user.id && unlock.by === "server") who = t("devices.session.server", { name: user.name, time: time(session.authTime) })
  else who = t(status === "enrolled" ? "devices.session.none_enrolled" : "devices.session.none", { name: user.name })

  async function enroll() {
    if (!code.trim()) return
    setBusy(true); setMessage(null)
    const r = await enrollThisDevice(code, getSettings().registerName || "Register")
    setBusy(false)
    if (r.ok) { setCode(""); setMessage({ text: t("devices.enrolled_ok") }); window.dispatchEvent(new Event("lebanonpos-security-changed")) }
    else setMessage({ text: r.error, error: true })
  }

  async function createCode() {
    setBusy(true); setMessage(null)
    try { const r = await generatePairingCode(); setIssued({ code: r.code, expiresAt: r.expiresAt }) }
    catch (e) { setMessage({ text: e instanceof Error ? e.message : String(e), error: true }) }
    finally { setBusy(false) }
  }

  const badge = status === "enrolled"
    ? { text: t("devices.status.enrolled"), bg: "var(--v2-ok-soft)", fg: "var(--v2-ok)" }
    : status === "invalid"
      ? { text: t("devices.status.invalid"), bg: "var(--v2-err-soft)", fg: "var(--v2-err)" }
      : { text: t("devices.status.not_enrolled"), bg: "var(--v2-warn-soft)", fg: "var(--v2-warn)" }

  return (
    <section className="rounded-lg p-4" style={card} aria-labelledby="device-identity-title" data-testid="device-session-card">
      <div className="flex items-center gap-3">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg" style={{ background: "var(--brand-soft)", color: "var(--brand-text)" }}>
          <ShieldCheck size={21} aria-hidden="true" />
        </div>
        <div className="min-w-0">
          <h2 id="device-identity-title" className="text-lg font-bold">{t("devices.card.title")}</h2>
          <p className="text-sm" style={muted}>{t("devices.card.help")}</p>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <span className="rounded-full px-2.5 py-1 text-xs font-bold" style={{ background: badge.bg, color: badge.fg }} data-testid="device-status">{badge.text}</span>
        {status !== "none" && enrollment && (
          <span className="text-sm" style={muted}>{t("devices.enrolled_with", { server: enrollment.apiUrl, date: new Intl.DateTimeFormat(tag, { day: "2-digit", month: "short", year: "numeric" }).format(new Date(enrollment.enrolledAt)) })}</span>
        )}
      </div>
      {isPlainHttpLan(apiUrl) && <p className="mt-2 text-sm" style={{ color: "var(--v2-warn)" }}>{t("devices.http_lan")}</p>}

      {status !== "enrolled" && (
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <label className="flex min-w-0 flex-1 flex-col gap-1 text-sm font-bold">
            {t("devices.code_label")}
            <input value={code} onChange={(e) => setCode(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void enroll() }}
              dir="ltr" autoComplete="off" spellCheck={false} maxLength={12} className="font-mono tracking-widest" style={input} data-testid="enroll-code" />
          </label>
          <button type="button" onClick={() => void enroll()} disabled={busy || !code.trim()} style={{ ...primary, opacity: busy || !code.trim() ? 0.6 : 1 }} data-testid="enroll-submit">
            {busy ? t("devices.enrolling") : t("devices.enroll")}
          </button>
        </div>
      )}

      <div className="mt-4 rounded-lg p-3" style={{ background: "var(--surface-2)" }}>
        <p className="text-xs font-bold uppercase tracking-wide" style={muted}>{t("devices.session.title")}</p>
        <p className="mt-1 text-sm font-semibold" data-testid="device-session-who">{who}</p>
        <p className="mt-1 text-xs" style={muted}>{t("devices.observe")}</p>
      </div>

      {user && userCan("settings.manage") && (
        <div className="mt-4">
          <button type="button" onClick={() => void createCode()} disabled={busy} className="inline-flex items-center gap-2" style={secondary} data-testid="enroll-create-code">
            <KeyRound size={16} aria-hidden="true" />
            {t("devices.create_code")}
          </button>
          {issued && (
            <p className="mt-2 text-sm" role="status" data-testid="enroll-issued">
              {t("devices.code_ready", { code: issued.code, time: time(issued.expiresAt) })}
            </p>
          )}
        </div>
      )}

      {message && <p className="mt-3 text-sm" role="status" style={{ color: message.error ? "var(--v2-err)" : "var(--v2-ok)" }}>{message.text}</p>}
    </section>
  )
}

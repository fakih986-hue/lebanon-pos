/**
 * SPRINT-2 Phase C — enrolling this till and opening per-person staff sessions (observe mode).
 *
 * Enrollment uses a one-time code a manager creates (Settings → Devices). The till's connection token
 * is never changed here: the server keeps the till's transport identity and the acting person apart.
 * Every call is best effort — a failure never blocks a sale or an unlock; the server then simply
 * records weaker evidence for the work.
 */
import { deliverSessionWork, getApiUrl, getCurrentTenantId, getDeviceId } from "./sync.service"
import {
  clearPersonEvidence, getDeviceEnrollment, getStaffSession, getStoreIdentityMode, personEvidence, setDeviceEnrollment, setStaffSession,
  type DeviceEnrollment,
} from "../lib/deviceCredentials"

export type EnrollResult = { ok: true; enrollment: DeviceEnrollment } | { ok: false; error: string }

/** Keeps the credential a pairing/enrollment response carried, bound to the server that issued it. */
export function rememberEnrollment(apiUrl: string, body: { credential?: unknown; enrolledDeviceId?: unknown; tenantId?: unknown }): DeviceEnrollment | null {
  if (typeof body.credential !== "string" || typeof body.enrolledDeviceId !== "string" || typeof body.tenantId !== "string") return null
  const enrollment: DeviceEnrollment = { credential: body.credential, enrolledDeviceId: body.enrolledDeviceId, tenantId: body.tenantId, apiUrl, enrolledAt: new Date().toISOString() }
  setDeviceEnrollment(enrollment)
  clearPersonEvidence() // a new enrollment starts without anyone's session
  return enrollment
}

export async function enrollThisDevice(code: string, deviceName: string): Promise<EnrollResult> {
  const apiUrl = getApiUrl()
  if (!apiUrl) return { ok: false, error: "This register is not connected to a server." }
  try {
    const res = await fetch(`${apiUrl}/api/device/pair`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: code.trim().toUpperCase(), deviceId: getDeviceId(), deviceName, ...(getCurrentTenantId() ? { expectTenantId: getCurrentTenantId() } : {}) }),
      signal: AbortSignal.timeout(10_000),
    })
    const body = await res.json().catch(() => ({}))
    if (!res.ok) return { ok: false, error: body?.error ?? `Enrollment failed (HTTP ${res.status})` }
    const enrollment = rememberEnrollment(apiUrl, body)
    return enrollment ? { ok: true, enrollment } : { ok: false, error: "This server does not issue device credentials yet." }
  } catch {
    return { ok: false, error: `Can't reach ${apiUrl}.` }
  }
}

/**
 * After the server accepted this person's PIN: open their staff session on this device. Any
 * session of the previous person was already dropped when the register locked.
 */
export async function startStaffSession(pin: string, staffId: string): Promise<boolean> {
  const apiUrl = getApiUrl()
  const e = getDeviceEnrollment()
  if (!apiUrl || !e || e.revoked || e.apiUrl.replace(/\/+$/, "").toLowerCase() !== apiUrl.replace(/\/+$/, "").toLowerCase()) return false
  try {
    const res = await fetch(`${apiUrl}/api/auth/staff-session`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-device-credential": e.credential, "x-tenant-id": e.tenantId },
      body: JSON.stringify({ pin, staffId }),
      signal: AbortSignal.timeout(5_000),
    })
    const body = await res.json().catch(() => ({}))
    if (res.status === 401 && body?.code === "DEVICE_NOT_ENROLLED") {
      setDeviceEnrollment({ ...e, revoked: true }) // shown in Settings; a manager re-enrolls it
      return false
    }
    if (!res.ok || body?.staff?.id !== staffId || typeof body.session !== "string") return false
    setStaffSession({ session: body.session, sessionId: body.sessionId, staffId, staffName: body.staff.name ?? "", authTime: body.authTime, expiresAt: body.expiresAt, apiUrl })
    return true
  } catch {
    return false
  }
}

/**
 * The register locked or changed person: drop the session here at once (the next person never acts under
 * it), send the work queued under it, then tell the server it ended (best effort).
 */
export function endStaffSession(): void {
  const s = getStaffSession()
  // signed out here at once, whatever storage does (the session is forgotten in memory too)
  try { clearPersonEvidence() } catch { /* storage unavailable: getStaffSession no longer returns it */ }
  const e = getDeviceEnrollment()
  if (!s || !e || e.revoked) return
  // if the app closes before the server hears of it, the next start tells it (resumeSessionEnds)
  rememberSessionEnd(s.session, s.apiUrl)
  void finishSessionEnd(s.session, s.apiUrl, e.credential)
}

/** How long a staff switch waits for the outgoing person's queued work before ending their session. */
export const sessionEndTiming = { boundMs: 8_000 }

/** Bounded: the outgoing person's queued work first (it keeps its own session either way), then the end. */
async function finishSessionEnd(session: string, apiUrl: string, credential: string): Promise<void> {
  await deliverSessionWork(session, sessionEndTiming.boundMs).catch(() => undefined)
  try {
    const res = await fetch(`${apiUrl}/api/auth/staff-session/end`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-device-credential": credential },
      body: JSON.stringify({ session }),
      signal: AbortSignal.timeout(5_000),
    })
    // ended now, already ended, or unknown to the server: nothing more to tell it
    if (res.ok || res.status === 404 || res.status === 401 || res.status === 409) forgetSessionEnd(session)
  } catch { /* unreachable: told on the next start or the next sign-in (and the server ends it when the next person signs in) */ }
}

const PENDING_ENDS_KEY = "lebanonpos.staff-session-ends.v1"
type PendingEnd = { session: string; apiUrl: string; at: string }
function readPendingEnds(): PendingEnd[] {
  try { const raw = localStorage.getItem(PENDING_ENDS_KEY); const v = raw ? JSON.parse(raw) : []; return Array.isArray(v) ? v : [] } catch { return [] }
}
function writePendingEnds(list: PendingEnd[]) {
  try { if (list.length) localStorage.setItem(PENDING_ENDS_KEY, JSON.stringify(list.slice(-20))); else localStorage.removeItem(PENDING_ENDS_KEY) } catch { /* storage unavailable */ }
}
function rememberSessionEnd(session: string, apiUrl: string) { writePendingEnds([...readPendingEnds().filter((p) => p.session !== session), { session, apiUrl, at: new Date().toISOString() }]) }
function forgetSessionEnd(session: string) { writePendingEnds(readPendingEnds().filter((p) => p.session !== session)) }

/** At start: sessions whose end the server may not have heard (the app closed during a staff switch). */
export async function resumeSessionEnds(): Promise<number> {
  const e = getDeviceEnrollment()
  const pending = readPendingEnds()
  if (!e || e.revoked) return 0
  await Promise.all(pending.map((p) => finishSessionEnd(p.session, p.apiUrl, e.credential)))
  return pending.length
}

export type CheckoutIdentityProblem = "not-enrolled" | "sign-in-again"
/**
 * SPRINT-2 enforce-checkout, checked BEFORE payment (the server refuses such a sale anyway; this keeps
 * a customer from paying for a sale the store will not record). Observe-mode stores: never blocks.
 * A person let in by the register's own PIN check may sell while the server is unreachable (routine
 * offline sales stay as today); once it is reachable again they must sign in again.
 */
export async function checkoutIdentityGate(): Promise<CheckoutIdentityProblem | null> {
  if (getStoreIdentityMode() === "observe") return null
  const apiUrl = getApiUrl()
  let currentUserId: string | null = null
  try { currentUserId = localStorage.getItem("lebanonpos.current-user.v1") } catch { /* storage unavailable */ }
  const now = personEvidence(apiUrl, currentUserId)
  if (now.kind === "server") return null
  if (now.kind === "local") {
    if (!apiUrl) return null
    try {
      const res = await fetch(`${apiUrl}/api/health`, { method: "HEAD", signal: AbortSignal.timeout(1500) })
      return res.ok ? "sign-in-again" : null
    } catch { return null } // unreachable: an offline sale, recorded as offline-claimed
  }
  const e = getDeviceEnrollment()
  return !e || e.revoked || !apiUrl || e.apiUrl.replace(/\/+$/, "").toLowerCase() !== apiUrl.replace(/\/+$/, "").toLowerCase() ? "not-enrolled" : "sign-in-again"
}

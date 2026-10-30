/**
 * SPRINT-2 Phase C — enrolling this till and opening per-person staff sessions (observe mode).
 *
 * Enrollment uses a one-time code a manager creates (Settings → Devices). The till's connection token
 * is never changed here: the server keeps the till's transport identity and the acting person apart.
 * Every call is best effort — a failure never blocks a sale or an unlock; the server then simply
 * records weaker evidence for the work.
 */
import { getApiUrl, getCurrentTenantId, getDeviceId } from "./sync.service"
import {
  clearPersonEvidence, getDeviceEnrollment, getStaffSession, setDeviceEnrollment, setStaffSession,
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

/** The register locked or changed person: drop the session here, and tell the server (best effort). */
export function endStaffSession(): void {
  const s = getStaffSession()
  clearPersonEvidence()
  const e = getDeviceEnrollment()
  if (!s || !e || e.revoked) return
  void fetch(`${s.apiUrl}/api/auth/staff-session/end`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-device-credential": e.credential },
    body: JSON.stringify({ session: s.session }),
  }).catch(() => undefined)
}

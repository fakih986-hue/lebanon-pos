/**
 * SPRINT-2 Phase C — this till's device credential and the current person's staff session (observe
 * mode). Storage only: no network, no imports from services (sync.service and security.service both
 * use it).
 *
 * - The device credential is issued by the server this till enrolled with (its hub, or the cloud for
 *   a direct till) and is sent only to that server. It is a bearer credential kept in localStorage:
 *   on a plain-HTTP LAN it is visible to the network, and anyone with this browser profile has it.
 * - The staff session is issued after the server checked one person's PIN for this device. It is
 *   dropped whenever the register locks or changes person, so it never travels with someone else's
 *   work. A stored session is not a fresh PIN check: the server records when the PIN was checked.
 * - Every operation keeps the envelope it was created under (not the one current at push time).
 */
import { clearApprovalGrants } from "./approvalGrants"

const DEVICE_KEY = "lebanonpos.device-credential.v1"
const SESSION_KEY = "lebanonpos.staff-session.v1"
const UNLOCK_KEY = "lebanonpos.unlock-evidence.v1"

export type DeviceEnrollment = { credential: string; enrolledDeviceId: string; tenantId: string; apiUrl: string; enrolledAt: string; revoked?: boolean }
export type StaffSessionRecord = { session: string; sessionId: string; staffId: string; staffName: string; authTime: string; expiresAt: string; apiUrl: string }
/** How the current person was let in: the server checked the PIN, or only this till did. */
export type UnlockEvidence = { userId: string; by: "server" | "local"; at: string }
/** Sent with each operation, outside the operation itself (the server only records it). `approval`:
 *  a manager approval id for this operation's record (SPRINT-2 E; checked by the server). */
export type SyncEnvelope = { v: 1; session?: string; offline?: true; approval?: string }

/** Written by security.service on unlock (read here to avoid importing it). */
const currentUser = () => { try { return localStorage.getItem("lebanonpos.current-user.v1") } catch { return null } }
const norm = (url: string) => url.trim().replace(/\/+$/, "").toLowerCase()
function read<T>(key: string): T | null {
  try { const raw = localStorage.getItem(key); return raw ? (JSON.parse(raw) as T) : null } catch { return null }
}
function write(key: string, value: unknown) {
  try { if (value == null) localStorage.removeItem(key); else localStorage.setItem(key, JSON.stringify(value)) } catch { /* storage unavailable */ }
}

export const getDeviceEnrollment = () => read<DeviceEnrollment>(DEVICE_KEY)
export const setDeviceEnrollment = (e: DeviceEnrollment | null) => write(DEVICE_KEY, e)
/** The device credential, only for the server that issued it. */
export function deviceCredentialFor(apiUrl: string | null | undefined): string | null {
  const e = getDeviceEnrollment()
  return e && !e.revoked && apiUrl && norm(e.apiUrl) === norm(apiUrl) ? e.credential : null
}
export function deviceHeadersFor(apiUrl: string | null | undefined): Record<string, string> {
  const c = deviceCredentialFor(apiUrl)
  return c ? { "x-device-credential": c } : {}
}

export const getStaffSession = () => read<StaffSessionRecord>(SESSION_KEY)
export const setStaffSession = (s: StaffSessionRecord | null) => write(SESSION_KEY, s)
export const getUnlockEvidence = () => read<UnlockEvidence>(UNLOCK_KEY)
export const setUnlockEvidence = (u: UnlockEvidence | null) => write(UNLOCK_KEY, u)

/** The register locked or changed person: nothing of the previous person's session may remain. */
export function clearPersonEvidence() {
  setStaffSession(null)
  setUnlockEvidence(null)
  // a manager's approval was for the person signed in then: unused approvals go with them
  clearApprovalGrants()
}

/**
 * The envelope for an operation created NOW by `currentUserId`. A session is attached only when it
 * belongs to that person, came from this till's current server, and the person was let in by that
 * server. A person let in by the till alone is marked offline (local PIN).
 */
export function captureEnvelope(apiUrl: string | null | undefined, currentUserId: string | null = currentUser()): SyncEnvelope | undefined {
  const unlock = getUnlockEvidence()
  if (!currentUserId || !unlock || unlock.userId !== currentUserId) return undefined
  if (unlock.by === "local") return { v: 1, offline: true }
  const s = getStaffSession()
  if (s && s.staffId === currentUserId && apiUrl && norm(s.apiUrl) === norm(apiUrl)) return { v: 1, session: s.session }
  return { v: 1 }
}

const MODE_KEY = "lebanonpos.staff-session-mode.v1"
/** SPRINT-2: the store's identity mode, as last reported by its server (observe unless enabled). */
export type StoreIdentityMode = "observe" | "enforce-checkout"
export const getStoreIdentityMode = (): StoreIdentityMode => (read<{ mode?: string }>(MODE_KEY)?.mode === "enforce-checkout" ? "enforce-checkout" : "observe")
/** Returns true when the mode changed. */
export function setStoreIdentityMode(mode: unknown): boolean {
  if (mode !== "observe" && mode !== "enforce-checkout") return false
  const changed = getStoreIdentityMode() !== mode
  write(MODE_KEY, { mode, at: new Date().toISOString() })
  return changed
}

/** How the person signed in now was let in (for the POS badge and the checkout gate). */
export function personEvidence(apiUrl: string | null | undefined, currentUserId: string | null): { kind: "server" | "local" | "none"; authTime?: string } {
  const unlock = getUnlockEvidence()
  if (!currentUserId || !unlock || unlock.userId !== currentUserId) return { kind: "none" }
  if (unlock.by === "local") return { kind: "local" }
  const s = getStaffSession()
  if (s && s.staffId === currentUserId && apiUrl && norm(s.apiUrl) === norm(apiUrl)) return { kind: "server", authTime: s.authTime }
  return { kind: "none" }
}

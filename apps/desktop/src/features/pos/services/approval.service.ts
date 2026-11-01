// SPRINT-2 E: online manager approval from this register (server: apps/api/src/routes/approvals.ts).
// The person signed in stays signed in and stays the actor: a manager types their PIN, the server
// checks it for ONE record and its values, and this register keeps the approval in memory
// (lib/approvalGrants) until the operation for that record is created, which carries it. Nothing is
// recorded here; cancelling leaves the work as it was. Online only: no offline approval.
import { addApprovalGrant, dropApprovalGrant, type ApprovalGrant } from "../lib/approvalGrants"
import { deviceHeadersFor, getStaffSession } from "../lib/deviceCredentials"
import { getApiUrl, getAuthToken } from "./sync.service"
import { getCurrentUser, type Permission } from "./security.service"

export type ApprovalRequest = {
  entity: string
  action: string
  /** The record as it will be sent (its id and material values: amounts, lines, method). */
  payload: Record<string, unknown> & { id: string }
  permission: Permission
  pin: string
  /** Chosen when one PIN belongs to several people. */
  approverId?: string
}
export type ApprovalFailure = {
  ok: false
  code: "OFFLINE" | "TIMEOUT" | "INVALID_PIN" | "APPROVER_LACKS_PERMISSION" | "APPROVER_INACTIVE" | "AMBIGUOUS_PIN" | "APPROVAL_LOCKED" | "DEVICE_NOT_ENROLLED" | "DEVICE_OTHER_STORE" | "NOT_APPROVABLE" | "SELF_APPROVAL" | "ERROR"
  message: string
  candidates?: Array<{ id: string; name: string }>
  remaining?: number
}
export type ApprovalResult = { ok: true; grant: ApprovalGrant } | ApprovalFailure

const TIMEOUT_MS = 15_000
const KNOWN = new Set(["INVALID_PIN", "APPROVER_LACKS_PERMISSION", "APPROVER_INACTIVE", "AMBIGUOUS_PIN", "APPROVAL_LOCKED", "DEVICE_NOT_ENROLLED", "DEVICE_OTHER_STORE", "NOT_APPROVABLE", "SELF_APPROVAL"])

export async function requestManagerApproval(req: ApprovalRequest, opts: { signal?: AbortSignal } = {}): Promise<ApprovalResult> {
  const apiUrl = getApiUrl()
  const token = getAuthToken()
  if (!apiUrl || !token) return { ok: false, code: "OFFLINE", message: "Not connected to the store's server." }
  const session = getStaffSession()
  const userId = getCurrentUser()?.id ?? null
  const headers: Record<string, string> = {
    "Content-Type": "application/json", Authorization: `Bearer ${token}`, ...deviceHeadersFor(apiUrl),
    ...(session && session.staffId === userId ? { "x-staff-session": session.session } : {}),
  }
  const timeout = AbortSignal.timeout(TIMEOUT_MS)
  const signal = opts.signal ? AbortSignal.any([opts.signal, timeout]) : timeout
  let res: Response
  try {
    res = await fetch(`${apiUrl}/api/approvals`, { method: "POST", headers, signal, body: JSON.stringify({ entity: req.entity, action: req.action, payload: req.payload, permission: req.permission, pin: req.pin, ...(req.approverId ? { approverId: req.approverId } : {}) }) })
  } catch (error) {
    if (timeout.aborted) return { ok: false, code: "TIMEOUT", message: "The server did not answer in time." }
    return { ok: false, code: "OFFLINE", message: error instanceof Error ? error.message : "The server could not be reached." }
  }
  const body = (await res.json().catch(() => ({}))) as Record<string, any>
  if (!res.ok || typeof body.approvalId !== "string") {
    const code = typeof body.code === "string" && KNOWN.has(body.code) ? body.code : "ERROR"
    return { ok: false, code, message: String(body.error ?? `HTTP ${res.status}`), candidates: Array.isArray(body.candidates) ? body.candidates : undefined, remaining: typeof body.remaining === "number" ? body.remaining : undefined } as ApprovalFailure
  }
  const grant: ApprovalGrant = {
    approvalId: body.approvalId, entity: req.entity, action: req.action, recordId: req.payload.id, permission: req.permission,
    approverName: String(body.approver?.name ?? ""), expiresAt: String(body.expiresAt), userId,
  }
  addApprovalGrant(grant)
  return { ok: true, grant }
}

/** Withdraws an approval that will not be used (best effort; it also expires on its own). */
export function withdrawManagerApproval(grant: ApprovalGrant): void {
  dropApprovalGrant(grant.entity, grant.action, grant.recordId)
  const apiUrl = getApiUrl(), token = getAuthToken()
  if (!apiUrl || !token) return
  void fetch(`${apiUrl}/api/approvals/${encodeURIComponent(grant.approvalId)}/cancel`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, ...deviceHeadersFor(apiUrl) } }).catch(() => undefined)
}

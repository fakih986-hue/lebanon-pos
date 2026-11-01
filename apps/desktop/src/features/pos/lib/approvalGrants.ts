// SPRINT-2 E: manager approvals this register received for the person signed in now. In memory only:
// an approval never survives a restart, a lock or a change of person (clearApprovalGrants). Each grant
// is for one record (entity, action, record id), the permissions approved, and the exact command the
// manager approved (built by the same function that builds the operation). The server bound it to the
// command's material values and checks it again when the operation arrives; this register also refuses
// to commit a command that no longer matches the approved one. No imports (deviceCredentials uses it).

export type ApprovalGrant = {
  approvalId: string
  entity: string
  action: string
  recordId: string
  permission: string
  /** Every permission approved (a sale with a discount and a price below list: both). */
  permissions?: string[]
  approverName: string
  expiresAt: string
  /** The person signed in when the manager approved (the actor; never the manager). */
  userId: string | null
  /** The command as approved (the operation's payload). */
  command?: unknown
}

const grants = new Map<string, ApprovalGrant>()
const key = (entity: string, action: string, recordId: string) => `${entity}:${action}:${recordId}`

/** Fields the register stamps when it commits (the server does not bind them either). */
const RESTAMPED = new Set(["createdAt", "refundNumber"])
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`
  if (value && typeof value === "object") return `{${Object.keys(value as object).filter((k) => !RESTAMPED.has(k) && (value as Record<string, unknown>)[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${canonical((value as Record<string, unknown>)[k])}`).join(",")}}`
  return JSON.stringify(value ?? null)
}
/** The command about to be committed is the one the manager approved (commit-time stamps aside). */
export const sameCommand = (a: unknown, b: unknown) => canonical(a) === canonical(b)

export function addApprovalGrant(g: ApprovalGrant) { grants.set(key(g.entity, g.action, g.recordId), g) }

export type GrantStatus = { status: "ok"; grant: ApprovalGrant } | { status: "none" } | { status: "changed" }

/**
 * The grant for this record and permission, for the person signed in now, if the command about to be
 * committed is the approved one. A changed command drops the grant: it needs a new approval.
 */
export function approvalGrantStatus(entity: string, action: string, recordId: string | undefined | null, permission: string, userId: string | null, command?: unknown): GrantStatus {
  if (!recordId) return { status: "none" }
  const k = key(entity, action, recordId)
  const g = grants.get(k)
  const perms = g?.permissions?.length ? g.permissions : g ? [g.permission] : []
  if (!g || !perms.includes(permission) || g.userId !== userId) return { status: "none" }
  if (Date.parse(g.expiresAt) < Date.now()) { grants.delete(k); return { status: "none" } }
  if (command !== undefined && g.command !== undefined && !sameCommand(command, g.command)) { grants.delete(k); return { status: "changed" } }
  return { status: "ok", grant: g }
}

/** A current grant for this record and permission (see approvalGrantStatus). */
export function approvalGrantFor(entity: string, action: string, recordId: string | undefined | null, permission: string, userId: string | null, command?: unknown): ApprovalGrant | null {
  const s = approvalGrantStatus(entity, action, recordId, permission, userId, command)
  return s.status === "ok" ? s.grant : null
}

/** The grant an operation for this record carries; removed from the register once attached. */
export function takeApprovalGrant(entity: string, action: string, recordId: string | undefined | null): ApprovalGrant | null {
  if (!recordId) return null
  const k = key(entity, action, recordId)
  const g = grants.get(k) ?? null
  grants.delete(k)
  return g
}

export function dropApprovalGrant(entity: string, action: string, recordId: string) { grants.delete(key(entity, action, recordId)) }

/** The register locked, restarted or changed person: unused approvals are gone. Returns their ids. */
export function clearApprovalGrants(): string[] {
  const ids = [...grants.values()].map((g) => g.approvalId)
  grants.clear()
  return ids
}

export const pendingApprovalCount = () => grants.size

// SPRINT-2 E: manager approvals this register received for the person signed in now. In memory only:
// an approval never survives a restart, a lock or a change of person (clearApprovalGrants). Each grant
// is for one record (entity, action, record id) and one permission; the server bound it to the record's
// values and checks it again when the operation arrives. No imports (deviceCredentials uses it).

export type ApprovalGrant = {
  approvalId: string
  entity: string
  action: string
  recordId: string
  permission: string
  approverName: string
  expiresAt: string
  /** The person signed in when the manager approved (the actor; never the manager). */
  userId: string | null
}

const grants = new Map<string, ApprovalGrant>()
const key = (entity: string, action: string, recordId: string) => `${entity}:${action}:${recordId}`

export function addApprovalGrant(g: ApprovalGrant) { grants.set(key(g.entity, g.action, g.recordId), g) }

/** A current grant for this record and permission, for the person signed in now. */
export function approvalGrantFor(entity: string, action: string, recordId: string | undefined | null, permission: string, userId: string | null): ApprovalGrant | null {
  if (!recordId) return null
  const g = grants.get(key(entity, action, recordId))
  if (!g || g.permission !== permission || g.userId !== userId) return null
  if (Date.parse(g.expiresAt) < Date.now()) { grants.delete(key(entity, action, recordId)); return null }
  return g
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

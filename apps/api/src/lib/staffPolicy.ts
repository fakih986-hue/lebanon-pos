/**
 * SPRINT-2 hub batch: the store's staff-identity policy — what it is, who issued it, and how a hub keeps it.
 *
 * Modes (Tenant.staffSessionMode):
 *  - "observe"           every store's default: evidence is recorded; authority is the connection account.
 *  - "enforce-checkout"  (earlier, partial) register SALES need an enrolled device and a server-checked
 *                        staff session; every other operation is still authorized as the connection account.
 *  - "enforce"           every operation a register sends (sync) and every permission check a register
 *                        makes (REST) is authorized as the person of a server-checked staff session on an
 *                        enrolled device. The device's connection token carries no personal authority.
 *                        Deferred (not covered, stated): the ordering app's customer tokens and the driver
 *                        app (their own token kinds and routes), and the hub's localhost setup routes.
 *
 * Issued only at the cloud, by an explicit, audited decision of a person holding settings.manage; each
 * change gets the next version. A hub adopts the cloud's policy from its pull when the version is HIGHER
 * than the one it holds; it keeps the last adopted policy in its own database, so a hub that cannot reach
 * the cloud, restarts, or receives no policy keeps enforcing — nothing is lowered silently. Lowering
 * (back to observe) is itself an explicit, versioned decision at the cloud.
 */
import prisma from "./prisma.js"

export type StaffMode = "observe" | "enforce-checkout" | "enforce"
export type StaffPolicy = { mode: StaffMode; version: number; issuedAt: string | null; issuedBy: string | null }

/** Registers and hubs at this sync schema understand "enforce" (platform-wide staff enforcement). */
export const ENFORCE_SCHEMA = 5

export const asMode = (v: unknown): StaffMode => (v === "enforce" || v === "enforce-checkout" ? v : "observe")
/** Every register operation and permission check is the session person's. */
export const enforcesAll = (mode: StaffMode) => mode === "enforce"
/** Register sales need the session (both enforcing modes). */
export const enforcesCheckout = (mode: StaffMode) => mode === "enforce" || mode === "enforce-checkout"

export async function storePolicy(tenantId: string): Promise<StaffPolicy> {
  const t = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { staffSessionMode: true, staffPolicyVersion: true, staffPolicyIssuedAt: true, staffPolicyIssuedBy: true } })
  return { mode: asMode(t?.staffSessionMode), version: t?.staffPolicyVersion ?? 0, issuedAt: t?.staffPolicyIssuedAt?.toISOString() ?? null, issuedBy: t?.staffPolicyIssuedBy ?? null }
}

/** The cloud records a new policy (the next version), only if the store is still at `expectedVersion`
 *  (the version the deciding person looked at); null when someone else decided in between. */
export async function issuePolicy(tenantId: string, mode: StaffMode, by: string, expectedVersion: number): Promise<StaffPolicy | null> {
  const n = await prisma.tenant.updateMany({ where: { id: tenantId, staffPolicyVersion: expectedVersion }, data: { staffSessionMode: mode, staffPolicyVersion: { increment: 1 }, staffPolicyIssuedAt: new Date(), staffPolicyIssuedBy: by } })
  return n.count === 1 ? storePolicy(tenantId) : null
}

/**
 * A hub adopts the policy its cloud sent, only when it is a newer version. Returns what happened.
 * An absent, malformed or older policy changes nothing (a hub never falls back to observe on its own).
 */
export async function adoptPolicy(tenantId: string, incoming: unknown): Promise<"adopted" | "kept"> {
  const p = incoming as Partial<StaffPolicy> | null | undefined
  if (!p || typeof p !== "object" || !Number.isInteger(p.version) || (p.mode !== "observe" && p.mode !== "enforce-checkout" && p.mode !== "enforce")) return "kept"
  const current = await storePolicy(tenantId)
  if ((p.version as number) <= current.version) return "kept"
  await prisma.tenant.update({ where: { id: tenantId }, data: { staffSessionMode: p.mode, staffPolicyVersion: p.version as number, staffPolicyIssuedAt: p.issuedAt ? new Date(p.issuedAt) : new Date(), staffPolicyIssuedBy: p.issuedBy ?? null } })
  await prisma.auditEvent.create({ data: {
    tenantId, action: "security.staff_policy.adopted", entity: "settings",
    summary: `This hub adopted the store's staff policy version ${p.version}: ${p.mode} (was version ${current.version}: ${current.mode})`,
    metadata: { before: current, after: p } as any, userId: "__system__", userName: "Sync", userRole: "Admin",
  } as any }).catch(() => undefined)
  return "adopted"
}

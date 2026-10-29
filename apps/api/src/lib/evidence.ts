/**
 * SPRINT-2 Phase B — operation evidence in OBSERVE mode.
 *
 * For every operation it applies, the receiving server records what it actually knows, separately
 * from what the client claims. Nothing changes the outcome of an operation here.
 *
 * Evidence labels (kept distinct — docs/SPRINT-2-PLAN.md §2.3):
 *  - "verified"        a server-issued staff session for this device proves the actor (Phase C; never
 *                      produced in observe mode)
 *  - "hub-attested"    an enrolled hub signed that it verified the actor (Phase D; never produced here)
 *  - "offline-claimed" the client says it was done offline under a local PIN check; unverifiable
 *  - "legacy-claimed"  everything else: the pushing token proves only the CONNECTING account (or a
 *                      store-level relay); the acting staff member is whatever the payload names
 */
import type { TokenKind } from "../middleware/auth.js"

export type EvidenceLabel = "verified" | "hub-attested" | "offline-claimed" | "legacy-claimed"

/** The staff member an operation's payload names as acting (client-written: a CLAIM). */
export function claimedActor(entity: string, action: string, payload: unknown): { id: string | null; name: string | null } {
  const p = (payload ?? {}) as Record<string, unknown>
  const str = (k: string) => (typeof p[k] === "string" && p[k] ? (p[k] as string) : null)
  switch (entity) {
    case "sale":
    case "refund": return { id: str("cashierId"), name: str("cashier") }
    case "shift": return action === "close" ? { id: str("closedById"), name: str("closedByName") } : { id: str("openedById"), name: str("openedByName") }
    case "cash-movement": return { id: str("recordedById"), name: str("recordedByName") }
    case "expense": return { id: str("recordedById"), name: str("recordedBy") }
    case "daily-close": return { id: str("closedById"), name: str("closedBy") }
    case "supplier-payment": return { id: str("recordedById"), name: str("recordedBy") }
    case "purchase-order": return { id: str("createdById"), name: str("createdBy") }
    default: return { id: null, name: null }
  }
}

/** How the request reached this server. Plain HTTP on a LAN gives no confidentiality or integrity. */
export function transportOf(req: { headers?: Record<string, unknown>; socket?: { remoteAddress?: string; encrypted?: boolean } }): "https" | "http-lan" | "localhost" | "unknown" {
  const proto = String(req.headers?.["x-forwarded-proto"] ?? "").split(",")[0].trim()
  if (proto === "https" || req.socket?.encrypted) return "https"
  const addr = req.socket?.remoteAddress ?? ""
  if (addr === "127.0.0.1" || addr === "::1" || addr === "::ffff:127.0.0.1") return "localhost"
  if (addr) return "http-lan"
  return "unknown"
}

export type ObserveInput = {
  opId: string; tenantId: string; entity: string; action: string; payload: unknown
  kind: TokenKind; accountId: string | null; deviceId: string | null
  transport: ReturnType<typeof transportOf>; acceptedBy: "cloud" | "hub"
  envelope?: { v?: unknown; offline?: unknown } | null
}

/** The evidence row for one applied operation (observe mode). */
export function observeEvidence(i: ObserveInput) {
  const actor = claimedActor(i.entity, i.action, i.payload)
  const p = (i.payload ?? {}) as Record<string, unknown>
  const claimedAt = typeof p.createdAt === "string" ? p.createdAt : null
  const offline = i.envelope?.offline === true
  const limitations: string[] = []
  if (i.kind === "staff") {
    limitations.push("connection-account-not-proven-actor")
    if (actor.id && i.accountId && actor.id !== i.accountId) limitations.push("actor-differs-from-connection-account")
  }
  if (i.kind === "hub-local") limitations.push("pushed-by-hub-screen-store-account")
  if (i.kind === "bridge") limitations.push("relayed-by-hub-without-attestation")
  if (!actor.id) limitations.push(actor.name ? "actor-named-without-id" : "no-actor-recorded")
  if (offline) limitations.push("offline-local-pin-claimed")
  if (i.transport === "http-lan") limitations.push("transport-http-lan-unencrypted")
  if (i.deviceId) limitations.push("device-id-claimed")
  if (claimedAt) limitations.push("client-time-claimed")
  const evidence: EvidenceLabel = offline ? "offline-claimed" : "legacy-claimed"
  return {
    opId: i.opId, tenantId: i.tenantId, entity: i.entity, action: i.action,
    acceptedBy: i.acceptedBy, transport: i.transport, credentialKind: i.kind,
    connectionAccountId: i.kind === "staff" ? i.accountId : null,
    deviceIdClaimed: i.deviceId, actorIdClaimed: actor.id, actorNameClaimed: actor.name,
    actorMatchesAccount: i.kind === "staff" && actor.id && i.accountId ? actor.id === i.accountId : null,
    evidence, limitations, claimedAt,
    envelopeVersion: Number.isInteger(Number(i.envelope?.v)) ? Number(i.envelope?.v) : 0,
  }
}

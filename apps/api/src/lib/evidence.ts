/**
 * SPRINT-2 Phase B — operation evidence in OBSERVE mode.
 *
 * For every operation it applies, the receiving server records what it actually knows, separately
 * from what the client claims. Nothing changes the outcome of an operation here.
 *
 * Evidence labels (kept distinct — docs/SPRINT-2-PLAN.md §2.3):
 *  - "verified"        ENFORCED (a store in enforce-checkout mode): this server required and checked a
 *                      current staff session for this enrolled device, and authorized the operation
 *                      as that person. Still: the PIN was checked when the session started, and the
 *                      device credential is a bearer token. Never produced in observe mode.
 *  - "staff-session"   observe mode (Phase C): the request carried this store's valid device
 *                      credential and a staff session this server opened for that device after
 *                      checking the person's PIN. Not enforced; the PIN was checked when the session
 *                      started, not for this operation; the device credential is a bearer token
 *  - "hub-attested"    an enrolled hub of this store signed the command and its own evidence, which was
 *                      a staff session it checked (Phase D). The hub vouched; not independent proof
 *                      that a person entered a PIN
 *  - "offline-claimed" the client says it was done offline under a local PIN check; unverifiable
 *  - "legacy-claimed"  everything else: the pushing token proves only the CONNECTING account (or a
 *                      store-level relay); the acting staff member is whatever the payload names
 */
import type { TokenKind } from "../middleware/auth.js"
import type { DeviceCheck, SessionResult } from "./credentials.js"
import type { AttestationResult } from "./hubAttestation.js"

export type EvidenceLabel = "verified" | "hub-attested" | "staff-session" | "offline-claimed" | "legacy-claimed"

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
  /** SPRINT-2 C: the device credential and staff session checks (absent for a hub's cloud link). */
  device?: { check: DeviceCheck; deviceId: string | null } | null
  session?: SessionResult | null
  /** SPRINT-2 C: the evidence the relaying hub recorded (claimed until hubs attest, Phase D). */
  relayed?: Record<string, unknown> | null
  /** The store enforced the session for this operation (the actor was derived from it). */
  enforced?: boolean
  /** SPRINT-2 D: the relaying hub's attestation as checked here (a hub's cloud link only). */
  attestation?: AttestationResult | null
}

/** Fields of a hub's own evidence row that are carried to the cloud with a forwarded operation. */
export const RELAYED_FIELDS = ["acceptedBy", "receivedAt", "transport", "credentialKind", "connectionAccountId", "deviceIdClaimed", "enrolledDeviceId", "deviceCheck", "sessionId", "sessionStaffId", "sessionAuthTime", "sessionCheck", "actorIdClaimed", "actorNameClaimed", "evidence", "limitations", "claimedAt"] as const
export function pickRelayed(row: unknown): Record<string, unknown> | null {
  if (!row || typeof row !== "object" || Array.isArray(row)) return null
  const out: Record<string, unknown> = {}
  for (const k of RELAYED_FIELDS) {
    const v = (row as Record<string, unknown>)[k]
    if (v === undefined) continue
    out[k] = v instanceof Date ? v.toISOString() : v
  }
  return JSON.stringify(out).length <= 8192 ? out : null
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
  const att = i.kind === "bridge" ? (i.attestation ?? { check: "absent" as const, kid: null, srv: null }) : null
  if (att && att.check !== "valid") limitations.push("relayed-by-hub-without-attestation", `hub-attestation-${att.check}`)
  if (att?.check === "valid") limitations.push("hub-vouched-not-independent-pin-proof")
  if (!actor.id) limitations.push(actor.name ? "actor-named-without-id" : "no-actor-recorded")
  if (offline) limitations.push("offline-local-pin-claimed")
  if (i.transport === "http-lan") limitations.push("transport-http-lan-unencrypted")
  if (i.deviceId) limitations.push("device-id-claimed")
  if (claimedAt) limitations.push("client-time-claimed")
  const dev = i.device ?? null, ses = i.session ?? null
  if (dev && dev.check !== "absent" && dev.check !== "valid") limitations.push(`device-credential-${dev.check}`)
  if (ses && ses.check !== "absent" && ses.check !== "valid") limitations.push(`staff-session-${ses.check}`)
  const sessionHeld = dev?.check === "valid" && ses?.check === "valid"
  if (sessionHeld) {
    limitations.push(i.enforced ? "actor-derived-from-session" : "observe-mode-not-enforced", "pin-checked-at-session-start-not-per-operation", "device-credential-bearer")
    if (ses!.expired) limitations.push("session-expired-at-receipt")
    if (ses!.ended) limitations.push("session-ended-before-receipt")
  }
  if (ses?.staffId && actor.id && ses.staffId !== actor.id && ses.check !== "invalid") limitations.push("claimed-actor-differs-from-session")
  // what the hub recorded: as it signed it when the attestation verified, otherwise as it sent it
  const relayed = att ? pickRelayed(att.check === "valid" ? att.srv : i.relayed) : null
  if (relayed && att?.check !== "valid") limitations.push("hub-evidence-unattested")
  // a valid attestation keeps the hub's own label: a client's claim stays a claim
  const hubLabel = att?.check === "valid" && relayed ? String(relayed.evidence ?? "") : null
  const current = sessionHeld && !ses!.expired && !ses!.ended
  const evidence: EvidenceLabel = hubLabel !== null
    ? (hubLabel === "verified" || hubLabel === "staff-session" ? "hub-attested" : hubLabel === "offline-claimed" ? "offline-claimed" : "legacy-claimed")
    : sessionHeld && !offline ? (i.enforced && current ? "verified" : "staff-session") : offline ? "offline-claimed" : "legacy-claimed"
  return {
    opId: i.opId, tenantId: i.tenantId, entity: i.entity, action: i.action,
    acceptedBy: i.acceptedBy, transport: i.transport, credentialKind: i.kind,
    connectionAccountId: i.kind === "staff" ? i.accountId : null,
    deviceIdClaimed: i.deviceId, actorIdClaimed: actor.id, actorNameClaimed: actor.name,
    actorMatchesAccount: i.kind === "staff" && actor.id && i.accountId ? actor.id === i.accountId : null,
    evidence, limitations, claimedAt,
    envelopeVersion: Number.isInteger(Number(i.envelope?.v)) ? Number(i.envelope?.v) : 0,
    enrolledDeviceId: dev?.deviceId ?? null, deviceCheck: dev?.check ?? null,
    sessionId: ses?.sessionId ?? null, sessionStaffId: ses?.staffId ?? null, sessionAuthTime: ses?.authTime ?? null, sessionCheck: ses?.check ?? null,
    relayed,
    attestation: att?.check ?? null, attestationKid: att?.kid ?? null,
  }
}

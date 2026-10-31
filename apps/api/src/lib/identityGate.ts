/**
 * SPRINT-2: the activation gate for enforce-checkout. A store may only switch enforcement on when
 * every client that still trades with it is inside the enforcement boundary:
 *  - direct-to-cloud registers only: a hub's cloud link forwards work the cloud cannot attribute to
 *    a verified person (hub attestation is Phase D), so a store with an active hub is refused, and
 *    enforcement can never be switched on on a hub server;
 *  - every register is upgraded (sync schema >= IDENTITY_SCHEMA: it sends its device credential and
 *    the staff session each operation was made under) and is an enrolled, approved device;
 *  - "still trades" = pushed within the same window and with the same retirement rule the Sprint 1
 *    upgrade gate uses (the owner retires clients that no longer trade; audited).
 * The server refuses the switch while any blocker remains; a warning is not enough.
 */
import prisma from "./prisma.js"
import { POLICY_GATE_WINDOW_DAYS } from "./policyGate.js"

/** Registers at this sync schema send x-device-credential and per-operation session evidence. */
export const IDENTITY_SCHEMA = 4

export type IdentityBlocker = { id: string; label: string; reason: "hub-link" | "upgrade-needed" | "not-enrolled" | "no-device-id"; syncSchema: number; lastSeenAt: string }

export const isHubServer = () => ["true", "1"].includes(process.env.IS_LOCAL_SERVER || "")

export async function identityGateBlockers(tenantId: string): Promise<IdentityBlocker[]> {
  const since = new Date(Date.now() - POLICY_GATE_WINDOW_DAYS * 86_400_000)
  const clients = await prisma.syncClient.findMany({ where: { tenantId, retiredAt: null, lastSeenAt: { gte: since } }, orderBy: { lastSeenAt: "desc" } })
  const out: IdentityBlocker[] = []
  for (const c of clients) {
    const base = { id: c.id, label: c.label, syncSchema: c.syncSchema, lastSeenAt: c.lastSeenAt.toISOString() }
    if (c.clientKey.startsWith("hub-bridge@")) { out.push({ ...base, reason: "hub-link" }); continue }
    if (!c.clientKey.startsWith("device:")) { out.push({ ...base, reason: "no-device-id" }); continue }
    if (c.syncSchema < IDENTITY_SCHEMA) { out.push({ ...base, reason: "upgrade-needed" }); continue }
    const device = await prisma.device.findUnique({ where: { tenantId_deviceId: { tenantId, deviceId: c.clientKey.slice("device:".length) } }, select: { status: true, enrolledAt: true, credentialVersion: true } })
    if (!device || device.status !== "APPROVED" || !device.enrolledAt || device.credentialVersion < 1) out.push({ ...base, reason: "not-enrolled" })
  }
  return out
}

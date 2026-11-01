/**
 * SPRINT-2: the activation gate for enforce-checkout. A store may only switch enforcement on when
 * every client that still trades with it is inside the enforcement boundary:
 *  - direct-to-cloud registers only: a hub's cloud link forwards work the cloud cannot attribute to
 *    a verified person (hub attestation is Phase D), so a store with an active hub is refused, and
 *    enforcement can never be switched on on a hub server;
 *  - every register is upgraded (sync schema >= IDENTITY_SCHEMA: it sends its device credential and
 *    the staff session each operation was made under) and is an enrolled, approved device;
 *  - and this server OBSERVED it doing so: within the window it received operations from that register
 *    with a valid device credential and a valid staff session, its latest one included. A version
 *    header and recent activity alone are claims (SPRINT-2 Part 5);
 *  - "still trades" = pushed within the same window and with the same retirement rule the Sprint 1
 *    upgrade gate uses (the owner retires clients that no longer trade; audited).
 * The server refuses the switch while any blocker remains; a warning is not enough.
 */
import prisma from "./prisma.js"
import { POLICY_GATE_WINDOW_DAYS } from "./policyGate.js"

/** Registers at this sync schema send x-device-credential and per-operation session evidence. */
export const IDENTITY_SCHEMA = 4

export type IdentityBlocker = { id: string; label: string; reason: "hub-link" | "upgrade-needed" | "not-enrolled" | "no-device-id" | "no-identity-evidence"; syncSchema: number; lastSeenAt: string }

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
    if (!device || device.status !== "APPROVED" || !device.enrolledAt || device.credentialVersion < 1) { out.push({ ...base, reason: "not-enrolled" }); continue }
    // observed capability: its operations in the window carried a valid device credential and session
    const deviceId = c.clientKey.slice("device:".length)
    const latest = await prisma.operationEvidence.findFirst({ where: { tenantId, deviceIdClaimed: deviceId, receivedAt: { gte: since } }, orderBy: { receivedAt: "desc" }, select: { deviceCheck: true, sessionCheck: true } })
    if (!latest || latest.deviceCheck !== "valid" || latest.sessionCheck !== "valid") out.push({ ...base, reason: "no-identity-evidence" })
  }
  return out
}

/**
 * SPRINT-2 hub batch: the activation gate for "enforce" (every register operation authorized as the staff
 * session's person; hubs forwarding with their signature). Unlike the window above, an activity window is
 * not taken as proof: EVERY client this store has ever seen counts until the owner retires it, and every
 * approved device must be enrolled even if it never synced. Supported topologies: registers connected to
 * the cloud, and registers behind an enrolled hub. Checked:
 *  - each register: sync schema >= ENFORCE_SCHEMA (it understands enforcement), enrolled, and observed
 *    sending a valid device credential and staff session with its latest operation;
 *  - each hub link: schema >= ENFORCE_SCHEMA, an active hub key enrolled for this store, and its latest
 *    forwarded operation carrying a valid signature; an older link the upgraded one replaced is not counted;
 *  - registers seen only through a hub: their latest forwarded operation, as the hub signed it, had a valid
 *    device credential and staff session.
 * Registers that never sent anything cannot be observed: once enforcement is on, they are inside the
 * boundary or refused at it (their completed work kept for review) — never served in observe mode.
 */
export type EnforceBlocker = { id: string; label: string; reason: "upgrade-needed" | "not-enrolled" | "no-device-id" | "no-identity-evidence" | "device-not-enrolled" | "hub-upgrade-needed" | "hub-not-enrolled" | "hub-unattested" | "hub-register-unverified"; syncSchema: number | null; lastSeenAt: string | null }
export async function enforceGateBlockers(tenantId: string): Promise<EnforceBlocker[]> {
  const { ENFORCE_SCHEMA } = await import("./staffPolicy.js")
  const out: EnforceBlocker[] = []
  const clients = await prisma.syncClient.findMany({ where: { tenantId, retiredAt: null }, orderBy: { lastSeenAt: "desc" } })
  const newestCapableHub = clients.find((c) => c.clientKey.startsWith("hub-bridge@") && c.syncSchema >= ENFORCE_SCHEMA)
  const seenDevices = new Set<string>()
  for (const c of clients) {
    const base = { id: c.id, label: c.label, syncSchema: c.syncSchema, lastSeenAt: c.lastSeenAt.toISOString() }
    if (c.clientKey.startsWith("hub-bridge@")) {
      if (c.syncSchema < ENFORCE_SCHEMA) {
        // the same hub before its upgrade: its newer link has been seen since it last forwarded
        if (newestCapableHub && newestCapableHub.lastSeenAt > c.lastSeenAt) continue
        out.push({ ...base, reason: "hub-upgrade-needed" }); continue
      }
      const key = await prisma.hubKey.findFirst({ where: { tenantId, status: "ACTIVE" }, select: { kid: true } })
      if (!key) { out.push({ ...base, reason: "hub-not-enrolled" }); continue }
      const latest = await prisma.operationEvidence.findFirst({ where: { tenantId, credentialKind: "bridge" }, orderBy: { receivedAt: "desc" }, select: { attestation: true } })
      if (!latest || latest.attestation !== "valid") out.push({ ...base, reason: "hub-unattested" })
      continue
    }
    if (!c.clientKey.startsWith("device:")) { out.push({ ...base, reason: "no-device-id" }); continue }
    const deviceId = c.clientKey.slice("device:".length)
    seenDevices.add(deviceId)
    if (c.syncSchema < ENFORCE_SCHEMA) { out.push({ ...base, reason: "upgrade-needed" }); continue }
    const device = await prisma.device.findUnique({ where: { tenantId_deviceId: { tenantId, deviceId } }, select: { status: true, enrolledAt: true, credentialVersion: true } })
    if (!device || device.status !== "APPROVED" || !device.enrolledAt || device.credentialVersion < 1) { out.push({ ...base, reason: "not-enrolled" }); continue }
    const latest = await prisma.operationEvidence.findFirst({ where: { tenantId, deviceIdClaimed: deviceId, credentialKind: { not: "bridge" } }, orderBy: { receivedAt: "desc" }, select: { deviceCheck: true, sessionCheck: true } })
    if (!latest || latest.deviceCheck !== "valid" || latest.sessionCheck !== "valid") out.push({ ...base, reason: "no-identity-evidence" })
  }
  // approved devices that never synced with this server: they must still be enrolled
  for (const d of await prisma.device.findMany({ where: { tenantId, status: "APPROVED" }, select: { id: true, deviceId: true, deviceName: true, enrolledAt: true, credentialVersion: true, lastSeenAt: true } })) {
    if (seenDevices.has(d.deviceId)) continue
    if (!d.enrolledAt || d.credentialVersion < 1) out.push({ id: d.id, label: d.deviceName || d.deviceId, reason: "device-not-enrolled", syncSchema: null, lastSeenAt: d.lastSeenAt?.toISOString() ?? null })
  }
  // registers seen through a hub: as the hub signed their latest operation
  const forwarded = await prisma.operationEvidence.findMany({ where: { tenantId, credentialKind: "bridge", attestation: "valid" }, orderBy: { receivedAt: "desc" }, take: 5000, select: { relayed: true } })
  const latestByDevice = new Map<string, Record<string, unknown>>()
  for (const e of forwarded) {
    const r = (e.relayed ?? {}) as Record<string, unknown>
    const id = typeof r.enrolledDeviceId === "string" ? r.enrolledDeviceId : typeof r.deviceIdClaimed === "string" ? r.deviceIdClaimed : null
    if (id && !latestByDevice.has(id)) latestByDevice.set(id, r)
  }
  for (const [id, r] of latestByDevice) if (r.deviceCheck !== "valid" || r.sessionCheck !== "valid") out.push({ id, label: `register ${id} (through the hub)`, reason: "hub-register-unverified", syncSchema: null, lastSeenAt: typeof r.receivedAt === "string" ? r.receivedAt : null })
  return out
}

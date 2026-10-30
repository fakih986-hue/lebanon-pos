/**
 * SPRINT-2 Phase C — device credentials and staff sessions (observe mode).
 *
 * Two credentials, both JWS (HS256 via jsonwebtoken) under a key DERIVED from the server secret
 * with HKDF, so neither can ever pass as a connection token (requireAuth verifies with the plain
 * secret) and a connection token can never pass as either:
 *  - device credential  (aud titan:device)        — this server enrolled this device record. Bearer
 *    only: on plain-HTTP LAN it is visible to the network. It says nothing about who uses the device.
 *  - staff session      (aud titan:staff-session) — this server checked this staff member's PIN for
 *    this device at auth_time. It says nothing about who is present later.
 * Both are checked against the database on every use (device status/version, session ended, staff
 * active/tokenVersion), so revocation is immediate. Nothing here refuses an operation: the push
 * handler only records what was checked (docs/SPRINT-2-PLAN.md §2.2).
 */
import { hkdfSync, randomUUID } from "node:crypto"
import jwt from "jsonwebtoken"
import prisma from "./prisma.js"

const DEVICE_AUD = "titan:device"
const SESSION_AUD = "titan:staff-session"
/**
 * Staff session lifetime. PROVISIONAL (decision D8 in docs/SPRINT-2-PLAN.md): in observe mode an
 * expired session changes nothing except the recorded check.
 */
export const STAFF_SESSION_HOURS = 12

function key(): Buffer {
  const secret = process.env.JWT_SECRET
  if (!secret) throw new Error("JWT_SECRET is not set")
  return Buffer.from(hkdfSync("sha256", secret, "titan-pos", "sprint2:device-and-staff-session-credentials:v1", 32))
}
/** The issuing server: a hub issues for its own LAN tills and screen, the cloud for direct tills. */
export function issuer(): string { return ["true", "1"].includes(process.env.IS_LOCAL_SERVER || "") ? "titan-hub" : "titan-cloud" }

export type DeviceClaims = { sub: string; tid: string; ver: number }
export type SessionClaims = { sub: string; tid: string; dev: string; av: number; sid: string; auth_time: number; amr: string[] }

export function signDeviceCredential(c: DeviceClaims): string {
  return jwt.sign({ typ: "device", tid: c.tid, ver: c.ver }, key(), { algorithm: "HS256", audience: DEVICE_AUD, issuer: issuer(), subject: c.sub })
}

export function signStaffSession(c: Omit<SessionClaims, "amr" | "auth_time"> & { authTime: Date; expiresAt: Date }): string {
  return jwt.sign(
    { typ: "staff-session", tid: c.tid, dev: c.dev, av: c.av, sid: c.sid, auth_time: Math.floor(c.authTime.getTime() / 1000), amr: ["pin"], exp: Math.floor(c.expiresAt.getTime() / 1000) },
    key(), { algorithm: "HS256", audience: SESSION_AUD, issuer: issuer(), subject: c.sub },
  )
}

function verify<T>(token: string, audience: string, ignoreExpiration = false): T | null {
  try { return jwt.verify(token, key(), { algorithms: ["HS256"], audience, issuer: issuer(), ignoreExpiration }) as T } catch { return null }
}

export type DeviceCheck = "valid" | "absent" | "invalid" | "revoked" | "superseded" | "other-store"
/** Checks a presented device credential against this store's device records. */
export async function checkDevice(token: string | undefined, tenantId: string): Promise<{ check: DeviceCheck; deviceId: string | null; name?: string }> {
  if (!token) return { check: "absent", deviceId: null }
  const c = verify<DeviceClaims & { typ?: string }>(token, DEVICE_AUD)
  if (!c || c.typ !== "device" || !c.sub) return { check: "invalid", deviceId: null }
  if (c.tid !== tenantId) return { check: "other-store", deviceId: c.sub }
  const d = await prisma.device.findFirst({ where: { id: c.sub, tenantId }, select: { status: true, credentialVersion: true, deviceName: true } })
  if (!d) return { check: "invalid", deviceId: c.sub }
  if (d.status !== "APPROVED") return { check: "revoked", deviceId: c.sub, name: d.deviceName }
  if (d.credentialVersion !== c.ver) return { check: "superseded", deviceId: c.sub, name: d.deviceName }
  return { check: "valid", deviceId: c.sub, name: d.deviceName }
}

export type SessionCheck = "valid" | "absent" | "invalid" | "other-device" | "other-store" | "no-device" | "staff-inactive" | "staff-revoked"
export type SessionResult = { check: SessionCheck; sessionId: string | null; staffId: string | null; authTime: Date | null; expired: boolean; ended: boolean }

/**
 * Checks a presented staff session for an operation received from `deviceId` (the enrolled device
 * whose credential came with the request, or null). Expiry and an ended session are reported, not
 * failed: queued work completed during a session may arrive after it ended.
 */
export async function checkSession(token: string | undefined, tenantId: string, deviceId: string | null): Promise<SessionResult> {
  const none = { sessionId: null, staffId: null, authTime: null, expired: false, ended: false }
  if (!token) return { check: "absent", ...none }
  const c = verify<SessionClaims & { typ?: string; exp?: number }>(token, SESSION_AUD, true)
  if (!c || c.typ !== "staff-session" || !c.sub || !c.sid) return { check: "invalid", ...none }
  const base = { sessionId: c.sid, staffId: c.sub, authTime: new Date(c.auth_time * 1000), expired: typeof c.exp === "number" && c.exp * 1000 < Date.now(), ended: false }
  if (c.tid !== tenantId) return { check: "other-store", ...base }
  const row = await prisma.staffSession.findFirst({ where: { id: c.sid, tenantId }, select: { deviceId: true, staffId: true, endedAt: true } })
  if (!row || row.staffId !== c.sub || row.deviceId !== c.dev) return { check: "invalid", ...base }
  base.ended = row.endedAt != null
  if (!deviceId) return { check: "no-device", ...base }
  if (c.dev !== deviceId) return { check: "other-device", ...base }
  const staff = await prisma.staffUser.findFirst({ where: { id: c.sub, tenantId }, select: { active: true, tokenVersion: true } })
  if (!staff || !staff.active) return { check: "staff-inactive", ...base }
  if ((staff.tokenVersion ?? 0) !== c.av) return { check: "staff-revoked", ...base }
  return { check: "valid", ...base }
}

/** Opens a session for `staffId` on `deviceId`, ending the device's previous open session. */
export async function openStaffSession(tenantId: string, deviceId: string, staff: { id: string; tokenVersion: number | null }) {
  const now = new Date()
  const expiresAt = new Date(now.getTime() + STAFF_SESSION_HOURS * 3600_000)
  const sid = randomUUID()
  await prisma.$transaction([
    prisma.staffSession.updateMany({ where: { tenantId, deviceId, endedAt: null }, data: { endedAt: now, endReason: "switched" } }),
    prisma.staffSession.create({ data: { id: sid, tenantId, deviceId, staffId: staff.id, authTime: now, expiresAt } }),
  ])
  const token = signStaffSession({ sub: staff.id, tid: tenantId, dev: deviceId, av: staff.tokenVersion ?? 0, sid, authTime: now, expiresAt })
  return { token, sessionId: sid, authTime: now, expiresAt }
}

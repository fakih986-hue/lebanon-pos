/**
 * SPRINT-2 Phase D — hub attestation (docs/SPRINT-2-PLAN.md §2.5).
 *
 * A hub signs, when it forwards an operation, the operation's identity (id, entity, action and the
 * digest of its business command) together with the evidence the hub itself recorded when it accepted
 * it. ES256 JWS via jsonwebtoken; the hub's private key never leaves its data folder; the cloud holds
 * the public key, enrolled by an owner-authorized request (routes/hubKeys.ts).
 *
 * What a valid attestation proves: an enrolled hub of this store vouched for this exact command and
 * for what it recorded about who did it. It does NOT prove that a person entered a PIN — a compromised
 * hub can attest anything for its own store. A client's claim stays a claim: the hub signs the label
 * it recorded ("offline-claimed" stays "offline-claimed").
 */
import { generateKeyPairSync, randomUUID } from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import jwt from "jsonwebtoken"
import prisma from "./prisma.js"
import { dataDir } from "./dataDir.js"

const KEY_FILE = "hub-signing-key.json"
const ISSUER = "titan-hub"
export const attestationAudience = (tenantId: string) => `titan-cloud:${tenantId}`

export type HubKeyFile = { kid: string; privatePem: string; publicPem: string; createdAt: string; enrolledAt?: string; tenantId?: string }

function keyPath() { return path.join(dataDir(), KEY_FILE) }

/** This hub's current signing key, or null. */
export function readHubKey(): HubKeyFile | null {
  try { return JSON.parse(fs.readFileSync(keyPath(), "utf-8")) as HubKeyFile } catch { return null }
}

/** A new key pair for this hub (rotation); not trusted anywhere until the owner enrolls it. */
export function createHubKey(): HubKeyFile {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" })
  const key: HubKeyFile = {
    kid: `hub-${randomUUID()}`,
    privatePem: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    publicPem: publicKey.export({ type: "spki", format: "pem" }).toString(),
    createdAt: new Date().toISOString(),
  }
  fs.mkdirSync(dataDir(), { recursive: true, mode: 0o700 })
  const tmp = `${keyPath()}.${process.pid}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(key, null, 2), { mode: 0o600 })
  fs.renameSync(tmp, keyPath())
  return key
}

/** Puts back the key file as it was (a failed enrollment must not leave the hub without its key). */
export function restoreHubKey(previous: HubKeyFile | null): void {
  if (!previous) { try { fs.rmSync(keyPath(), { force: true }) } catch { /* nothing to remove */ } return }
  const tmp = `${keyPath()}.${process.pid}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(previous, null, 2), { mode: 0o600 })
  fs.renameSync(tmp, keyPath())
}

export function markHubKeyEnrolled(kid: string, tenantId: string): void {
  const key = readHubKey()
  if (!key || key.kid !== kid) return
  const tmp = `${keyPath()}.${process.pid}.tmp`
  fs.writeFileSync(tmp, JSON.stringify({ ...key, enrolledAt: new Date().toISOString(), tenantId }, null, 2), { mode: 0o600 })
  fs.renameSync(tmp, keyPath())
}

export type AttestedOp = { id: string; entity: string; action: string; digest: string }

/** The hub's signature over one forwarded operation (null when this hub has no enrolled key). */
export function signAttestation(tenantId: string, op: AttestedOp, srv: Record<string, unknown> | null): string | null {
  const key = readHubKey()
  if (!key?.enrolledAt || key.tenantId !== tenantId) return null
  return jwt.sign({ typ: "hub-attestation", tid: tenantId, op, srv: srv ?? null }, key.privatePem, {
    algorithm: "ES256", keyid: key.kid, issuer: ISSUER, audience: attestationAudience(tenantId), expiresIn: "30d",
  })
}

/** The hub's signed status report (lib/topology.ts): its queue, held work, stock and versions. */
export function signHubReport(tenantId: string, report: Record<string, unknown>): string | null {
  const key = readHubKey()
  if (!key?.enrolledAt || key.tenantId !== tenantId) return null
  return jwt.sign({ typ: "hub-report", tid: tenantId, report }, key.privatePem, {
    algorithm: "ES256", keyid: key.kid, issuer: ISSUER, audience: attestationAudience(tenantId), expiresIn: "1h",
  })
}

export type AttestationCheck = "valid" | "absent" | "unknown-key" | "revoked" | "rotated" | "other-store" | "invalid-signature" | "op-mismatch" | "digest-mismatch"
export type AttestationResult = { check: AttestationCheck; kid: string | null; srv: Record<string, unknown> | null }

/** Verifies a forwarded operation's attestation for this store (the cloud side). */
export async function verifyAttestation(tenantId: string, token: unknown, op: AttestedOp): Promise<AttestationResult> {
  if (typeof token !== "string" || !token) return { check: "absent", kid: null, srv: null }
  const decoded = jwt.decode(token, { complete: true }) as { header?: { kid?: string; alg?: string } } | null
  const kid = typeof decoded?.header?.kid === "string" ? decoded.header.kid : null
  if (!kid || decoded?.header?.alg !== "ES256") return { check: "invalid-signature", kid, srv: null }
  const row = await prisma.hubKey.findUnique({ where: { kid } })
  if (!row) return { check: "unknown-key", kid, srv: null }
  if (row.tenantId !== tenantId) return { check: "other-store", kid, srv: null }
  if (row.status === "REVOKED") return { check: "revoked", kid, srv: null }
  let claims: { tid?: string; op?: AttestedOp; srv?: Record<string, unknown> | null; iat?: number }
  try {
    claims = jwt.verify(token, row.publicPem, { algorithms: ["ES256"], issuer: ISSUER, audience: attestationAudience(tenantId) }) as typeof claims
  } catch {
    return { check: "invalid-signature", kid, srv: null }
  }
  // a rotated key is accepted only for what it signed while it was the store's key
  if (row.status === "ROTATED" && (!row.rotatedAt || (claims.iat ?? Infinity) * 1000 > row.rotatedAt.getTime())) return { check: "rotated", kid, srv: null }
  if (claims.tid !== tenantId) return { check: "other-store", kid, srv: null }
  if (!claims.op || claims.op.id !== op.id || claims.op.entity !== op.entity || claims.op.action !== op.action) return { check: "op-mismatch", kid, srv: null }
  if (claims.op.digest !== op.digest) return { check: "digest-mismatch", kid, srv: null }
  return { check: "valid", kid, srv: claims.srv && typeof claims.srv === "object" ? claims.srv : null }
}

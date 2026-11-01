/**
 * A fresh server-side PIN check for one staff member of one store (bcrypt; legacy SHA-256 verifiers
 * still accepted, as at sign-in). Used where a person must authenticate again for one decision: a hub
 * key enrollment, a manager approval. Never returns or logs the PIN or the verifier.
 */
import bcrypt from "bcryptjs"
import { createHash } from "node:crypto"
import prisma from "./prisma.js"
import { effectivePermissions } from "./permissions.js"

export type VerifiedStaff = { id: string; name: string; role: string; permissions: string[]; tokenVersion: number }
export type PinCheck =
  | { ok: true; staff: VerifiedStaff }
  | { ok: false; code: "INVALID_PIN" }
  | { ok: false; code: "AMBIGUOUS_PIN"; candidates: Array<{ id: string; name: string }> }

const sha256 = (pin: string) => createHash("sha256").update(pin).digest("hex")

export async function verifyStaffPin(tenantId: string, pin: string, staffId?: string): Promise<PinCheck> {
  const candidates = await prisma.staffUser.findMany({
    where: { tenantId, active: true, role: { not: "Driver" }, ...(staffId ? { id: staffId } : {}) },
    select: { id: true, name: true, role: true, pin: true, permissions: true, tokenVersion: true },
  })
  const matched: typeof candidates = []
  for (const c of candidates) {
    if (!c.pin || c.pin === "$2-withheld") continue
    if (c.pin.startsWith("$2") ? await bcrypt.compare(pin, c.pin) : c.pin === sha256(pin)) matched.push(c)
  }
  if (matched.length === 0) return { ok: false, code: "INVALID_PIN" }
  if (matched.length > 1) return { ok: false, code: "AMBIGUOUS_PIN", candidates: matched.map((m) => ({ id: m.id, name: m.name })) }
  const s = matched[0]
  return { ok: true, staff: { id: s.id, name: s.name, role: s.role, permissions: effectivePermissions(s.permissions as any, s.role), tokenVersion: s.tokenVersion ?? 0 } }
}

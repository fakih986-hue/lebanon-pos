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
  | { ok: false; code: "INACTIVE"; name: string }
  | { ok: false; code: "AMBIGUOUS_PIN"; candidates: Array<{ id: string; name: string }> }

// a legacy verifier is the SHA-256 a register stores (base64, as sign-in checks it); hex kept for older rows
const legacyMatch = (stored: string, pin: string) => { const d = createHash("sha256").update(pin).digest(); return stored === d.toString("base64") || stored === d.toString("hex") }

export async function verifyStaffPin(tenantId: string, pin: string, staffId?: string): Promise<PinCheck> {
  const candidates = await prisma.staffUser.findMany({
    where: { tenantId, role: { not: "Driver" }, ...(staffId ? { id: staffId } : {}) },
    select: { id: true, name: true, role: true, pin: true, permissions: true, tokenVersion: true, active: true },
  })
  const matched: typeof candidates = []
  for (const c of candidates) {
    if (!c.pin || c.pin === "$2-withheld") continue
    if (c.pin.startsWith("$2") ? await bcrypt.compare(pin, c.pin) : legacyMatch(c.pin, pin)) matched.push(c)
  }
  // a deactivated person's PIN is reported as such (never accepted), so the refusal is clear
  const active = matched.filter((m) => m.active)
  if (active.length === 0 && matched.length > 0) return { ok: false, code: "INACTIVE", name: matched[0].name }
  matched.splice(0, matched.length, ...active)
  if (matched.length === 0) return { ok: false, code: "INVALID_PIN" }
  if (matched.length > 1) return { ok: false, code: "AMBIGUOUS_PIN", candidates: matched.map((m) => ({ id: m.id, name: m.name })) }
  const s = matched[0]
  return { ok: true, staff: { id: s.id, name: s.name, role: s.role, permissions: effectivePermissions(s.permissions as any, s.role), tokenVersion: s.tokenVersion ?? 0 } }
}

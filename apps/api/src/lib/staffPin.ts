/**
 * A fresh server-side PIN check for one staff member of one store, with the store's one verifier rule
 * (lib/pinVerifier.ts: bcrypt, or a register's SHA-256). Used where a person must authenticate again for
 * one decision: a hub key enrollment, a manager approval. Never returns or logs the PIN or the verifier.
 *
 * A PIN must identify ONE person here. If it matches several active people (two staff were given the same
 * PIN, e.g. one set on a register, where the server cannot compare it with a bcrypt verifier), it is
 * refused as AMBIGUOUS_PIN — naming who is approving would let anyone who knows the shared PIN approve as
 * the others. The owner gives each person their own PIN.
 */
import prisma from "./prisma.js"
import { effectivePermissions } from "./permissions.js"
import { pinMatches } from "./pinVerifier.js"

export type VerifiedStaff = { id: string; name: string; role: string; permissions: string[]; tokenVersion: number }
export type PinCheck =
  | { ok: true; staff: VerifiedStaff }
  | { ok: false; code: "INVALID_PIN" }
  | { ok: false; code: "INACTIVE"; name: string }
  | { ok: false; code: "AMBIGUOUS_PIN" }

export async function verifyStaffPin(tenantId: string, pin: string, staffId?: string): Promise<PinCheck> {
  const candidates = await prisma.staffUser.findMany({
    where: { tenantId, role: { not: "Driver" } },
    select: { id: true, name: true, role: true, pin: true, permissions: true, tokenVersion: true, active: true },
  })
  const matched: typeof candidates = []
  for (const c of candidates) if (await pinMatches(c.pin, pin)) matched.push(c)
  const active = matched.filter((m) => m.active)
  if (active.length > 1) return { ok: false, code: "AMBIGUOUS_PIN" }
  // the person named (if any) must be the one this PIN belongs to
  const mine = staffId ? matched.filter((m) => m.id === staffId) : matched
  // a deactivated person's PIN is reported as such (never accepted), so the refusal is clear
  if (mine.length > 0 && !mine.some((m) => m.active)) return { ok: false, code: "INACTIVE", name: mine[0].name }
  const s = mine.find((m) => m.active)
  if (!s) return { ok: false, code: "INVALID_PIN" }
  return { ok: true, staff: { id: s.id, name: s.name, role: s.role, permissions: effectivePermissions(s.permissions as any, s.role), tokenVersion: s.tokenVersion ?? 0 } }
}

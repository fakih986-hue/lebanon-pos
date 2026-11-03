/**
 * Batch 83: the one definition of a stored staff-PIN verifier and how a typed PIN is checked against it.
 * Used by every server-side PIN check (sign-in, staff session, manager approval, hub-key enrollment,
 * hub setup, PIN-uniqueness checks), on the cloud and on a hub alike.
 *
 * Supported verifiers — nothing else ever matches:
 *  - bcrypt ($2a/$2b/$2y$, cost, 53 chars): what the server and the owner portal store.
 *  - SHA-256 of the PIN, base64 (43 chars + "="): what a register stores and sends when it creates a staff
 *    member or changes a PIN (desktop security.service hashPin), kept until the person signs in online and
 *    the server replaces it with bcrypt.
 * A withheld placeholder ("$2-withheld"), hex digests (never written by any version) and anything else
 * malformed are refused, never compared.
 */
import bcrypt from "bcryptjs"
import { createHash } from "node:crypto"

export type VerifierKind = "bcrypt" | "sha256" | "invalid"
const BCRYPT = /^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/
const SHA256_BASE64 = /^[A-Za-z0-9+/]{43}=$/

export function verifierKind(stored: unknown): VerifierKind {
  if (typeof stored !== "string") return "invalid"
  if (BCRYPT.test(stored)) return "bcrypt"
  if (SHA256_BASE64.test(stored)) return "sha256"
  return "invalid"
}
export const isSha256Verifier = (v: unknown) => verifierKind(v) === "sha256"
export const sha256Verifier = (pin: string) => createHash("sha256").update(pin).digest("base64")

/** Whether a typed PIN matches a stored verifier. An empty PIN or an unsupported verifier never matches. */
export async function pinMatches(stored: unknown, pin: string): Promise<boolean> {
  if (typeof pin !== "string" || pin === "") return false
  const kind = verifierKind(stored)
  if (kind === "bcrypt") return bcrypt.compare(pin, stored as string)
  if (kind === "sha256") return stored === sha256Verifier(pin)
  return false
}

/**
 * Whether two people would share a PIN, given an incoming PIN as the device sent it (a typed PIN or a
 * register's SHA-256 verifier) and another person's stored verifier. "unknown" when it cannot be decided:
 * a register's SHA-256 against a bcrypt verifier (neither reveals the PIN). Callers refuse "same" and
 * treat "unknown" as possible: a PIN that turns out to match two people is never used to pick one of them
 * for an approval (see staffPin.ts).
 */
export async function samePin(incoming: string, stored: unknown): Promise<"same" | "different" | "unknown"> {
  if (!incoming) return "different"
  const inKind = verifierKind(incoming)
  if (inKind === "bcrypt" || (inKind === "invalid" && incoming.startsWith("$2"))) return "different" // a server copy, not a new PIN
  const kind = verifierKind(stored)
  if (inKind === "sha256") {
    if (kind === "sha256") return stored === incoming ? "same" : "different"
    if (kind === "bcrypt") return "unknown"
    return "different"
  }
  return (await pinMatches(stored, incoming)) ? "same" : "different"
}

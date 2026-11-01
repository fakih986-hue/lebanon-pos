/**
 * SPRINT-2 hub batch: what people see when the server could not record something. A business refusal
 * (permission, stock, a rule with a code) is already written for people and passes through unchanged. A
 * database or internal error is not shown: the register or reviewer gets an actionable sentence and a
 * support reference; the technical detail goes to the server's log under that reference (only the operator
 * reads it). Nothing about the request was applied when this is returned.
 */
import { randomBytes } from "node:crypto"

const TECHNICAL = /Invalid `prisma\.|PrismaClient|prisma\.\w+\.\w+\(\)|Argument `\w+` is missing|Unknown argument|Unknown arg|violates (foreign key|unique|not-null|check) constraint|duplicate key value|relation "|column "|ECONNREFUSED|ETIMEDOUT|Transaction (API error|already closed)|Cannot read properties of|is not a function|Unexpected token/i

export function isTechnicalError(err: unknown): boolean {
  const e = err as { name?: unknown; message?: unknown } | null
  const name = typeof e?.name === "string" ? e.name : ""
  const message = typeof e?.message === "string" ? e.message : String(err ?? "")
  return name.startsWith("PrismaClient") || TECHNICAL.test(message)
}

/** The message to show and store for `err`; technical errors are logged under a support reference. */
export function publicError(err: unknown, context: string): { message: string; reference: string | null } {
  const raw = typeof (err as { message?: unknown })?.message === "string" ? (err as Error).message : String(err ?? "")
  if (!isTechnicalError(err)) return { message: raw, reference: null }
  const reference = `ERR-${randomBytes(4).toString("hex").toUpperCase()}`
  console.error(`[support ${reference}] ${context}:`, err)
  const what = /is missing|null value|not-null/i.test(raw)
    ? "It is missing information this server needs (for example a document number); the register that made it may need an update."
    : /unique|duplicate key/i.test(raw)
      ? "A record with the same identity already exists here."
      : /foreign key|relation/i.test(raw)
        ? "It refers to something this server does not have yet (a product, customer, supplier or shift). Let the register sync, then try again."
        : "The server could not record it."
  return { message: `${what} Nothing was applied. Support reference: ${reference}.`, reference }
}

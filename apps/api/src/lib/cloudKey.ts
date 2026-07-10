import { randomBytes } from "node:crypto"

/** Generate a per-tenant cloud sync API key (64-char hex). */
export function generateCloudApiKey(): string {
  return randomBytes(32).toString("hex")
}

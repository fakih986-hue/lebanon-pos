export function canUseStorage() {
  return typeof window !== "undefined" && Boolean(window.localStorage)
}

/**
 * A random RFC 4122 version-4 UUID from the platform CSPRNG. crypto.randomUUID only exists in a
 * secure context (HTTPS / localhost); a browser till on a plain-HTTP LAN hub has crypto.getRandomValues
 * but not randomUUID, so this builds the same UUID from getRandomValues there.
 */
export function randomUuid(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID()
  const b = crypto.getRandomValues(new Uint8Array(16))
  b[6] = (b[6] & 0x0f) | 0x40 // version 4
  b[8] = (b[8] & 0x3f) | 0x80 // RFC 4122 variant
  const h = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("")
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}

export function createId(prefix?: string) {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    const id = crypto.randomUUID()
    return prefix ? `${prefix}-${id}` : id
  }
  const fallback = `${Date.now()}-${Math.random().toString(16).slice(2)}`
  return prefix ? `${prefix}-${fallback}` : fallback
}

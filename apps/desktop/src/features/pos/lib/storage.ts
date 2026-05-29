export function canUseStorage() {
  return typeof window !== "undefined" && Boolean(window.localStorage)
}

export function createId(prefix?: string) {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    const id = crypto.randomUUID()
    return prefix ? `${prefix}-${id}` : id
  }
  const fallback = `${Date.now()}-${Math.random().toString(16).slice(2)}`
  return prefix ? `${prefix}-${fallback}` : fallback
}

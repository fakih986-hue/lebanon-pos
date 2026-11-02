/**
 * Release batch: a server's reason, in the cashier's language. Known reason codes ("CODE: detail") have their own
 * sentence (with the product the server named); anything else is shown as the server sent it.
 */
type T = (key: string, params?: Record<string, string | number>) => string

export function serverReason(t: T, error: string | null | undefined): string {
  if (!error) return ""
  const m = /^([A-Z][A-Z_]+):\s*([\s\S]*)$/.exec(error.trim())
  if (!m) return error
  const code = m[1].startsWith("TOPOLOGY_") ? "TOPOLOGY" : m[1]
  const key = `server.reason.${code}`
  const product = /"([^"]+)"/.exec(m[2])?.[1] ?? ""
  const text = t(key, { product, detail: m[2] })
  return text === key ? error : text
}

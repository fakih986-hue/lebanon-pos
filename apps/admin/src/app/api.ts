import { getToken, clearToken } from "../main"

const BASE = import.meta.env.VITE_API_URL || ""

function getTenantId(): string {
  return localStorage.getItem("lebanonpos.admin.tenantId") || ""
}

/** Like api(), but returns the status and the body (codes, blockers, support reference) instead of throwing. */
export async function apiCall<T = any>(path: string, options?: RequestInit): Promise<{ ok: boolean; status: number; body: T & { error?: string; code?: string; reference?: string } }> {
  const token = getToken()
  const tenantId = getTenantId()
  let url = `${BASE}${path}`
  if (tenantId && path.startsWith("/api/") && !path.includes("tenantId=")) url += (path.includes("?") ? "&" : "?") + `tenantId=${encodeURIComponent(tenantId)}`
  let res: Response
  try {
    res = await fetch(url, { ...options, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...options?.headers } })
  } catch {
    return { ok: false, status: 0, body: { error: "The server could not be reached." } as any }
  }
  if (res.status === 401) { clearToken(); window.location.href = "/admin/login"; return { ok: false, status: 401, body: { error: "Session expired" } as any } }
  const body = await res.json().catch(() => ({ error: res.statusText }))
  return { ok: res.ok, status: res.status, body }
}

export async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const token = getToken()
  const tenantId = getTenantId()

  let url = `${BASE}${path}`
  if (tenantId && path.startsWith("/api/") && !path.includes("tenantId=")) {
    url += (path.includes("?") ? "&" : "?") + `tenantId=${encodeURIComponent(tenantId)}`
  }

  const res = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options?.headers,
    },
  })
  if (res.status === 401) {
    clearToken()
    const isLoginRequest = path === "/api/auth/login" || path === "/api/admin/login"
    if (!isLoginRequest) window.location.href = "/admin/login"
    throw new Error("Session expired")
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error(body.error || `Request failed: ${res.status}`)
  }
  return res.json()
}

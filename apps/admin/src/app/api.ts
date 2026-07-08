import { getToken, clearToken } from "../main"

const BASE = import.meta.env.VITE_API_URL || ""

function getTenantId(): string {
  return localStorage.getItem("lebanonpos.admin.tenantId") || ""
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
    window.location.href = "/admin/login"
    throw new Error("Session expired")
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error(body.error || `Request failed: ${res.status}`)
  }
  return res.json()
}

import { getToken, clearToken } from "../main"

const BASE = import.meta.env.VITE_API_URL || ""

const TOKEN_KEY = "lebanonpos.admin.token"

export async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const token = getToken()
  const res = await fetch(`${BASE}${path}`, {
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

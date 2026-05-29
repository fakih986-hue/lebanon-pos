const TOKEN_KEY = "customer_token"

export function clearCustomerToken() {
  localStorage.removeItem(TOKEN_KEY)
}

export async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const token = localStorage.getItem(TOKEN_KEY)
  const res = await fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options?.headers,
    },
  })
  if (res.status === 401) {
    clearCustomerToken()
    throw new Error("Session expired")
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error(body.error || `Request failed: ${res.status}`)
  }
  return res.json()
}

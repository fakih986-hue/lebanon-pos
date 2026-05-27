import React, { useState } from "react"
import { useNavigate } from "react-router"
import { api } from "../app/api"
import { setToken } from "../main"

export function LoginPage() {
  const navigate = useNavigate()
  const [tenantSubdomain, setTenantSubdomain] = useState("")
  const [pin, setPin] = useState("")
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError("")
    setLoading(true)
    try {
      const res = await api<{ token: string; user: { name: string; tenantId: string; tenantName: string } }>("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ pin, tenantSubdomain: tenantSubdomain.trim() || undefined }),
      })
      setToken(res.token)
      localStorage.setItem("lebanonpos.admin.tenant", res.user.tenantName)
      navigate("/admin/dashboard")
    } catch (err) {
      setError((err as Error).message)
    }
    setLoading(false)
  }

  return (
    <div className="min-h-dvh flex items-center justify-center bg-zinc-50">
      <form onSubmit={handleSubmit} className="bg-white p-8 rounded-xl shadow-sm border border-zinc-200 w-full max-w-sm">
        <h1 className="text-2xl font-bold mb-1">Admin Login</h1>
        <p className="text-sm text-zinc-500 mb-6">Sign in to manage your business</p>
        {error && <div className="mb-4 p-3 bg-red-50 text-red-700 text-sm rounded-lg">{error}</div>}
        <div className="space-y-4">
          <div>
            <label className="text-sm font-medium text-zinc-700">Store Subdomain</label>
            <input value={tenantSubdomain} onChange={e => setTenantSubdomain(e.target.value)} placeholder="my-store"
              className="mt-1 w-full px-3 py-2 border border-zinc-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div>
            <label className="text-sm font-medium text-zinc-700">PIN</label>
            <input type="password" value={pin} onChange={e => setPin(e.target.value)} required
              className="mt-1 w-full px-3 py-2 border border-zinc-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <button type="submit" disabled={loading}
            className="w-full py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50">
            {loading ? "Signing in..." : "Sign In"}
          </button>
        </div>
      </form>
    </div>
  )
}

import { useEffect, useState } from "react"
import { useNavigate, useParams } from "react-router"
import { useI18n } from "@lebanonpos/shared"
import { api } from "../app/api"

export function LoginPage() {
  const { tenantSubdomain } = useParams()
  const navigate = useNavigate()
  const { t } = useI18n()
  const [mode, setMode] = useState<"login" | "register">("login")
  const [name, setName] = useState("")
  const [mobile, setMobile] = useState("")
  const [pin, setPin] = useState("")
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(false)
  const [tenantId, setTenantId] = useState<string>("")

  useEffect(() => {
    if (!tenantSubdomain) return
    api<{ id: string; name: string }>(`/api/delivery/tenant?subdomain=${tenantSubdomain}`).then(t => {
      setTenantId(t.id)
    }).catch(() => navigate("/order"))
  }, [tenantSubdomain])

  const isLoggedIn = !!localStorage.getItem("customer_token")

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError("")
    if (mode === "register" && !name.trim()) { setError("Name is required"); return }
    if (!mobile.trim() || !pin.trim()) { setError("Phone and PIN are required"); return }
    if (!tenantId) { setError("Store not found"); return }
    setLoading(true)
    try {
      if (mode === "register") {
        await api("/api/delivery/customer/signup", {
          method: "POST",
          body: JSON.stringify({ tenantId, name: name.trim(), mobile: mobile.trim(), pin: pin.trim() }),
        })
      }
      const data = await api<{ token: string; customer: { id: string; name: string; mobile: string } }>("/api/delivery/customer/login", {
        method: "POST",
        body: JSON.stringify({ tenantId, mobile: mobile.trim(), pin: pin.trim() }),
      })
      localStorage.setItem("customer_token", data.token)
      localStorage.setItem("customer_id", data.customer.id)
      localStorage.setItem("customer_name", data.customer.name)
      localStorage.setItem("customer_mobile", data.customer.mobile)
      navigate(`/order/${tenantSubdomain}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong")
    } finally { setLoading(false) }
  }

  return (
    <div className="min-h-dvh flex items-center justify-center bg-gradient-page p-4">
      <div className="w-full max-w-sm">
        <h1 className="text-2xl font-bold text-center mb-6">
          {mode === "login" ? "Sign In" : "Create Account"}
        </h1>
        {isLoggedIn ? (
          <div className="text-center space-y-3">
            <p className="text-secondary">You are signed in as <strong>{localStorage.getItem("customer_name")}</strong></p>
            <button onClick={() => { localStorage.removeItem("customer_token"); localStorage.removeItem("customer_id"); localStorage.removeItem("customer_name"); localStorage.removeItem("customer_mobile"); setMode("login"); }}
              className="text-sm text-rose-400 hover:underline">Sign out</button>
            <button onClick={() => navigate(`/order/${tenantSubdomain}`)}
              className="block w-full h-12 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 text-white font-semibold">
              Back to Menu
            </button>
          </div>
        ) : (
          <>
            <div className="flex mb-6 bg-white/5 rounded-xl p-1">
              <button onClick={() => setMode("login")}
                className={`flex-1 py-2 text-sm font-semibold rounded-lg transition-all ${mode === "login" ? "bg-white/10 text-primary" : "text-secondary"}`}>
                Sign In
              </button>
              <button onClick={() => setMode("register")}
                className={`flex-1 py-2 text-sm font-semibold rounded-lg transition-all ${mode === "register" ? "bg-white/10 text-primary" : "text-secondary"}`}>
                Register
              </button>
            </div>
            <form onSubmit={handleSubmit} className="space-y-3">
              {mode === "register" && (
                <input value={name} onChange={e => setName(e.target.value)} placeholder="Full Name" autoFocus
                  className="w-full px-4 py-3 rounded-xl bg-white/5 border border-white/10 text-primary placeholder:text-muted text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40" />
              )}
              <input value={mobile} onChange={e => setMobile(e.target.value)} placeholder="Phone Number" inputMode="tel" autoFocus={mode === "login"}
                className="w-full px-4 py-3 rounded-xl bg-white/5 border border-white/10 text-primary placeholder:text-muted text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40" />
              <input type="password" value={pin} onChange={e => setPin(e.target.value)} placeholder="PIN (4+ digits)" inputMode="numeric"
                className="w-full px-4 py-3 rounded-xl bg-white/5 border border-white/10 text-primary placeholder:text-muted text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40" />
              {error && (
                <div className="p-3 bg-rose-500/10 border border-rose-500/20 text-rose-300 text-sm rounded-xl">{error}</div>
              )}
              <button type="submit" disabled={loading}
                className="w-full h-12 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 text-white font-semibold disabled:opacity-50">
                {loading ? "Please wait..." : mode === "login" ? "Sign In" : "Create Account"}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  )
}

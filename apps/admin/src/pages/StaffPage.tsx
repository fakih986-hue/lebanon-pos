import { useEffect, useState } from "react"
import { api } from "../app/api"
import { useI18n } from "@lebanonpos/shared"

type StaffUser = {
  id: string
  name: string
  mobile: string
  code: string
  role: string
  active: boolean
  createdAt: string
}

type AuditEvent = {
  id: string
  action: string
  entity: string
  summary: string
  userName: string
  userRole: string
  createdAt: string
}

const ROLE_COLORS: Record<string, string> = {
  Admin: "bg-indigo-500/15 text-indigo-300 border-indigo-500/25",
  Manager: "bg-violet-500/15 text-violet-300 border-violet-500/25",
  Cashier: "bg-emerald-500/15 text-emerald-300 border-emerald-500/25",
  Driver: "bg-amber-500/15 text-amber-300 border-amber-500/25",
}

export function StaffPage() {
  const { t } = useI18n()
  const [tab, setTab] = useState<"team" | "audit">("team")
  const [users, setUsers] = useState<StaffUser[]>([])
  const [audit, setAudit] = useState<AuditEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")

  // Add user form
  const [showAdd, setShowAdd] = useState(false)
  const [newName, setNewName] = useState("")
  const [newMobile, setNewMobile] = useState("")
  const [newPin, setNewPin] = useState("")
  const [newRole, setNewRole] = useState("Cashier")
  const [addError, setAddError] = useState("")
  const [addLoading, setAddLoading] = useState(false)

  async function loadData() {
    setLoading(true)
    try {
      const [usersData, auditData] = await Promise.all([
        api<StaffUser[]>("/api/sync/pull").then((d: any) => d.users ?? []),
        api<any>("/api/sync/pull").then((d: any) => (d.auditEvents ?? []).slice(0, 100)),
      ])
      setUsers(usersData)
      setAudit(auditData)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadData() }, [])

  async function handleToggleActive(user: StaffUser) {
    try {
      await api("/api/sync/push", {
        method: "POST",
        body: JSON.stringify({
          operations: [{
            id: crypto.randomUUID(),
            entity: "staff",
            action: "update",
            payload: { ...user, active: !user.active },
          }],
        }),
      })
      setUsers((prev) => prev.map((u) => u.id === user.id ? { ...u, active: !u.active } : u))
    } catch (err) {
      setError((err as Error).message)
    }
  }

  async function handleAddUser() {
    if (!newName.trim() || !newPin.trim()) { setAddError("Name and PIN are required"); return }
    if (newPin.length < 4) { setAddError("PIN must be at least 4 characters"); return }
    setAddLoading(true)
    setAddError("")
    try {
      await api("/api/sync/push", {
        method: "POST",
        body: JSON.stringify({
          operations: [{
            id: crypto.randomUUID(),
            entity: "staff",
            action: "create",
            payload: { id: crypto.randomUUID(), name: newName.trim(), mobile: newMobile.trim(), pin: newPin, role: newRole, code: "", active: true },
          }],
        }),
      })
      setNewName(""); setNewMobile(""); setNewPin(""); setNewRole("Cashier"); setShowAdd(false)
      await loadData()
    } catch (err) {
      setAddError((err as Error).message)
    } finally {
      setAddLoading(false)
    }
  }

  const tabs = [
    { key: "team" as const, label: t("nav.staff_team") },
    { key: "audit" as const, label: t("nav.staff_audit") },
  ]

  return (
    <div className="max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: "var(--text-primary)" }}>{t("nav.staff")}</h1>
          <p className="text-sm mt-1" style={{ color: "var(--text-secondary)" }}>{users.length} {t("pos.staff.users_title")}</p>
        </div>
        <button onClick={() => setShowAdd(!showAdd)}
          className="flex items-center gap-2 px-4 py-2 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 text-white text-sm font-semibold shadow-lg shadow-indigo-600/20 hover:from-indigo-500 hover:to-violet-500 transition-all">
          + {t("pos.staff.add_user_title")}
        </button>
      </div>

      {error && <div className="mb-4 rounded-xl bg-rose-500/10 border border-rose-500/20 px-4 py-3 text-sm text-rose-300">{error}</div>}

      {showAdd && (
        <div className="mb-6 rounded-2xl border p-5" style={{ background: "var(--surface-card)", borderColor: "var(--border-subtle)" }}>
          <h3 className="text-sm font-bold mb-4" style={{ color: "var(--text-primary)" }}>{t("pos.staff.add_user_title")}</h3>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder={t("pos.staff.name")}
              className="h-10 rounded-xl border px-3 text-sm outline-none focus:ring-2 focus:ring-indigo-500/40" style={{ background: "var(--surface-input)", borderColor: "var(--border-input)", color: "var(--text-primary)" }} />
            <input value={newMobile} onChange={(e) => setNewMobile(e.target.value)} placeholder={t("pos.staff.mobile")}
              className="h-10 rounded-xl border px-3 text-sm outline-none focus:ring-2 focus:ring-indigo-500/40" style={{ background: "var(--surface-input)", borderColor: "var(--border-input)", color: "var(--text-primary)" }} />
            <input type="password" value={newPin} onChange={(e) => setNewPin(e.target.value)} placeholder={t("pos.staff.pin")} maxLength={8}
              className="h-10 rounded-xl border px-3 text-sm outline-none focus:ring-2 focus:ring-indigo-500/40" style={{ background: "var(--surface-input)", borderColor: "var(--border-input)", color: "var(--text-primary)" }} />
            <select value={newRole} onChange={(e) => setNewRole(e.target.value)}
              className="h-10 rounded-xl border px-3 text-sm outline-none" style={{ background: "var(--surface-input)", borderColor: "var(--border-input)", color: "var(--text-primary)" }}>
              <option value="Cashier">Cashier</option>
              <option value="Manager">Manager</option>
              <option value="Admin">Admin</option>
            </select>
          </div>
          {addError && <p className="mt-2 text-xs text-rose-400">{addError}</p>}
          <div className="flex gap-2 mt-3">
            <button onClick={handleAddUser} disabled={addLoading}
              className="px-4 py-2 rounded-xl bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-500 transition-all disabled:opacity-50">
              {addLoading ? "Saving..." : t("pos.staff.save")}
            </button>
            <button onClick={() => setShowAdd(false)} className="px-4 py-2 rounded-xl border text-sm font-semibold transition-all hover:opacity-80"
              style={{ borderColor: "var(--border-subtle)", color: "var(--text-secondary)" }}>
              {t("pos.cancel")}
            </button>
          </div>
        </div>
      )}

      <div className="flex gap-1 rounded-xl p-1 mb-6 w-fit" style={{ background: "var(--surface-card)" }}>
        {tabs.map((t_) => (
          <button key={t_.key} onClick={() => setTab(t_.key)}
            className={`px-4 py-2 rounded-lg text-sm font-semibold transition-all ${tab === t_.key ? "bg-gradient-to-r from-indigo-600 to-violet-600 text-white shadow-lg shadow-indigo-600/20" : "text-secondary hover:opacity-80"}`}>
            {t_.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1,2,3].map((i) => <div key={i} className="h-32 rounded-2xl animate-pulse" style={{ background: "var(--surface-card)" }} />)}
        </div>
      ) : tab === "team" ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {users.map((user) => (
            <div key={user.id} className="rounded-2xl border p-5 transition-all hover:border-indigo-500/30" style={{ background: "var(--surface-card)", borderColor: "var(--border-subtle)" }}>
              <div className="flex items-start justify-between gap-3 mb-3">
                <div>
                  <p className="font-bold text-sm" style={{ color: "var(--text-primary)" }}>{user.name}</p>
                  <p className="text-xs mt-0.5" style={{ color: "var(--text-secondary)" }}>{user.mobile || "—"}</p>
                </div>
                <span className={`rounded-full px-2.5 py-1 text-[10px] font-semibold border ${ROLE_COLORS[user.role] ?? ROLE_COLORS.Cashier}`}>
                  {user.role}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className={`text-xs font-semibold ${user.active ? "text-emerald-400" : "text-zinc-500"}`}>
                  {user.active ? "● Active" : "○ Disabled"}
                </span>
                <button onClick={() => handleToggleActive(user)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${user.active ? "bg-rose-500/10 text-rose-300 hover:bg-rose-500/20" : "bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20"}`}>
                  {user.active ? t("pos.staff.disable") : t("pos.staff.enable")}
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="rounded-2xl border overflow-hidden" style={{ background: "var(--surface-card)", borderColor: "var(--border-subtle)" }}>
          <table className="min-w-full text-sm">
            <thead>
              <tr style={{ borderBottom: "1px solid var(--border-subtle)" }}>
                {["Action", "Summary", "User", "Role", "Time"].map((h) => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wider" style={{ color: "var(--text-secondary)" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {audit.map((event) => (
                <tr key={event.id} style={{ borderBottom: "1px solid var(--border-subtle)" }} className="hover:opacity-80 transition-opacity">
                  <td className="px-4 py-3 font-mono text-xs text-indigo-300">{event.action}</td>
                  <td className="px-4 py-3 max-w-xs truncate" style={{ color: "var(--text-primary)" }}>{event.summary}</td>
                  <td className="px-4 py-3" style={{ color: "var(--text-secondary)" }}>{event.userName}</td>
                  <td className="px-4 py-3" style={{ color: "var(--text-secondary)" }}>{event.userRole}</td>
                  <td className="px-4 py-3 text-xs" style={{ color: "var(--text-secondary)" }}>{new Date(event.createdAt).toLocaleString()}</td>
                </tr>
              ))}
              {audit.length === 0 && (
                <tr><td colSpan={5} className="px-4 py-12 text-center text-sm" style={{ color: "var(--text-secondary)" }}>No audit events</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

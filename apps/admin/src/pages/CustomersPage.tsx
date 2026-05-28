import { useEffect, useState } from "react"
import { api } from "../app/api"
import { useI18n } from "@lebanonpos/shared"

type Customer = { id: string; name: string; mobile: string; totalSpent: number; debtBalance: number; createdAt: string }
type PullResponse = { customers: Customer[] }

export function CustomersPage() {
  const { t } = useI18n()
  const [customers, setCustomers] = useState<Customer[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState("")

  useEffect(() => {
    api<PullResponse>("/api/sync/pull?since=")
      .then(data => setCustomers(data.customers ?? []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const filtered = customers.filter(c => {
    if (!search) return true
    const q = search.toLowerCase()
    return c.name.toLowerCase().includes(q) || c.mobile.toLowerCase().includes(q)
  })

  return (
    <div className="space-y-6 pb-12">
      <div className="flex items-center justify-between flex-wrap gap-4 animate-fade-in">
        <div>
          <h1 className="text-3xl font-bold tracking-tight" style={{ color: "var(--text-primary)" }}>{t("customers.title")}</h1>
          <p className="text-sm mt-1" style={{ color: "var(--text-secondary)" }}>{t("customers.subtitle")}</p>
        </div>
        <div className="relative">
          <svg className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: "var(--text-muted)" }} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder={t("customers.search")} className="input-field text-sm pl-10 w-56" />
        </div>
      </div>

      {loading ? (
        <div className="space-y-3">{[1,2,3,4].map(i => <div key={i} className="loading-skeleton h-16 rounded-2xl" />)}</div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20" style={{ color: "var(--text-muted)" }}>
          <div className="w-20 h-20 rounded-3xl bg-slate-100 dark:bg-white/[0.04] flex items-center justify-center mb-5">
            <svg className="w-10 h-10" style={{ color: "var(--text-muted)" }} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" /></svg>
          </div>
          <p className="text-lg font-semibold" style={{ color: "var(--text-secondary)" }}>{customers.length === 0 ? t("customers.no_customers") : t("customers.no_results")}</p>
          <p className="text-sm mt-1">{customers.length === 0 ? t("customers.no_customers_sub") : t("customers.no_results_sub")}</p>
        </div>
      ) : (
        <div className="data-card p-0 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b" style={{ borderColor: "var(--border-card)" }}>
                  <th className="text-start px-5 py-4 text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>{t("customers.name")}</th>
                  <th className="text-start px-5 py-4 text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>{t("customers.mobile")}</th>
                  <th className="text-end px-5 py-4 text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>{t("customers.total_spent")}</th>
                  <th className="text-end px-5 py-4 text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>{t("customers.debt")}</th>
                  <th className="text-end px-5 py-4 text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>{t("customers.since")}</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((c, i) => {
                  const initials = c.name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2)
                  return (
                    <tr key={c.id} className="table-row" style={{ animationDelay: `${i * 0.02}s` }}>
                      <td className="px-5 py-4">
                        <div className="flex items-center gap-3">
                          <span className="w-9 h-9 rounded-xl bg-gradient-to-br from-indigo-100 to-violet-100 dark:from-indigo-500/20 dark:to-violet-500/20 text-indigo-700 dark:text-indigo-300 flex items-center justify-center text-xs font-bold shrink-0">{initials}</span>
                          <span className="font-medium" style={{ color: "var(--text-primary)" }}>{c.name}</span>
                        </div>
                      </td>
                      <td className="px-5 py-4" style={{ color: "var(--text-secondary)" }}>{c.mobile || <span style={{ color: "var(--text-muted)" }}>—</span>}</td>
                      <td className="px-5 py-4 text-end font-semibold" style={{ color: "var(--text-primary)" }}>${c.totalSpent?.toFixed(2) || "0.00"}</td>
                      <td className="px-5 py-4 text-end">
                        {c.debtBalance > 0
                          ? <span className="status-badge status-badge-danger">${c.debtBalance.toFixed(2)}</span>
                          : <span style={{ color: "var(--text-muted)" }}>—</span>
                        }
                      </td>
                      <td className="px-5 py-4 text-end text-xs" style={{ color: "var(--text-muted)" }}>{new Date(c.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

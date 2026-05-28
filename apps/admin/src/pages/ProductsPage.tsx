import { useEffect, useState } from "react"
import { api } from "../app/api"
import { useI18n } from "@lebanonpos/shared"

type Product = { id: number; name: string; barcode: string; category: string; price: number; cost: number; stock: number; isParent: boolean; variantName: string | null; parentId: number | null }
type PullResponse = { products: Product[] }

const CATEGORY_COLORS: Record<string, string> = {
  Food: "bg-orange-100 dark:bg-orange-500/10 text-orange-700 dark:text-orange-300",
  Drinks: "bg-cyan-100 dark:bg-cyan-500/10 text-cyan-700 dark:text-cyan-300",
  "Fast Food": "bg-amber-100 dark:bg-amber-500/10 text-amber-700 dark:text-amber-300",
  Groceries: "bg-emerald-100 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  Default: "bg-slate-100 dark:bg-white/[0.06] text-slate-600 dark:text-slate-400",
}

export function ProductsPage() {
  const { t } = useI18n()
  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState("")

  useEffect(() => {
    api<PullResponse>("/api/sync/pull?since=")
      .then(data => setProducts(data.products ?? []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const filtered = products.filter(p => {
    if (!search) return true
    const q = search.toLowerCase()
    return p.name.toLowerCase().includes(q) || p.barcode.toLowerCase().includes(q)
  })

  return (
    <div className="space-y-6 pb-12">
      <div className="flex items-center justify-between flex-wrap gap-4 animate-fade-in">
        <div>
          <h1 className="text-3xl font-bold tracking-tight" style={{ color: "var(--text-primary)" }}>{t("products.title")}</h1>
          <p className="text-sm mt-1" style={{ color: "var(--text-secondary)" }}>{t("products.subtitle")}</p>
        </div>
        <div className="relative">
          <svg className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: "var(--text-muted)" }} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder={t("products.search")} className="input-field text-sm pl-10 w-56" />
        </div>
      </div>

      {loading ? (
        <div className="space-y-3">{[1,2,3,4].map(i => <div key={i} className="loading-skeleton h-16 rounded-2xl" />)}</div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20" style={{ color: "var(--text-muted)" }}>
          <div className="w-20 h-20 rounded-3xl bg-slate-100 dark:bg-white/[0.04] flex items-center justify-center mb-5">
            <svg className="w-10 h-10" style={{ color: "var(--text-muted)" }} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" /></svg>
          </div>
          <p className="text-lg font-semibold" style={{ color: "var(--text-secondary)" }}>{products.length === 0 ? t("products.no_products") : t("products.no_results")}</p>
          <p className="text-sm mt-1">{products.length === 0 ? t("products.no_products_sub") : t("products.no_results_sub")}</p>
        </div>
      ) : (
        <div className="data-card p-0 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b" style={{ borderColor: "var(--border-card)" }}>
                  <th className="text-start px-5 py-4 text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>{t("products.product")}</th>
                  <th className="text-start px-5 py-4 text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>{t("products.barcode")}</th>
                  <th className="text-start px-5 py-4 text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>{t("products.category")}</th>
                  <th className="text-end px-5 py-4 text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>{t("products.price")}</th>
                  <th className="text-end px-5 py-4 text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>{t("products.cost")}</th>
                  <th className="text-end px-5 py-4 text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>{t("products.stock")}</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((p, i) => {
                  const catClass = CATEGORY_COLORS[p.category] || CATEGORY_COLORS.Default
                  return (
                    <tr key={p.id} className="table-row" style={{ animationDelay: `${i * 0.01}s` }}>
                      <td className="px-5 py-4">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-50 to-violet-50 dark:from-indigo-500/10 dark:to-violet-500/10 border border-indigo-100 dark:border-indigo-500/10 flex items-center justify-center shrink-0">
                            <svg className="w-5 h-5 text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" /></svg>
                          </div>
                          <div>
                            <p className="font-medium" style={{ color: "var(--text-primary)" }}>
                              {p.name}
                              {p.variantName && <span className="font-normal" style={{ color: "var(--text-muted)" }}> ({p.variantName})</span>}
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="px-5 py-4">
                        <span className="font-mono text-[11px] px-2 py-1 rounded-lg" style={{ color: "var(--text-secondary)", background: "var(--input-bg)" }}>{p.barcode}</span>
                      </td>
                      <td className="px-5 py-4">
                        <span className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-medium ${catClass}`}>{p.category}</span>
                      </td>
                      <td className="px-5 py-4 text-end font-semibold" style={{ color: "var(--text-primary)" }}>${p.price.toFixed(2)}</td>
                      <td className="px-5 py-4 text-end" style={{ color: "var(--text-secondary)" }}>${p.cost.toFixed(2)}</td>
                      <td className="px-5 py-4 text-end">
                        <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold ${
                          p.stock <= 0 ? 'bg-rose-50 dark:bg-rose-500/10 text-rose-700 dark:text-rose-300' : p.stock < 10 ? 'bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-300' : 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                        }`}>
                          {p.stock}
                        </span>
                      </td>
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

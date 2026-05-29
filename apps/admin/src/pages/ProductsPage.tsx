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
  const [generating, setGenerating] = useState(false)
  const [genStatus, setGenStatus] = useState<string | null>(null)

  useEffect(() => {
    api<PullResponse>("/api/sync/pull?since=")
      .then(data => setProducts(data.products ?? []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const handleGenerateImages = async (force = false) => {
    setGenerating(true)
    setGenStatus(null)
    try {
      const body = force ? { force: true } : undefined
      const data = await api<{ generated: number; placeholders: number; total: number; tokenMissing?: boolean }>("/api/images/generate-all", { method: "POST", body: body ? JSON.stringify(body) : undefined })
      if (data.tokenMissing) {
        setGenStatus(t("products.images_token_missing") || "AI token not set — using placeholder images")
      } else if (data.total === 0) {
        setGenStatus(t("products.images_all_done") || "All products already have images")
      } else {
        setGenStatus(t("products.images_generated", { count: data.generated }) + ` (${data.placeholders} placeholders, ${data.total} total)`)
      }
    } catch {
      setGenStatus(t("products.images_error"))
    } finally {
      setGenerating(false)
    }
  }

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
        <div className="flex items-center gap-3">
          <button
            onClick={() => handleGenerateImages()}
            disabled={generating}
            className="btn-primary text-sm flex items-center gap-2"
          >
            {generating ? (
              <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" /></svg>
            ) : (
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
            )}
            {generating ? t("products.generating") : t("products.generate_images")}
          </button>
          <button
            onClick={() => handleGenerateImages(true)}
            disabled={generating}
            className="btn-secondary text-sm flex items-center gap-2"
            title={t("products.regenerate_all_tip") || "Regenerate images for all products (overwrites existing)"}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
            {t("products.regenerate_all") || "Regenerate All"}
          </button>
          {genStatus && (
            <span className="text-xs font-medium px-3 py-1.5 rounded-lg" style={{ color: "var(--text-secondary)", background: "var(--input-bg)" }}>{genStatus}</span>
          )}
          <div className="relative">
            <svg className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: "var(--text-muted)" }} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder={t("products.search")} className="input-field text-sm pl-10 w-56" />
          </div>
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

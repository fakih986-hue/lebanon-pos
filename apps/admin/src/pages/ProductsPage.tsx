import { useEffect, useState } from "react"
import { api } from "../app/api"

type Product = {
  id: number
  name: string
  barcode: string
  category: string
  price: number
  cost: number
  stock: number
  isParent: boolean
  variantName: string | null
  parentId: number | null
}

type PullResponse = {
  products: Product[]
}

export function ProductsPage() {
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

  if (loading) return <p className="text-zinc-500">Loading...</p>

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Products</h1>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search..."
          className="px-3 py-1.5 border border-zinc-300 rounded-lg text-sm w-48 focus:outline-none focus:ring-2 focus:ring-blue-500" />
      </div>
      {filtered.length === 0 ? <p className="text-zinc-400">No products found.</p> : (
        <div className="bg-white rounded-xl border border-zinc-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead><tr className="text-zinc-500 border-b bg-zinc-50"><th className="text-left p-3">Name</th><th className="text-left p-3">Barcode</th><th className="text-left p-3">Category</th><th className="text-right p-3">Price</th><th className="text-right p-3">Cost</th><th className="text-right p-3">Stock</th></tr></thead>
            <tbody>
              {filtered.map(p => (
                <tr key={p.id} className="border-b border-zinc-100 hover:bg-zinc-50">
                  <td className="p-3 font-medium">{p.name}{p.variantName ? ` (${p.variantName})` : ""}</td>
                  <td className="p-3 text-zinc-500 font-mono text-xs">{p.barcode}</td>
                  <td className="p-3 text-zinc-500">{p.category}</td>
                  <td className="p-3 text-right">${p.price.toFixed(2)}</td>
                  <td className="p-3 text-right text-zinc-500">${p.cost.toFixed(2)}</td>
                  <td className="p-3 text-right font-medium">{p.stock}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

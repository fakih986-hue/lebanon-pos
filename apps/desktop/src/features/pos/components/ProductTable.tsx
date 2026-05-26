import { Barcode, Hash, Plus, Search, SlidersHorizontal, Star, X } from "lucide-react"
import { Link } from "react-router-dom"

import { formatCurrency, formatNumber } from "../lib/currency"
import type { Product } from "../types/product"

function getStockStatus(product: Product) {
  const reorderPoint = product.reorderPoint ?? 10

  if (product.stock <= 0) {
    return {
      label: "Out",
      className: "border-rose-200 bg-rose-50 text-rose-700",
    }
  }

  if (product.stock <= reorderPoint) {
    return {
      label: "Low",
      className: "border-amber-200 bg-amber-50 text-amber-700",
    }
  }

  return {
    label: "Active",
    className: "border-emerald-200 bg-emerald-50 text-emerald-700",
  }
}

type Props = {
  filteredProducts: Product[]
  lowStockCount: number
  search: string
  onSearchChange: (value: string) => void
  selectedCategory: string
  onCategoryChange: (value: string) => void
  categories: string[]
  onToggleFavorite: (product: Product) => void
  onDeleteClick: (productId: number) => void
}

export default function ProductTable({
  filteredProducts,
  lowStockCount,
  search,
  onSearchChange,
  selectedCategory,
  onCategoryChange,
  categories,
  onToggleFavorite,
  onDeleteClick,
}: Props) {
  return (
    <section className="mt-5 rounded-lg border border-zinc-200 bg-white shadow-sm">
      <div className="flex flex-col gap-3 border-b border-zinc-200 p-4 xl:flex-row xl:items-center xl:justify-between">
        <div>
          <h2 className="text-xl font-bold text-zinc-950">
            Product catalog
          </h2>
          <p className="text-sm text-zinc-500">
            {formatNumber(filteredProducts.length)} products shown -{" "}
            {formatNumber(lowStockCount)} low stock
          </p>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row">
          <Link
            to="/products/new"
            className="flex h-11 items-center justify-center gap-2 rounded-lg bg-zinc-950 px-4 text-sm font-bold text-white transition hover:bg-zinc-800"
          >
            <Plus size={17} />
            Receive Products
          </Link>

          <label className="relative w-full sm:w-80">
            <span className="sr-only">Search catalog</span>
            <Search
              size={18}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400"
            />
            <input
              value={search}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder="Search product or barcode"
              className="h-11 w-full rounded-lg border border-zinc-200 bg-zinc-50 pl-10 pr-3 outline-none transition focus:border-emerald-400 focus:bg-white focus:ring-4 focus:ring-emerald-100"
            />
          </label>

          <label className="relative">
            <span className="sr-only">Filter category</span>
            <SlidersHorizontal
              size={17}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400"
            />
            <select
              value={selectedCategory}
              onChange={(e) => onCategoryChange(e.target.value)}
              className="h-11 w-full rounded-lg border border-zinc-200 bg-zinc-50 pl-10 pr-9 font-semibold text-zinc-700 outline-none transition focus:border-emerald-400 focus:bg-white focus:ring-4 focus:ring-emerald-100 sm:w-48"
            >
              {categories.map((category) => (
                <option key={category} value={category}>
                  {category}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="min-w-full border-separate border-spacing-0 text-sm">
          <thead>
            <tr className="text-left text-xs font-bold uppercase tracking-[0.14em] text-zinc-500">
              <th className="border-b border-zinc-200 px-4 py-3">
                Product
              </th>
              <th className="border-b border-zinc-200 px-4 py-3">
                Category
              </th>
              <th className="border-b border-zinc-200 px-4 py-3">
                Supplier
              </th>
              <th className="border-b border-zinc-200 px-4 py-3">
                Barcodes
              </th>
              <th className="border-b border-zinc-200 px-4 py-3 text-right">
                Price
              </th>
              <th className="border-b border-zinc-200 px-4 py-3 text-right">
                Cost
              </th>
              <th className="border-b border-zinc-200 px-4 py-3 text-right">
                Stock
              </th>
              <th className="border-b border-zinc-200 px-4 py-3">
                Status
              </th>
              <th className="border-b border-zinc-200 px-4 py-3">
                POS
              </th>
            </tr>
          </thead>

          <tbody>
            {filteredProducts.length === 0 ? (
              <tr>
                <td
                  colSpan={9}
                  className="px-4 py-12 text-center text-sm font-medium text-zinc-500"
                >
                  No products found
                </td>
              </tr>
            ) : null}

            {filteredProducts.map((product) => {
              const status = getStockStatus(product)

              return (
                <tr key={product.id} className="hover:bg-zinc-50">
                  <td className="border-b border-zinc-100 px-4 py-4">
                    <div className="font-bold text-zinc-950">
                      {product.name}
                    </div>
                  </td>
                  <td className="border-b border-zinc-100 px-4 py-4 text-zinc-600">
                    {product.category}
                  </td>
                  <td className="border-b border-zinc-100 px-4 py-4 text-zinc-600">
                    {product.supplierName ?? "-"}
                  </td>
                  <td className="border-b border-zinc-100 px-4 py-4">
                    <div className="space-y-1 text-zinc-500">
                      <span className="inline-flex items-center gap-2">
                        <Barcode size={15} />
                        {product.barcode}
                      </span>
                      {(product.barcodeAliases?.length ?? 0) > 0 ? (
                        <span className="inline-flex items-center gap-1 rounded-lg bg-zinc-100 px-2 py-1 text-xs font-bold text-zinc-600">
                          <Hash size={12} />
                          {formatNumber(product.barcodeAliases?.length ?? 0)}{" "}
                          extra
                        </span>
                      ) : null}
                    </div>
                  </td>
                  <td className="border-b border-zinc-100 px-4 py-4 text-right font-bold text-zinc-950">
                    {formatCurrency(product.price)}
                  </td>
                  <td className="border-b border-zinc-100 px-4 py-4 text-right text-zinc-600">
                    {formatCurrency(product.cost)}
                  </td>
                  <td className="border-b border-zinc-100 px-4 py-4 text-right font-semibold text-zinc-800">
                    {formatNumber(product.stock)}
                  </td>
                  <td className="border-b border-zinc-100 px-4 py-4">
                    <span
                      className={`inline-flex rounded-lg border px-2.5 py-1 text-xs font-bold ${status.className}`}
                    >
                      {status.label}
                    </span>
                  </td>
                  <td className="border-b border-zinc-100 px-4 py-4">
                    <button
                      type="button"
                      onClick={() => onToggleFavorite(product)}
                      className={`flex h-9 w-9 items-center justify-center rounded-lg border transition ${
                        product.favorite
                          ? "border-amber-200 bg-amber-50 text-amber-600"
                          : "border-zinc-200 text-zinc-500 hover:bg-zinc-50"
                      }`}
                      aria-label={
                        product.favorite
                          ? `Remove ${product.name} from favorites`
                          : `Add ${product.name} to favorites`
                      }
                    >
                      <Star
                        size={16}
                        fill={product.favorite ? "currentColor" : "none"}
                      />
                    </button>
                  </td>
                  <td className="border-b border-zinc-100 px-4 py-4">
                    <button
                      type="button"
                      onClick={() => onDeleteClick(product.id)}
                      className="flex h-9 w-9 items-center justify-center rounded-lg border border-zinc-200 text-zinc-400 transition hover:border-rose-200 hover:bg-rose-50 hover:text-rose-600"
                      aria-label={`Delete ${product.name}`}
                    >
                      <X size={15} />
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </section>
  )
}

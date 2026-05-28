import { Fragment, useState } from "react"
import { Barcode, ChevronDown, ChevronRight, Hash, Plus, Search, SlidersHorizontal, Star, X } from "lucide-react"
import { Link } from "react-router"

import { useI18n } from "@lebanonpos/shared"
import { formatCurrency, formatNumber } from "../lib/currency"
import type { Product } from "../types/product"

function getStockStatus(product: Product, t: (key: string, params?: Record<string, unknown>) => string) {
  const reorderPoint = product.reorderPoint ?? 10

  if (product.stock <= 0) {
    return {
      label: t("pos.stock.out"),
      className: "border-rose-200 bg-rose-50 text-rose-700",
    }
  }

  if (product.stock <= reorderPoint) {
    return {
      label: t("pos.stock.low"),
      className: "border-amber-200 bg-amber-50 text-amber-700",
    }
  }

  return {
    label: t("pos.stock.active"),
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
  const { t } = useI18n()
  const [expandedParents, setExpandedParents] = useState<Set<number>>(
    () => new Set()
  )

  function toggleParent(id: number) {
    setExpandedParents((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const parents = filteredProducts.filter((p) => !p.parentId)
  const variants = filteredProducts.filter((p) => p.parentId)
  const variantMap = new Map<number, Product[]>()
  for (const v of variants) {
    if (!variantMap.has(v.parentId!)) variantMap.set(v.parentId!, [])
    variantMap.get(v.parentId!)!.push(v)
  }

  return (
    <section className="mt-5 rounded-lg border border-zinc-200 bg-white shadow-sm">
      <div className="flex flex-col gap-3 border-b border-zinc-200 p-4 xl:flex-row xl:items-center xl:justify-between">
        <div>
          <h2 className="text-xl font-bold text-zinc-950">
            {t("pos.product_catalog")}
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
            {t("pos.receive_products")}
          </Link>

          <label className="relative w-full sm:w-80">
            <span className="sr-only">{t("pos.search_catalog")}</span>
            <Search
              size={18}
              className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-zinc-400"
            />
            <input
              value={search}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder={t("pos.search_product_or_barcode")}
              className="h-11 w-full rounded-lg border border-zinc-200 bg-zinc-50 ps-10 pe-3 outline-none transition focus:border-emerald-400 focus:bg-white focus:ring-4 focus:ring-emerald-100"
            />
          </label>

          <label className="relative">
            <span className="sr-only">{t("pos.filter_category")}</span>
            <SlidersHorizontal
              size={17}
              className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-zinc-400"
            />
            <select
              value={selectedCategory}
              onChange={(e) => onCategoryChange(e.target.value)}
              className="h-11 w-full rounded-lg border border-zinc-200 bg-zinc-50 ps-10 pe-9 font-semibold text-zinc-700 outline-none transition focus:border-emerald-400 focus:bg-white focus:ring-4 focus:ring-emerald-100 sm:w-48"
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
                {t("pos.table.product")}
              </th>
              <th className="border-b border-zinc-200 px-4 py-3">
                {t("pos.table.category")}
              </th>
              <th className="border-b border-zinc-200 px-4 py-3">
                {t("pos.table.supplier")}
              </th>
              <th className="border-b border-zinc-200 px-4 py-3">
                {t("pos.table.barcodes")}
              </th>
              <th className="border-b border-zinc-200 px-4 py-3 text-right">
                {t("pos.table.price")}
              </th>
              <th className="border-b border-zinc-200 px-4 py-3 text-right">
                {t("pos.table.cost")}
              </th>
              <th className="border-b border-zinc-200 px-4 py-3 text-right">
                {t("pos.table.stock")}
              </th>
              <th className="border-b border-zinc-200 px-4 py-3">
                {t("pos.table.status")}
              </th>
              <th className="border-b border-zinc-200 px-4 py-3">
                {t("pos.table.pos")}
              </th>
              <th className="border-b border-zinc-200 px-4 py-3">
                <span className="sr-only">{t("pos.table.actions")}</span>
              </th>
            </tr>
          </thead>

          <tbody>
            {filteredProducts.length === 0 ? (
              <tr>
                <td
                  colSpan={10}
                  className="px-4 py-12 text-center text-sm font-medium text-zinc-500"
                >
                  {t("pos.no_products_found")}
                </td>
              </tr>
            ) : null}

            {parents.map((product) => {
              const status = getStockStatus(product, t)
              const childVariants = variantMap.get(product.id) ?? []
              const expanded = expandedParents.has(product.id)

              return (
                <Fragment key={product.id}>
                  <tr className="hover:bg-zinc-50">
                    <td className="border-b border-zinc-100 px-4 py-4">
                      <div className="flex items-center gap-2">
                        {childVariants.length > 0 ? (
                          <button
                            type="button"
                            onClick={() => toggleParent(product.id)}
                            className="flex h-6 w-6 items-center justify-center rounded text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600"
                          >
                            {expanded ? (
                              <ChevronDown size={16} />
                            ) : (
                              <ChevronRight size={16} />
                            )}
                          </button>
                        ) : (
                          <span className="w-6" />
                        )}
                        <span className="font-bold text-zinc-950">
                          {product.name}
                        </span>
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
                            {t("pos.extra")}
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
                            ? t("pos.remove_from_favorites", { name: product.name })
                            : t("pos.add_to_favorites", { name: product.name })
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
                        aria-label={t("pos.delete_product", { name: product.name })}
                      >
                        <X size={15} />
                      </button>
                    </td>
                  </tr>

                  {expanded
                    ? childVariants.map((variant) => {
                        const vStatus = getStockStatus(variant, t)

                        return (
                          <tr
                            key={variant.id}
                            className="bg-zinc-50/50 hover:bg-zinc-100/50"
                          >
                            <td className="border-b border-zinc-100 px-4 py-4 pl-12">
                              <div className="flex items-center gap-2">
                                <span className="inline-flex items-center gap-1 rounded bg-zinc-200 px-1.5 py-0.5 text-[11px] font-bold uppercase tracking-wide text-zinc-600">
                                  {t("pos.variant")}
                                </span>
                                <span className="font-semibold text-zinc-900">
                                  {variant.variantName ?? variant.name}
                                </span>
                              </div>
                            </td>
                            <td className="border-b border-zinc-100 px-4 py-4 text-zinc-600">
                              {variant.category}
                            </td>
                            <td className="border-b border-zinc-100 px-4 py-4 text-zinc-600">
                              {variant.supplierName ?? "-"}
                            </td>
                            <td className="border-b border-zinc-100 px-4 py-4">
                              <div className="space-y-1 text-zinc-500">
                                <span className="inline-flex items-center gap-2">
                                  <Barcode size={15} />
                                  {variant.barcode}
                                </span>
                              </div>
                            </td>
                            <td className="border-b border-zinc-100 px-4 py-4 text-right font-bold text-zinc-950">
                              {formatCurrency(variant.price)}
                            </td>
                            <td className="border-b border-zinc-100 px-4 py-4 text-right text-zinc-600">
                              {formatCurrency(variant.cost)}
                            </td>
                            <td className="border-b border-zinc-100 px-4 py-4 text-right font-semibold text-zinc-800">
                              {formatNumber(variant.stock)}
                            </td>
                            <td className="border-b border-zinc-100 px-4 py-4">
                              <span
                                className={`inline-flex rounded-lg border px-2.5 py-1 text-xs font-bold ${vStatus.className}`}
                              >
                                {vStatus.label}
                              </span>
                            </td>
                            <td className="border-b border-zinc-100 px-4 py-4">
                              <button
                                type="button"
                                onClick={() => onToggleFavorite(variant)}
                                className={`flex h-9 w-9 items-center justify-center rounded-lg border transition ${
                                  variant.favorite
                                    ? "border-amber-200 bg-amber-50 text-amber-600"
                                    : "border-zinc-200 text-zinc-500 hover:bg-zinc-50"
                                }`}
                                aria-label={
                            variant.favorite
                              ? t("pos.remove_from_favorites", { name: variant.name })
                              : t("pos.add_to_favorites", { name: variant.name })
                        }
                              >
                                <Star
                                  size={16}
                                  fill={
                                    variant.favorite
                                      ? "currentColor"
                                      : "none"
                                  }
                                />
                              </button>
                            </td>
                            <td className="border-b border-zinc-100 px-4 py-4">
                              <button
                                type="button"
                                onClick={() => onDeleteClick(variant.id)}
                                className="flex h-9 w-9 items-center justify-center rounded-lg border border-zinc-200 text-zinc-400 transition hover:border-rose-200 hover:bg-rose-50 hover:text-rose-600"
                                aria-label={t("pos.delete_product", { name: variant.name })}
                              >
                                <X size={15} />
                              </button>
                            </td>
                          </tr>
                        )
                      })
                    : null}
                </Fragment>
              )
            })}

            {parents.length === 0 && filteredProducts.length > 0
                ? filteredProducts.map((variant) => {
                  const vStatus = getStockStatus(variant, t)
                  return (
                    <tr key={variant.id} className="hover:bg-zinc-50">
                      <td className="border-b border-zinc-100 px-4 py-4">
                        <div className="flex items-center gap-2">
                          <span className="inline-flex items-center gap-1 rounded bg-zinc-200 px-1.5 py-0.5 text-[11px] font-bold uppercase tracking-wide text-zinc-600">
                            {t("pos.variant")}
                          </span>
                          <span className="font-bold text-zinc-950">
                            {variant.variantName ?? variant.name}
                          </span>
                        </div>
                      </td>
                      <td className="border-b border-zinc-100 px-4 py-4 text-zinc-600">
                        {variant.category}
                      </td>
                      <td className="border-b border-zinc-100 px-4 py-4 text-zinc-600">
                        {variant.supplierName ?? "-"}
                      </td>
                      <td className="border-b border-zinc-100 px-4 py-4">
                        <div className="space-y-1 text-zinc-500">
                          <span className="inline-flex items-center gap-2">
                            <Barcode size={15} />
                            {variant.barcode}
                          </span>
                        </div>
                      </td>
                      <td className="border-b border-zinc-100 px-4 py-4 text-right font-bold text-zinc-950">
                        {formatCurrency(variant.price)}
                      </td>
                      <td className="border-b border-zinc-100 px-4 py-4 text-right text-zinc-600">
                        {formatCurrency(variant.cost)}
                      </td>
                      <td className="border-b border-zinc-100 px-4 py-4 text-right font-semibold text-zinc-800">
                        {formatNumber(variant.stock)}
                      </td>
                      <td className="border-b border-zinc-100 px-4 py-4">
                        <span
                          className={`inline-flex rounded-lg border px-2.5 py-1 text-xs font-bold ${vStatus.className}`}
                        >
                          {vStatus.label}
                        </span>
                      </td>
                      <td className="border-b border-zinc-100 px-4 py-4">
                        <button
                          type="button"
                          onClick={() => onToggleFavorite(variant)}
                          className={`flex h-9 w-9 items-center justify-center rounded-lg border transition ${
                            variant.favorite
                              ? "border-amber-200 bg-amber-50 text-amber-600"
                              : "border-zinc-200 text-zinc-500 hover:bg-zinc-50"
                          }`}
                          aria-label={
                              variant.favorite
                                ? t("pos.remove_from_favorites", { name: variant.name })
                                : t("pos.add_to_favorites", { name: variant.name })
                        }
                      >
                        <Star
                          size={16}
                          fill={
                            variant.favorite ? "currentColor" : "none"
                          }
                        />
                      </button>
                    </td>
                    <td className="border-b border-zinc-100 px-4 py-4">
                      <button
                        type="button"
                        onClick={() => onDeleteClick(variant.id)}
                        className="flex h-9 w-9 items-center justify-center rounded-lg border border-zinc-200 text-zinc-400 transition hover:border-rose-200 hover:bg-rose-50 hover:text-rose-600"
                        aria-label={t("pos.delete_product", { name: variant.name })}
                        >
                          <X size={15} />
                        </button>
                      </td>
                    </tr>
                  )
                })
              : null}
          </tbody>
        </table>
      </div>
    </section>
  )
}

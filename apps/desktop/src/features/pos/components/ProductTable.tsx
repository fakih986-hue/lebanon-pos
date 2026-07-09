import { Fragment, useState } from "react"
import { Barcode, ChevronDown, ChevronRight, Hash, Pencil, Plus, Search, SlidersHorizontal, Star, X } from "lucide-react"
import { Link } from "react-router"

import { useI18n } from "@lebanonpos/shared"
import { formatCurrency, formatNumber } from "../lib/currency"
import type { Product } from "../types/product"

function getStockStatus(product: Product, t: (key: string, params?: any) => string) {
  const reorderPoint = product.reorderPoint ?? 10
  if (product.stock <= 0) return { label: t("pos.stock.out"), className: "chip chip-danger" }
  if (product.stock <= reorderPoint) return { label: t("pos.stock.low"), className: "chip chip-warning" }
  return { label: t("pos.stock.active"), className: "chip chip-success" }
}

function marginPct(product: Product): number | null {
  if (!product.price || product.price <= 0 || product.cost == null) return null
  return ((product.price - product.cost) / product.price) * 100
}

function marginColor(pct: number | null): string {
  if (pct === null) return "var(--text-3)"
  if (pct < 10) return "var(--danger-text)"
  if (pct < 25) return "var(--warning-text)"
  return "var(--success-text)"
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
  onEditClick: (product: Product) => void
}

const cell = "px-4 py-2.5"
const cellStyle: React.CSSProperties = { borderBottom: "1px solid var(--border-soft)" }

function ProductRow({
  product,
  isVariant,
  expandable,
  expanded,
  onToggleExpand,
  onToggleFavorite,
  onDeleteClick,
  onEditClick,
  t,
}: {
  product: Product
  isVariant: boolean
  expandable?: boolean
  expanded?: boolean
  onToggleExpand?: () => void
  onToggleFavorite: (product: Product) => void
  onDeleteClick: (productId: number) => void
  onEditClick: (product: Product) => void
  t: (key: string, params?: any) => string
}) {
  const status = getStockStatus(product, t)
  const pct = marginPct(product)
  const displayName = isVariant ? (product.variantName ?? product.name) : product.name

  return (
    <tr className="t-row" style={isVariant ? { background: "var(--surface-2)" } : undefined}>
      <td className={`${cell}${isVariant ? " ps-12" : ""}`} style={cellStyle}>
        <div className="flex items-center gap-2">
          {expandable ? (
            <button
              type="button"
              onClick={onToggleExpand}
              className="flex h-6 w-6 items-center justify-center rounded transition"
              style={{ color: "var(--text-3)" }}
              aria-label={expanded ? "Collapse variants" : "Expand variants"}
            >
              {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
            </button>
          ) : !isVariant ? (
            <span className="w-6" />
          ) : null}

          {isVariant && (
            <span
              className="inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-bold uppercase tracking-wide"
              style={{ background: "var(--surface-3)", color: "var(--text-2)" }}
            >
              {t("pos.variant")}
            </span>
          )}

          {product.image ? (
            <img
              src={product.image}
              alt=""
              className="h-7 w-7 shrink-0 rounded-md object-cover"
              style={{ border: "1px solid var(--border)" }}
            />
          ) : (
            <span
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[11px] font-bold"
              style={{ background: "var(--brand-soft)", color: "var(--brand-text)" }}
            >
              {displayName.charAt(0).toUpperCase()}
            </span>
          )}
          <span className="font-bold" style={{ color: "var(--text)" }}>{displayName}</span>
        </div>
      </td>
      <td className={cell} style={{ ...cellStyle, color: "var(--text-2)" }}>{product.category}</td>
      <td className={cell} style={{ ...cellStyle, color: "var(--text-2)" }}>{product.supplierName ?? "-"}</td>
      <td className={cell} style={cellStyle}>
        <div className="space-y-1" style={{ color: "var(--text-3)" }}>
          <span className="inline-flex items-center gap-2">
            <Barcode size={15} />
            {product.barcode}
          </span>
          {(product.barcodeAliases?.length ?? 0) > 0 && (
            <span
              className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-bold"
              style={{ background: "var(--surface-3)", color: "var(--text-2)" }}
            >
              <Hash size={12} />
              {formatNumber(product.barcodeAliases?.length ?? 0)} {t("pos.extra")}
            </span>
          )}
        </div>
      </td>
      <td className={`${cell} text-end font-bold tabular-nums`} style={{ ...cellStyle, color: "var(--text)" }}>
        {formatCurrency(product.price)}
      </td>
      <td className={`${cell} text-end tabular-nums`} style={{ ...cellStyle, color: "var(--text-2)" }}>
        {formatCurrency(product.cost)}
      </td>
      <td className={`${cell} text-end font-bold tabular-nums`} style={{ ...cellStyle, color: marginColor(pct) }}>
        {pct === null ? "—" : `${pct.toFixed(0)}%`}
      </td>
      <td className={`${cell} text-end font-semibold tabular-nums`} style={{ ...cellStyle, color: "var(--text-2)" }}>
        {formatNumber(product.stock)}
      </td>
      <td className={cell} style={cellStyle}>
        <div className="flex flex-wrap items-center gap-1">
          <span className={status.className}>{status.label}</span>
          {(!product.barcode || product.barcode.trim() === "") && (
            <span className="chip text-[10px] px-1.5 py-0.5 rounded font-semibold"
              style={{ background: "var(--warning-soft)", color: "var(--warning-text)" }}>
              No barcode
            </span>
          )}
        </div>
      </td>
      <td className={cell} style={cellStyle}>
        <button
          type="button"
          onClick={() => onToggleFavorite(product)}
          className="flex h-9 w-9 items-center justify-center rounded-lg border transition"
          style={product.favorite
            ? { borderColor: "var(--brand-border)", background: "var(--brand-soft)", color: "var(--brand-text)" }
            : { borderColor: "var(--border)", color: "var(--text-3)" }}
          aria-label={product.favorite
            ? t("pos.remove_from_favorites", { name: product.name })
            : t("pos.add_to_favorites", { name: product.name })}
        >
          <Star size={16} fill={product.favorite ? "currentColor" : "none"} />
        </button>
      </td>
      <td className={cell} style={cellStyle}>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onEditClick(product) }}
            className="flex h-9 w-9 items-center justify-center rounded-lg border transition"
            style={{ borderColor: "var(--border)", color: "var(--text-3)" }}
            title="Edit product"
            aria-label={`Edit ${displayName}`}
          >
            <Pencil size={13} />
          </button>
          <button
            type="button"
            onClick={() => onDeleteClick(product.id)}
            className="flex h-9 w-9 items-center justify-center rounded-lg border transition hover:opacity-80"
            style={{ borderColor: "var(--border)", color: "var(--text-3)" }}
            aria-label={t("pos.delete_product", { name: product.name })}
          >
            <X size={15} />
          </button>
        </div>
      </td>
    </tr>
  )
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
  onEditClick,
}: Props) {
  const { t } = useI18n()
  const [expandedParents, setExpandedParents] = useState<Set<number>>(() => new Set())

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
  // Variants whose parent is filtered out render as standalone rows
  const orphanVariants = parents.length === 0 ? variants : []

  const headers: { key: string; label: string; end?: boolean }[] = [
    { key: "product", label: t("pos.table.product") },
    { key: "category", label: t("pos.table.category") },
    { key: "supplier", label: t("pos.table.supplier") },
    { key: "barcodes", label: t("pos.table.barcodes") },
    { key: "price", label: t("pos.table.price"), end: true },
    { key: "cost", label: t("pos.table.cost"), end: true },
    { key: "margin", label: "Margin", end: true },
    { key: "stock", label: t("pos.table.stock"), end: true },
    { key: "status", label: t("pos.table.status") },
    { key: "pos", label: t("pos.table.pos") },
  ]

  return (
    <section className="card mt-5 overflow-hidden">
      <div
        className="flex flex-col gap-3 border-b p-4 xl:flex-row xl:items-center xl:justify-between"
        style={{ borderColor: "var(--border)" }}
      >
        <div>
          <h2 className="text-xl font-bold" style={{ color: "var(--text)" }}>
            {t("pos.product_catalog")}
          </h2>
          <p className="text-sm" style={{ color: "var(--text-3)" }}>
            {formatNumber(filteredProducts.length)} products shown -{" "}
            {formatNumber(lowStockCount)} low stock
          </p>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row">
          <Link to="/products/new" className="btn-primary btn-md">
            <Plus size={17} />
            {t("pos.receive_products")}
          </Link>

          <label className="relative w-full sm:w-80">
            <span className="sr-only">{t("pos.search_catalog")}</span>
            <Search
              size={18}
              className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2"
              style={{ color: "var(--text-3)" }}
            />
            <input
              value={search}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder={t("pos.search_product_or_barcode")}
              className="input h-11 w-full ps-10 pe-3"
            />
          </label>

          <label className="relative">
            <span className="sr-only">{t("pos.filter_category")}</span>
            <SlidersHorizontal
              size={17}
              className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2"
              style={{ color: "var(--text-3)" }}
            />
            <select
              value={selectedCategory}
              onChange={(e) => onCategoryChange(e.target.value)}
              className="input h-11 w-full ps-10 pe-9 font-semibold sm:w-48"
            >
              {categories.map((category) => (
                <option key={category} value={category}>{category}</option>
              ))}
            </select>
          </label>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="min-w-full border-separate border-spacing-0 text-sm">
          <thead>
            <tr>
              {headers.map((h) => (
                <th
                  key={h.key}
                  className={`${cell} text-xs font-bold uppercase tracking-[0.14em]${h.end ? " text-end" : " text-start"}`}
                  style={{ borderBottom: "1px solid var(--border)" }}
                >
                  {h.label}
                </th>
              ))}
              <th className={cell} style={{ borderBottom: "1px solid var(--border)" }}>
                <span className="sr-only">{t("pos.table.actions")}</span>
              </th>
            </tr>
          </thead>

          <tbody>
            {filteredProducts.length === 0 && (
              <tr>
                <td colSpan={11} className="px-4 py-12 text-center text-sm font-medium" style={{ color: "var(--text-3)" }}>
                  {t("pos.no_products_found")}
                </td>
              </tr>
            )}

            {parents.map((product) => {
              const childVariants = variantMap.get(product.id) ?? []
              const expanded = expandedParents.has(product.id)
              return (
                <Fragment key={product.id}>
                  <ProductRow
                    product={product}
                    isVariant={false}
                    expandable={childVariants.length > 0}
                    expanded={expanded}
                    onToggleExpand={() => toggleParent(product.id)}
                    onToggleFavorite={onToggleFavorite}
                    onDeleteClick={onDeleteClick}
                    onEditClick={onEditClick}
                    t={t}
                  />
                  {expanded && childVariants.map((variant) => (
                    <ProductRow
                      key={variant.id}
                      product={variant}
                      isVariant
                      onToggleFavorite={onToggleFavorite}
                      onDeleteClick={onDeleteClick}
                      onEditClick={onEditClick}
                      t={t}
                    />
                  ))}
                </Fragment>
              )
            })}

            {orphanVariants.map((variant) => (
              <ProductRow
                key={variant.id}
                product={variant}
                isVariant
                onToggleFavorite={onToggleFavorite}
                onDeleteClick={onDeleteClick}
                onEditClick={onEditClick}
                t={t}
              />
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

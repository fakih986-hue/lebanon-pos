import { useState } from "react"
import { Save, Star } from "lucide-react"

import type { SupplierLedger } from "../services/supplier.service"
import type { Product } from "../types/product"

type Props = {
  selectedProduct: Product | undefined
  setSelectedProductId: (id: number) => void
  products: Product[]
  productCategory: string
  setProductCategory: (value: string) => void
  reorderPoint: string
  setReorderPoint: (value: string) => void
  reorderQuantity: string
  setReorderQuantity: (value: string) => void
  expiryDate: string
  setExpiryDate: (value: string) => void
  productSupplierId: string
  setProductSupplierId: (value: string) => void
  barcodeAliases: string
  setBarcodeAliases: (value: string) => void
  suppliers: SupplierLedger[]
  categories: string[]
  categoryFrom: string
  setCategoryFrom: (value: string) => void
  categoryTo: string
  setCategoryTo: (value: string) => void
  onToggleFavorite: () => void
  onSaveProductSetup: () => void
  onSaveCategoryRename: () => void
}

export default function ProductSetupForm({
  selectedProduct,
  setSelectedProductId,
  products,
  productCategory,
  setProductCategory,
  reorderPoint,
  setReorderPoint,
  reorderQuantity,
  setReorderQuantity,
  expiryDate,
  setExpiryDate,
  productSupplierId,
  setProductSupplierId,
  barcodeAliases,
  setBarcodeAliases,
  suppliers,
  categories,
  categoryFrom,
  setCategoryFrom,
  categoryTo,
  setCategoryTo,
  onToggleFavorite,
  onSaveProductSetup,
  onSaveCategoryRename,
}: Props) {
  const [formErrors, setFormErrors] = useState<Partial<Record<"category" | "reorderPoint" | "reorderQuantity", string>>>({})

  function handleSave() {
    const errors: typeof formErrors = {}
    if (!productCategory.trim()) {
      errors.category = "Category is required"
    }
    const reorderPointNum = Number(reorderPoint)
    if (reorderPointNum < 0 || !Number.isFinite(reorderPointNum)) {
      errors.reorderPoint = "Reorder point must be >= 0"
    }
    const reorderQtyNum = Number(reorderQuantity)
    if (reorderQtyNum < 0 || !Number.isFinite(reorderQtyNum)) {
      errors.reorderQuantity = "Reorder quantity must be >= 0"
    }
    if (Object.keys(errors).length > 0) {
      setFormErrors(errors)
      return
    }
    setFormErrors({})
    onSaveProductSetup()
  }

  return (
    <section className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
      <div className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-emerald-100 text-emerald-700">
            <Save size={21} />
          </div>
          <div>
            <h2 className="text-lg font-bold text-zinc-950">
              Product setup
            </h2>
            <p className="text-sm text-zinc-500">Configure categories, suppliers, and reorder settings.</p>
          </div>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          <label className="block text-sm font-bold text-zinc-700 xl:col-span-2">
            Product
            <select
              value={selectedProduct?.id ?? ""}
              onChange={(event) =>
                setSelectedProductId(Number(event.target.value))
              }
              className="mt-2 h-11 w-full rounded-lg border border-zinc-200 bg-zinc-50 px-3 outline-none focus:border-emerald-400 focus:bg-white focus:ring-4 focus:ring-emerald-100"
            >
              {products.map((product) => (
                <option key={product.id} value={product.id}>
                  {product.name}
                </option>
              ))}
            </select>
          </label>

          <label className="block text-sm font-bold text-zinc-700">
            Category
            <input
              value={productCategory}
              list="catalog-categories"
              onChange={(event) => setProductCategory(event.target.value)}
              className={`mt-2 h-11 w-full rounded-lg border bg-zinc-50 px-3 outline-none focus:bg-white focus:ring-4 ${
                formErrors.category
                  ? "border-rose-300 focus:border-rose-400 focus:ring-rose-100"
                  : "border-zinc-200 focus:border-emerald-400 focus:ring-emerald-100"
              }`}
            />
            {formErrors.category ? (
              <p className="mt-1 text-xs font-medium text-rose-500">{formErrors.category}</p>
            ) : null}
          </label>

          <label className="block text-sm font-bold text-zinc-700">
            Reorder point
            <input
              type="number"
              min="0"
              value={reorderPoint}
              onChange={(event) => setReorderPoint(event.target.value)}
              className={`mt-2 h-11 w-full rounded-lg border bg-zinc-50 px-3 outline-none focus:bg-white focus:ring-4 ${
                formErrors.reorderPoint
                  ? "border-rose-300 focus:border-rose-400 focus:ring-rose-100"
                  : "border-zinc-200 focus:border-emerald-400 focus:ring-emerald-100"
              }`}
            />
            {formErrors.reorderPoint ? (
              <p className="mt-1 text-xs font-medium text-rose-500">{formErrors.reorderPoint}</p>
            ) : null}
          </label>

          <label className="block text-sm font-bold text-zinc-700">
            Buy target
            <input
              type="number"
              min="0"
              value={reorderQuantity}
              onChange={(event) => setReorderQuantity(event.target.value)}
              className={`mt-2 h-11 w-full rounded-lg border bg-zinc-50 px-3 outline-none focus:bg-white focus:ring-4 ${
                formErrors.reorderQuantity
                  ? "border-rose-300 focus:border-rose-400 focus:ring-rose-100"
                  : "border-zinc-200 focus:border-emerald-400 focus:ring-emerald-100"
              }`}
            />
            {formErrors.reorderQuantity ? (
              <p className="mt-1 text-xs font-medium text-rose-500">{formErrors.reorderQuantity}</p>
            ) : null}
          </label>

          <label className="block text-sm font-bold text-zinc-700">
            Expiry date
            <input
              type="date"
              value={expiryDate}
              onChange={(event) => setExpiryDate(event.target.value)}
              className="mt-2 h-11 w-full rounded-lg border border-zinc-200 bg-zinc-50 px-3 outline-none focus:border-emerald-400 focus:bg-white focus:ring-4 focus:ring-emerald-100"
            />
          </label>

          <label className="block text-sm font-bold text-zinc-700 xl:col-span-2">
            Supplier
            <select
              value={productSupplierId}
              onChange={(event) => setProductSupplierId(event.target.value)}
              className="mt-2 h-11 w-full rounded-lg border border-zinc-200 bg-zinc-50 px-3 outline-none focus:border-emerald-400 focus:bg-white focus:ring-4 focus:ring-emerald-100"
            >
              <option value="">No supplier linked</option>
              {suppliers.map((supplier) => (
                <option key={supplier.id} value={supplier.id}>
                  {supplier.name}
                </option>
              ))}
            </select>
          </label>

          <label className="block text-sm font-bold text-zinc-700 xl:col-span-3">
            Extra barcodes
            <textarea
              value={barcodeAliases}
              onChange={(event) => setBarcodeAliases(event.target.value)}
              placeholder="One barcode per line, for same item different supplier pack"
              rows={2}
              className="mt-2 w-full resize-none rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 outline-none focus:border-emerald-400 focus:bg-white focus:ring-4 focus:ring-emerald-100"
            />
          </label>

          <button
            type="button"
            onClick={onToggleFavorite}
            disabled={!selectedProduct}
            className={`mt-7 flex h-11 items-center justify-center gap-2 rounded-lg border px-3 text-sm font-bold transition ${
              selectedProduct?.favorite
                ? "border-amber-200 bg-amber-50 text-amber-700"
                : "border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50"
            }`}
          >
            <Star
              size={17}
              fill={selectedProduct?.favorite ? "currentColor" : "none"}
            />
            Favorite
          </button>

          <button
            type="button"
            onClick={handleSave}
            disabled={!selectedProduct}
            className="mt-7 flex h-11 items-center justify-center gap-2 rounded-lg bg-emerald-600 px-3 text-sm font-bold text-white transition hover:bg-emerald-500 disabled:bg-zinc-300"
          >
            <Save size={17} />
            Save Setup
          </button>
        </div>
      </div>

      <aside className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
        <h2 className="text-lg font-bold text-zinc-950">
          Category manager
        </h2>
        <p className="text-sm text-zinc-500">
          Rename categories across all products.
        </p>

        <div className="mt-4 space-y-3">
          <select
            value={categoryFrom}
            onChange={(event) => setCategoryFrom(event.target.value)}
            className="h-11 w-full rounded-lg border border-zinc-200 bg-zinc-50 px-3 outline-none focus:border-emerald-400 focus:bg-white focus:ring-4 focus:ring-emerald-100"
          >
            <option value="">Choose category</option>
            {categories
              .filter((category) => category !== "All")
              .map((category) => (
                <option key={category} value={category}>
                  {category}
                </option>
              ))}
            </select>
            <input
              value={categoryTo}
              onChange={(event) => setCategoryTo(event.target.value)}
              placeholder="New category name"
              className="h-11 w-full rounded-lg border border-zinc-200 bg-zinc-50 px-3 outline-none focus:border-emerald-400 focus:bg-white focus:ring-4 focus:ring-emerald-100"
            />
            <button
              type="button"
              onClick={onSaveCategoryRename}
              className="flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-zinc-950 px-3 text-sm font-bold text-white transition hover:bg-zinc-800"
            >
              <Save size={17} />
              Rename Category
            </button>
          </div>
        </aside>
      </section>
    )
  }

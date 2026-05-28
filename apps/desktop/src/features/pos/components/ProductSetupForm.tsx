import { useState } from "react"
import { Save, Star } from "lucide-react"

import { useI18n } from "@lebanonpos/shared"
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
  const { t } = useI18n()
  const [formErrors, setFormErrors] = useState<Partial<Record<"category" | "reorderPoint" | "reorderQuantity", string>>>({})

  function handleSave() {
    const errors: typeof formErrors = {}
    if (!productCategory.trim()) {
      errors.category = t("pos.setup.category_required")
    }
    const reorderPointNum = Number(reorderPoint)
    if (reorderPointNum < 0 || !Number.isFinite(reorderPointNum)) {
      errors.reorderPoint = t("pos.setup.reorder_point_invalid")
    }
    const reorderQtyNum = Number(reorderQuantity)
    if (reorderQtyNum < 0 || !Number.isFinite(reorderQtyNum)) {
      errors.reorderQuantity = t("pos.setup.reorder_quantity_invalid")
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
              {t("pos.setup.title")}
            </h2>
            <p className="text-sm text-zinc-500">{t("pos.setup.desc")}</p>
          </div>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          <label className="block text-sm font-bold text-zinc-700 xl:col-span-2">
            {t("pos.product")}
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
            {t("pos.category")}
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
            {t("pos.setup.reorder_point")}
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
            {t("pos.setup.buy_target")}
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
            {t("pos.setup.expiry_date")}
            <input
              type="date"
              value={expiryDate}
              onChange={(event) => setExpiryDate(event.target.value)}
              className="mt-2 h-11 w-full rounded-lg border border-zinc-200 bg-zinc-50 px-3 outline-none focus:border-emerald-400 focus:bg-white focus:ring-4 focus:ring-emerald-100"
            />
          </label>

          <label className="block text-sm font-bold text-zinc-700 xl:col-span-2">
            {t("pos.supplier")}
            <select
              value={productSupplierId}
              onChange={(event) => setProductSupplierId(event.target.value)}
              className="mt-2 h-11 w-full rounded-lg border border-zinc-200 bg-zinc-50 px-3 outline-none focus:border-emerald-400 focus:bg-white focus:ring-4 focus:ring-emerald-100"
            >
              <option value="">{t("pos.setup.no_supplier")}</option>
              {suppliers.map((supplier) => (
                <option key={supplier.id} value={supplier.id}>
                  {supplier.name}
                </option>
              ))}
            </select>
          </label>

          <label className="block text-sm font-bold text-zinc-700 xl:col-span-3">
            {t("pos.setup.extra_barcodes")}
            <textarea
              value={barcodeAliases}
              onChange={(event) => setBarcodeAliases(event.target.value)}
              placeholder={t("pos.setup.extra_barcodes_hint")}
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
            {t("pos.favorite")}
          </button>

          <button
            type="button"
            onClick={handleSave}
            disabled={!selectedProduct}
            className="mt-7 flex h-11 items-center justify-center gap-2 rounded-lg bg-emerald-600 px-3 text-sm font-bold text-white transition hover:bg-emerald-500 disabled:bg-zinc-300"
          >
            <Save size={17} />
            {t("pos.setup.save_setup")}
          </button>
        </div>
      </div>

      <aside className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
        <h2 className="text-lg font-bold text-zinc-950">
          {t("pos.setup.category_manager")}
        </h2>
        <p className="text-sm text-zinc-500">
          {t("pos.setup.category_manager_desc")}
        </p>

        <div className="mt-4 space-y-3">
          <select
            value={categoryFrom}
            onChange={(event) => setCategoryFrom(event.target.value)}
            className="h-11 w-full rounded-lg border border-zinc-200 bg-zinc-50 px-3 outline-none focus:border-emerald-400 focus:bg-white focus:ring-4 focus:ring-emerald-100"
          >
            <option value="">{t("pos.setup.choose_category")}</option>
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
              placeholder={t("pos.setup.new_category_name")}
              className="h-11 w-full rounded-lg border border-zinc-200 bg-zinc-50 px-3 outline-none focus:border-emerald-400 focus:bg-white focus:ring-4 focus:ring-emerald-100"
            />
            <button
              type="button"
              onClick={onSaveCategoryRename}
              className="flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-zinc-950 px-3 text-sm font-bold text-white transition hover:bg-zinc-800"
            >
              <Save size={17} />
              {t("pos.setup.rename_category")}
            </button>
          </div>
        </aside>
      </section>
    )
  }

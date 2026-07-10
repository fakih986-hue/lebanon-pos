import { useRef, useState } from "react"
import { ImagePlus, Save, Star, Trash2 } from "lucide-react"

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
  productImage: string
  onImageChange: (dataUrl: string) => void
  onToggleFavorite: () => void
  onSaveProductSetup: () => void
  onSaveCategoryRename: () => void
}

const inputBase = "input"

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
  productImage,
  onImageChange,
  onToggleFavorite,
  onSaveProductSetup,
  onSaveCategoryRename,
}: Props) {
  const { t } = useI18n()
  const imageInputRef = useRef<HTMLInputElement>(null)
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

  function handleImageFile(file: File) {
    const reader = new FileReader()
    reader.onload = (e) => {
      const dataUrl = e.target?.result as string
      // Resize to max 300x300 using canvas
      const img = new Image()
      img.onload = () => {
        const MAX = 300
        const scale = Math.min(MAX / img.width, MAX / img.height, 1)
        const canvas = document.createElement("canvas")
        canvas.width = Math.round(img.width * scale)
        canvas.height = Math.round(img.height * scale)
        canvas.getContext("2d")?.drawImage(img, 0, 0, canvas.width, canvas.height)
        onImageChange(canvas.toDataURL("image/jpeg", 0.8))
      }
      img.src = dataUrl
    }
    reader.readAsDataURL(file)
  }

  return (
    <section className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
      <div className="card p-4">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-lg" style={{ backgroundColor: "var(--brand-soft)", color: "var(--brand-text)" }}>
            <Save size={21} />
          </div>
          <div>
            <h2 className="text-lg font-bold" style={{ color: "var(--text)" }}>
              {t("pos.setup.title")}
            </h2>
            <p className="text-sm" style={{ color: "var(--text-3)" }}>{t("pos.setup.desc")}</p>
          </div>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          <label className="block text-sm font-bold xl:col-span-2" style={{ color: "var(--text-2)" }}>
            {t("pos.product")}
            <select
              value={selectedProduct?.id ?? ""}
              onChange={(event) =>
                setSelectedProductId(Number(event.target.value))
              }
              className={inputBase}
            >
              {products.map((product) => (
                <option key={product.id} value={product.id}>
                  {product.name}
                </option>
              ))}
            </select>
          </label>

          <label className="block text-sm font-bold" style={{ color: "var(--text-2)" }}>
            {t("pos.category")}
            <input
              value={productCategory}
              list="catalog-categories"
              onChange={(event) => setProductCategory(event.target.value)}
              className={inputBase}
              style={formErrors.category ? { borderColor: "var(--danger)", backgroundColor: "var(--danger-soft)" } : undefined}
            />
            {formErrors.category ? (
              <p className="mt-1 text-xs font-medium" style={{ color: "var(--danger-text)" }}>{formErrors.category}</p>
            ) : null}
          </label>

          <label className="block text-sm font-bold" style={{ color: "var(--text-2)" }}>
            {t("pos.setup.reorder_point")}
            <input
              type="number"
              min="0"
              value={reorderPoint}
              onChange={(event) => setReorderPoint(event.target.value)}
              className={inputBase}
              style={formErrors.reorderPoint ? { borderColor: "var(--danger)", backgroundColor: "var(--danger-soft)" } : undefined}
            />
            {formErrors.reorderPoint ? (
              <p className="mt-1 text-xs font-medium" style={{ color: "var(--danger-text)" }}>{formErrors.reorderPoint}</p>
            ) : null}
          </label>

          <label className="block text-sm font-bold" style={{ color: "var(--text-2)" }}>
            {t("pos.setup.buy_target")}
            <input
              type="number"
              min="0"
              value={reorderQuantity}
              onChange={(event) => setReorderQuantity(event.target.value)}
              className={inputBase}
              style={formErrors.reorderQuantity ? { borderColor: "var(--danger)", backgroundColor: "var(--danger-soft)" } : undefined}
            />
            {formErrors.reorderQuantity ? (
              <p className="mt-1 text-xs font-medium" style={{ color: "var(--danger-text)" }}>{formErrors.reorderQuantity}</p>
            ) : null}
          </label>

          <label className="block text-sm font-bold" style={{ color: "var(--text-2)" }}>
            {t("pos.setup.expiry_date")}
            <input
              type="date"
              value={expiryDate}
              onChange={(event) => setExpiryDate(event.target.value)}
              className={inputBase}
            />
          </label>

          <label className="block text-sm font-bold xl:col-span-2" style={{ color: "var(--text-2)" }}>
            {t("pos.supplier")}
            <select
              value={productSupplierId}
              onChange={(event) => setProductSupplierId(event.target.value)}
              className={inputBase}
            >
              <option value="">{t("pos.setup.no_supplier")}</option>
              {suppliers.map((supplier) => (
                <option key={supplier.id} value={supplier.id}>
                  {supplier.name}
                </option>
              ))}
            </select>
          </label>

          <label className="block text-sm font-bold xl:col-span-3" style={{ color: "var(--text-2)" }}>
            {t("pos.setup.extra_barcodes")}
            <textarea
              value={barcodeAliases}
              onChange={(event) => setBarcodeAliases(event.target.value)}
              placeholder={t("pos.setup.extra_barcodes_hint")}
              rows={2}
              className="mt-2 w-full resize-none rounded-lg border px-3 py-2 outline-none input"
              style={{ backgroundColor: "var(--surface-2)" }}
            />
          </label>

          {/* Image upload */}
          <div className="xl:col-span-2 flex items-center gap-3">
            {productImage ? (
              <img src={productImage} alt="Product" className="h-14 w-14 rounded-lg object-cover shrink-0" style={{ border: "1px solid var(--border)" }} />
            ) : (
              <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg border-2 border-dashed" style={{ borderColor: "var(--border)", backgroundColor: "var(--surface-2)", color: "var(--text-3)" }}>
                <ImagePlus size={22} />
              </div>
            )}
            <div className="flex flex-col gap-1.5">
              <button
                type="button"
                onClick={() => imageInputRef.current?.click()}
                disabled={!selectedProduct}
                className="btn-default btn-sm"
              >
                <ImagePlus size={14} />
                {t("pos.setup.upload_image")}
              </button>
              {productImage && (
                <button
                  type="button"
                  onClick={() => onImageChange("")}
                  className="btn-default btn-sm"
                  style={{ borderColor: "var(--danger)", backgroundColor: "var(--danger-soft)", color: "var(--danger-text)" }}
                >
                  <Trash2 size={14} />
                  {t("pos.setup.remove_image")}
                </button>
              )}
            </div>
            <input
              ref={imageInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) handleImageFile(f); e.target.value = "" }}
            />
          </div>

          <button
            type="button"
            onClick={onToggleFavorite}
            disabled={!selectedProduct}
            className="btn-md mt-7 flex h-11 items-center justify-center gap-2 rounded-lg border font-bold transition"
            style={selectedProduct?.favorite
              ? { borderColor: "var(--brand-border)", backgroundColor: "var(--brand-soft)", color: "var(--brand-text)" }
              : { borderColor: "var(--border)", backgroundColor: "var(--surface)", color: "var(--text-2)" }}
            onMouseEnter={(e) => {
              if (selectedProduct?.favorite) return
              e.currentTarget.style.backgroundColor = "var(--surface-hover)"
              e.currentTarget.style.color = "var(--text)"
            }}
            onMouseLeave={(e) => {
              if (selectedProduct?.favorite) return
              e.currentTarget.style.backgroundColor = "var(--surface)"
              e.currentTarget.style.color = "var(--text-2)"
            }}
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
            className="btn-primary btn-md mt-7"
          >
            <Save size={17} />
            {t("pos.setup.save_setup")}
          </button>
        </div>
      </div>

      <aside className="card p-4">
        <h2 className="text-lg font-bold" style={{ color: "var(--text)" }}>
          {t("pos.setup.category_manager")}
        </h2>
        <p className="text-sm" style={{ color: "var(--text-3)" }}>
          {t("pos.setup.category_manager_desc")}
        </p>

        <div className="mt-4 space-y-3">
          <select
            value={categoryFrom}
            onChange={(event) => setCategoryFrom(event.target.value)}
            className={inputBase}
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
              className={inputBase}
            />
            <button
              type="button"
              onClick={onSaveCategoryRename}
              className="btn-primary btn-md w-full"
            >
              <Save size={17} />
              {t("pos.setup.rename_category")}
            </button>
          </div>
        </aside>
      </section>
    )
  }

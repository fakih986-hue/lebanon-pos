import { useRef, useState } from "react"
import { Barcode, ImagePlus, Plus, Trash2 } from "lucide-react"
import { useI18n } from "@lebanonpos/shared"

import { formatCurrency, formatNumber } from "../../lib/currency"
import { fileToCompressedDataUrl } from "../../lib/image"
import { createProduct, deleteProduct, generateProductBarcode, updateProduct } from "../../services/product.service"
import type { SupplierLedger } from "../../services/supplier.service"
import { showToast } from "../../services/toast.service"
import type { Product } from "../../types/product"
import { Drawer, Field } from "./BackOffice"

type Errors = Partial<Record<"name" | "category" | "barcode" | "aliases" | "price" | "cost" | "reorderPoint" | "reorderQuantity" | "stock" | "variantName", string>>
const code = (v: string) => v.trim().replace(/\s+/g, "")
const splitAliases = (v: string) => Array.from(new Set(v.split(/[\n,]+/).map(code).filter(Boolean)))

/**
 * Create or edit a product (Drawer, 640 px). Quantities are never edited here: existing stock changes
 * only through receiving, sales and stock adjustments; a new product's opening stock becomes its first
 * lot (createProduct → receive batch). Fixable errors never disable Save: Save moves focus to the
 * first problem (DESIGN-SYSTEM §8).
 */
export default function ProductEditorDrawer({ mode, product, products, categories, suppliers, onClose, onSaved }: {
  mode: "create" | "edit"; product?: Product; products: Product[]; categories: string[]; suppliers: SupplierLedger[]
  onClose: () => void; onSaved: (p: Product) => void
}) {
  const { t } = useI18n()
  const p = product
  const [name, setName] = useState(p?.name ?? "")
  const [category, setCategory] = useState(p?.category ?? "")
  const [barcode, setBarcode] = useState(p?.barcode ?? "")
  const [aliases, setAliases] = useState((p?.barcodeAliases ?? []).join(", "))
  const [price, setPrice] = useState(p ? String(p.price) : "")
  const [cost, setCost] = useState(p ? String(p.cost) : "")
  const [reorderPoint, setReorderPoint] = useState(String(p?.reorderPoint ?? 10))
  const [reorderQuantity, setReorderQuantity] = useState(String(p?.reorderQuantity ?? 20))
  const [supplierId, setSupplierId] = useState(p?.supplierId ?? "")
  const [image, setImage] = useState(p?.image ?? "")
  const [stock, setStock] = useState("0")
  const [isParent, setIsParent] = useState(!!p?.isParent)
  const [variantName, setVariantName] = useState(p?.variantName ?? "")
  const [errors, setErrors] = useState<Errors>({})
  const [saving, setSaving] = useState(false)
  const imageRef = useRef<HTMLInputElement>(null)
  const formRef = useRef<HTMLDivElement>(null)
  // New variant row (edit mode)
  const [vName, setVName] = useState(""); const [vPrice, setVPrice] = useState(""); const [vBarcode, setVBarcode] = useState(""); const [vStock, setVStock] = useState("0")
  const variants = p ? products.filter((x) => x.parentId === p.id) : []

  const usedBy = (c: string) => products.find((x) => x.id !== p?.id && ((x.barcode ?? "") === c || (x.barcodeAliases ?? []).includes(c)))
  const priceN = Number(price), costN = Number(cost)
  const marginPct = priceN > 0 && Number.isFinite(costN) ? Math.round(((priceN - costN) / priceN) * 100) : null

  function validate(): Errors {
    const e: Errors = {}
    if (!name.trim()) e.name = t("inv.err.name")
    if (!category.trim()) e.category = t("inv.err.category")
    const b = code(barcode)
    if (mode === "create" && !b) e.barcode = t("inv.err.barcode")
    else if (b && usedBy(b)) e.barcode = t("inv.err.barcode_used", { name: usedBy(b)!.name })
    for (const a of splitAliases(aliases)) {
      if (a === b) continue
      const u = usedBy(a)
      if (u) { e.aliases = t("inv.err.alias_used", { code: a, name: u.name }); break }
    }
    if (price.trim() === "" || !Number.isFinite(priceN) || priceN < 0) e.price = t("inv.err.price")
    if (cost.trim() !== "" && (!Number.isFinite(costN) || costN < 0)) e.cost = t("inv.err.cost")
    for (const [k, v] of [["reorderPoint", reorderPoint], ["reorderQuantity", reorderQuantity]] as const) {
      const n = Number(v); if (v.trim() !== "" && (!Number.isFinite(n) || n < 0)) e[k] = t("inv.err.non_negative")
    }
    if (mode === "create") { const n = Number(stock); if (!Number.isFinite(n) || n < 0) e.stock = t("inv.err.non_negative") }
    if (p?.parentId && !variantName.trim()) e.variantName = t("inv.err.variant_name")
    return e
  }

  function save() {
    if (saving) return
    const e = validate()
    setErrors(e)
    if (Object.keys(e).length > 0) {
      // Save stays enabled; it takes the user to the first problem.
      window.requestAnimationFrame(() => formRef.current?.querySelector<HTMLElement>("[aria-invalid='true']")?.focus())
      return
    }
    const supplier = suppliers.find((s) => s.id === supplierId)
    const common = {
      name: name.trim(), category: category.trim(), price: priceN, cost: Number.isFinite(costN) ? costN : 0,
      reorderPoint: Number(reorderPoint) || 0, reorderQuantity: Number(reorderQuantity) || 0,
      supplierId: supplier?.id ?? "", supplierName: supplier?.name ?? "",
      barcodeAliases: splitAliases(aliases).filter((a) => a !== code(barcode)),
      image: image || undefined,
    }
    setSaving(true)
    try {
      if (mode === "create") {
        const created = createProduct({ ...common, barcode: code(barcode), stock: Number(stock) || 0 })
        if (!created) { setErrors({ barcode: t("inv.err.barcode_taken") }); return }
        showToast(t("inv.created", { name: created.name }))
        onSaved(created)
      } else if (p) {
        const updated = updateProduct(p.id, { ...common, barcode: code(barcode) || undefined, isParent, ...(p.parentId ? { variantName: variantName.trim() } : {}) })
        if (!updated) { setErrors({ barcode: t("inv.err.barcode_taken") }); return }
        showToast(t("inv.saved", { name: updated.name }))
        onSaved(updated)
      }
    } catch (err) {
      showToast(String((err as Error)?.message ?? err), "error")
    } finally {
      setSaving(false)
    }
  }

  function addVariant() {
    if (!p) return
    const b = code(vBarcode)
    if (!vName.trim() || !b) { showToast(t("inv.err.variant_needs"), "error"); return }
    if (usedBy(b) || b === p.barcode) { showToast(t("inv.err.barcode_used", { name: usedBy(b)?.name ?? p.name }), "error"); return }
    try {
      const v = createProduct({ name: `${p.name} - ${vName.trim()}`, price: Number(vPrice) || p.price, cost: p.cost, stock: Number(vStock) || 0, barcode: b, category: p.category, accent: p.accent, parentId: p.id, variantName: vName.trim() })
      if (!v) { showToast(t("inv.err.barcode_taken"), "error"); return }
      if (!p.isParent) updateProduct(p.id, { isParent: true })
      setIsParent(true)
      setVName(""); setVPrice(""); setVBarcode(""); setVStock("0")
      showToast(t("inv.variant_added", { name: vName.trim() }))
    } catch (err) { showToast(String((err as Error)?.message ?? err), "error") }
  }
  function removeVariant(v: Product) {
    try { deleteProduct(v.id); showToast(t("inv.deleted", { name: v.name })) } catch (err) { showToast(String((err as Error)?.message ?? err), "error") }
  }

  return (
    <Drawer open wide title={mode === "create" ? t("inv.products.add") : t("inv.edit_name", { name: p?.name ?? "" })} onClose={onClose}
      footer={<>
        <button type="button" className="mg2-btn mg2-btn-primary" onClick={save} aria-busy={saving || undefined}>{mode === "create" ? t("inv.create") : t("inv.save")}</button>
        <button type="button" className="mg2-btn mg2-btn-ghost" onClick={onClose}>{t("inv.cancel")}</button>
        {Object.keys(errors).length > 0 && <span className="mg2-cap" role="alert" style={{ color: "var(--v2-err)" }}>{t("inv.err.summary", { n: Object.keys(errors).length })}</span>}
      </>}>
      <div ref={formRef} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
            <button type="button" className="mg2-btn" style={{ width: 72, height: 72, padding: 0, overflow: "hidden" }} onClick={() => imageRef.current?.click()} aria-label={t("inv.image_pick")}>
              {image ? <img src={image} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <ImagePlus size={22} />}
            </button>
            {image && <button type="button" className="mg2-btn mg2-btn-ghost" style={{ minHeight: 32 }} onClick={() => setImage("")}>{t("inv.remove")}</button>}
            <input ref={imageRef} type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) fileToCompressedDataUrl(f).then(setImage).catch(() => showToast(t("inv.image_failed"), "error")); e.target.value = "" }} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <Field label={t("inv.field.name")} error={errors.name}>{(a) => <input {...a} className="mg2-input" value={name} onChange={(e) => setName(e.target.value)} data-autofocus />}</Field>
          </div>
        </div>
        {p?.parentId && <Field label={t("inv.field.variant_name")} error={errors.variantName} help={t("inv.variant_help")}>{(a) => <input {...a} className="mg2-input" value={variantName} onChange={(e) => setVariantName(e.target.value)} />}</Field>}
        <div className="mg2-grid2">
          <Field label={t("inv.field.category")} error={errors.category}>{(a) => <input {...a} className="mg2-input" list="inv-editor-categories" value={category} onChange={(e) => setCategory(e.target.value)} />}</Field>
          <Field label={t("inv.field.supplier")}>{(a) => (
            <select {...a} className="mg2-select" value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
              <option value="">{t("inv.no_supplier")}</option>
              {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          )}</Field>
        </div>
        <datalist id="inv-editor-categories">{categories.map((c) => <option key={c} value={c} />)}</datalist>
        <Field label={t("inv.field.barcode")} error={errors.barcode} help={mode === "edit" ? t("inv.barcode_help_edit") : undefined}>{(a) => (
          <div style={{ display: "flex", gap: 8 }}>
            <input {...a} className="mg2-input num" dir="ltr" style={{ flex: 1 }} value={barcode} onChange={(e) => setBarcode(e.target.value)} inputMode="numeric" />
            <button type="button" className="mg2-btn" onClick={() => setBarcode(generateProductBarcode())}><Barcode size={16} />{t("inv.generate")}</button>
          </div>
        )}</Field>
        <Field label={t("inv.field.aliases")} error={errors.aliases} help={t("inv.aliases_help")}>{(a) => <input {...a} className="mg2-input num" dir="ltr" value={aliases} onChange={(e) => setAliases(e.target.value)} />}</Field>
        <div className="mg2-grid2">
          <Field label={t("inv.field.price")} error={errors.price}>{(a) => (
            <span className="mg2-money"><span className="mg2-adorn">$</span><input {...a} type="number" min="0" step="0.01" inputMode="decimal" dir="ltr" value={price} onChange={(e) => setPrice(e.target.value)} /></span>
          )}</Field>
          <Field label={t("inv.field.cost")} error={errors.cost} help={marginPct !== null ? t("inv.margin_is", { n: marginPct }) : undefined}>{(a) => (
            <span className="mg2-money"><span className="mg2-adorn">$</span><input {...a} type="number" min="0" step="0.01" inputMode="decimal" dir="ltr" value={cost} onChange={(e) => setCost(e.target.value)} /></span>
          )}</Field>
          <Field label={t("inv.field.reorder_point")} error={errors.reorderPoint} help={t("inv.reorder_point_help")}>{(a) => <input {...a} className="mg2-input num" type="number" min="0" step="1" dir="ltr" value={reorderPoint} onChange={(e) => setReorderPoint(e.target.value)} />}</Field>
          <Field label={t("inv.field.reorder_qty")} error={errors.reorderQuantity}>{(a) => <input {...a} className="mg2-input num" type="number" min="0" step="1" dir="ltr" value={reorderQuantity} onChange={(e) => setReorderQuantity(e.target.value)} />}</Field>
        </div>
        {mode === "create" ? (
          <Field label={t("inv.field.opening_stock")} error={errors.stock} help={t("inv.opening_stock_help")}>{(a) => <input {...a} className="mg2-input num" type="number" min="0" step="1" dir="ltr" value={stock} onChange={(e) => setStock(e.target.value)} />}</Field>
        ) : p && !p.isParent ? (
          <p className="mg2-cap" style={{ margin: 0 }}>{t("inv.stock_not_here", { n: formatNumber(p.stock) })}</p>
        ) : null}

        {mode === "edit" && p && !p.parentId && (
          <section className="mg2-card" style={{ padding: 12, display: "flex", flexDirection: "column", gap: 10 }}>
            <label style={{ display: "flex", gap: 10, alignItems: "center", fontWeight: 600 }}>
              <input type="checkbox" className="mg2-check" checked={isParent} onChange={(e) => setIsParent(e.target.checked)} />
              {t("inv.has_variants")}
            </label>
            {isParent && (<>
              {variants.length === 0 ? <p className="mg2-cap" style={{ margin: 0 }}>{t("inv.no_variants")}</p> : (
                <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 6 }}>
                  {variants.map((v) => (
                    <li key={v.id} style={{ display: "flex", gap: 8, alignItems: "center", justifyContent: "space-between" }}>
                      <span><strong>{v.variantName ?? v.name}</strong> <span className="mg2-cap num" dir="ltr">{v.barcode}</span> <span className="mg2-cap">· {formatCurrency(v.price)} · {t("inv.stock_n", { n: formatNumber(v.stock) })}</span></span>
                      <button type="button" className="mg2-btn mg2-btn-ghost" style={{ width: 40, padding: 0 }} onClick={() => removeVariant(v)} aria-label={t("inv.remove_variant", { name: v.variantName ?? v.name })}><Trash2 size={15} /></button>
                    </li>
                  ))}
                </ul>
              )}
              <div className="mg2-grid2">
                <input className="mg2-input" value={vName} onChange={(e) => setVName(e.target.value)} placeholder={t("inv.field.variant_name")} aria-label={t("inv.field.variant_name")} />
                <input className="mg2-input num" dir="ltr" value={vBarcode} onChange={(e) => setVBarcode(e.target.value)} placeholder={t("inv.field.barcode")} aria-label={t("inv.variant_barcode")} />
                <input className="mg2-input num" type="number" min="0" step="0.01" dir="ltr" value={vPrice} onChange={(e) => setVPrice(e.target.value)} placeholder={t("inv.field.price")} aria-label={t("inv.variant_price")} />
                <input className="mg2-input num" type="number" min="0" step="1" dir="ltr" value={vStock} onChange={(e) => setVStock(e.target.value)} placeholder={t("inv.field.opening_stock")} aria-label={t("inv.variant_stock")} />
              </div>
              <button type="button" className="mg2-btn" onClick={addVariant} style={{ alignSelf: "flex-start" }}><Plus size={16} />{t("inv.add_variant")}</button>
            </>)}
          </section>
        )}
      </div>
    </Drawer>
  )
}

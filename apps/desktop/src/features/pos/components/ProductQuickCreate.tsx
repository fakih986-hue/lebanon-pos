import { useState } from "react"
import { X } from "lucide-react"
import { createProduct } from "../services/product.service"
import { showToast } from "../services/toast.service"
import type { ProductAccent } from "../types/product"

type Props = {
  categories: string[]
  onClose: () => void
  onCreated: () => void
}

export default function ProductQuickCreate({ categories, onClose, onCreated }: Props) {
  const [name, setName] = useState("")
  const [category, setCategory] = useState("")
  const [barcode, setBarcode] = useState("")
  const [price, setPrice] = useState("")
  const [cost, setCost] = useState("")
  const [stock, setStock] = useState("0")
  const [error, setError] = useState("")

  function handleCreate() {
    setError("")
    if (!name.trim()) { setError("Product name is required"); return }
    if (!category.trim()) { setError("Category is required"); return }
    if (!barcode.trim()) { setError("Barcode is required"); return }

    const result = createProduct({
      name: name.trim(),
      category: category.trim(),
      barcode: barcode.trim(),
      price: Number(price) || 0,
      cost: Number(cost) || 0,
      stock: Number(stock) || 0,
    })

    if (!result) {
      setError("Could not create — barcode may already be in use")
      return
    }

    showToast(`${result.name} created`)
    onCreated()
    onClose()
  }

  return (
    <div className="modal-overlay" style={{ zIndex: 100 }} onClick={onClose}>
      <div className="modal-card" style={{ maxWidth: 480 }} onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b px-5 py-4" style={{ borderColor: "var(--border)" }}>
          <h2 className="text-[15px] font-bold" style={{ color: "var(--text)" }}>Quick Create Product</h2>
          <button onClick={onClose} className="icon-btn" aria-label="Close quick create" style={{ color: "var(--text-3)" }}><X size={18} /></button>
        </div>

        <div className="p-5 flex flex-col gap-3">
          <label className="block">
            <span className="block text-[12px] font-bold mb-1" style={{ color: "var(--text-2)" }}>Name *</span>
            <input autoFocus value={name} onChange={e => setName(e.target.value)} placeholder="Product name" className="input w-full" />
          </label>

          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="block text-[12px] font-bold mb-1" style={{ color: "var(--text-2)" }}>Barcode *</span>
              <input value={barcode} onChange={e => setBarcode(e.target.value)} placeholder="Scan or type" className="input w-full font-mono" />
            </label>
            <label className="block">
              <span className="block text-[12px] font-bold mb-1" style={{ color: "var(--text-2)" }}>Category *</span>
              <input value={category} onChange={e => setCategory(e.target.value)}
                list="quick-create-cats" placeholder="Type or select"
                className="input w-full" />
              <datalist id="quick-create-cats">
                {categories.filter(c => c !== "All").map(c => <option key={c} value={c} />)}
              </datalist>
            </label>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <label className="block">
              <span className="block text-[12px] font-bold mb-1" style={{ color: "var(--text-2)" }}>Price $</span>
              <input type="number" min="0" step="0.01" value={price} onChange={e => setPrice(e.target.value)} className="input w-full" />
            </label>
            <label className="block">
              <span className="block text-[12px] font-bold mb-1" style={{ color: "var(--text-2)" }}>Cost $</span>
              <input type="number" min="0" step="0.01" value={cost} onChange={e => setCost(e.target.value)} className="input w-full" />
            </label>
            <label className="block">
              <span className="block text-[12px] font-bold mb-1" style={{ color: "var(--text-2)" }}>Stock</span>
              <input type="number" min="0" value={stock} onChange={e => setStock(e.target.value)} className="input w-full" />
            </label>
          </div>

          {price && cost && Number(price) > 0 ? (
            <p className="text-[11px]" style={{ color: "var(--text-3)" }}>
              Margin: {Number(cost) > 0 ? (((Number(price) - Number(cost)) / Number(price)) * 100).toFixed(0) : 0}%
            </p>
          ) : null}

          {error ? (
            <p className="text-[12px] font-semibold rounded-lg px-3 py-2" style={{ background: "var(--rose-50)", color: "var(--rose-600)" }}>
              {error}
            </p>
          ) : null}

          <div className="flex gap-2 pt-1">
            <button onClick={handleCreate} className="btn btn-primary flex-1">Create Product</button>
            <button onClick={onClose} className="btn btn-default">Cancel</button>
          </div>
        </div>
      </div>
    </div>
  )
}

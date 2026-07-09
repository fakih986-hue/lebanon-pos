import { useEffect, useRef, useState } from "react"
import type { Product } from "../types/product"
import { X } from "lucide-react"

type Props = {
  product: Product
  editName: string; onEditNameChange: (v: string) => void
  editCategory: string; onEditCategoryChange: (v: string) => void
  editPrice: string; onEditPriceChange: (v: string) => void
  editCost: string; onEditCostChange: (v: string) => void
  editBarcode: string; onEditBarcodeChange: (v: string) => void
  editBarcodeAliases: string; onEditBarcodeAliasesChange: (v: string) => void
  editReorderPoint: string; onEditReorderPointChange: (v: string) => void
  editReorderQty: string; onEditReorderQtyChange: (v: string) => void
  error?: string
  onSave: () => void
  onClose: () => void
}

export default function ProductEditDrawer(props: Props) {
  const { product, onClose, onSave, error } = props
  const drawerRef = useRef<HTMLDivElement>(null)
  const [isClosing, setIsClosing] = useState(false)

  function close() {
    setIsClosing(true)
    setTimeout(() => { setIsClosing(false); onClose() }, 180)
  }

  useEffect(() => {
    setIsClosing(false)
    drawerRef.current?.focus()
  }, [product.id])

  return (
    <div className="fixed inset-0 z-[110]" onClick={close}>
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50 backdrop-blur-[2px]" />

      {/* Drawer */}
      <div
        ref={drawerRef}
        tabIndex={-1}
        onClick={e => e.stopPropagation()}
        onKeyDown={e => { if (e.key === "Escape") { e.preventDefault(); close() }}}
        className={`absolute top-0 right-0 bottom-0 w-full max-w-md overflow-y-auto shadow-2xl transition-transform duration-200 ${isClosing ? "translate-x-full" : "translate-x-0"}`}
        style={{ background: "var(--surface)" }}
        role="dialog"
        aria-label="Edit product"
      >
        {/* Header */}
        <div className="sticky top-0 z-10 flex items-center justify-between border-b px-5 py-4" style={{ background: "var(--surface)", borderColor: "var(--border)" }}>
          <h2 className="text-[15px] font-bold" style={{ color: "var(--text)" }}>Edit Product</h2>
          <button onClick={close} className="icon-btn" style={{ color: "var(--text-3)" }} aria-label="Close edit drawer">
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 flex flex-col gap-4">
          {error && (
            <div className="rounded-xl p-3 text-[12px] font-bold" style={{ background: "var(--rose-soft)", color: "var(--rose-text)" }}>
              {error}
            </div>
          )}

          <label className="block">
            <span className="block text-[12px] font-bold mb-1" style={{ color: "var(--text-2)" }}>Name</span>
            <input value={props.editName} onChange={e => props.onEditNameChange(e.target.value)}
              className="input w-full" autoFocus />
          </label>
          <label className="block">
            <span className="block text-[12px] font-bold mb-1" style={{ color: "var(--text-2)" }}>Category</span>
            <input value={props.editCategory} onChange={e => props.onEditCategoryChange(e.target.value)}
              className="input w-full" />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="block text-[12px] font-bold mb-1" style={{ color: "var(--text-2)" }}>Price $</span>
              <input type="number" min="0" step="0.01" value={props.editPrice} onChange={e => props.onEditPriceChange(e.target.value)}
                className="input w-full" />
            </label>
            <label className="block">
              <span className="block text-[12px] font-bold mb-1" style={{ color: "var(--text-2)" }}>Cost $</span>
              <input type="number" min="0" step="0.01" value={props.editCost} onChange={e => props.onEditCostChange(e.target.value)}
                className="input w-full" />
            </label>
          </div>
          <label className="block">
            <span className="block text-[12px] font-bold mb-1" style={{ color: "var(--text-2)" }}>Barcode</span>
            <input value={props.editBarcode} onChange={e => props.onEditBarcodeChange(e.target.value)}
              className="input w-full font-mono" />
          </label>
          <label className="block">
            <span className="block text-[12px] font-bold mb-1" style={{ color: "var(--text-2)" }}>
              Barcode Aliases <span className="font-normal" style={{ color: "var(--text-3)" }}>(comma-separated)</span>
            </span>
            <input value={props.editBarcodeAliases} onChange={e => props.onEditBarcodeAliasesChange(e.target.value)}
              placeholder="5281000123457, 5281000123458" className="input w-full font-mono" />
          </label>
          <div className="grid grid-cols-3 gap-3">
            <label className="block">
              <span className="block text-[12px] font-bold mb-1" style={{ color: "var(--text-2)" }}>Stock</span>
              <span className="flex items-center h-10 px-3 rounded-lg text-sm font-semibold"
                style={{ background: "var(--surface-2)", color: "var(--text-2)" }}>{product.stock ?? "—"} units</span>
              <p className="text-[10px] mt-0.5" style={{ color: "var(--text-3)" }}>Use receiving to change stock</p>
            </label>
            <label className="block">
              <span className="block text-[12px] font-bold mb-1" style={{ color: "var(--text-2)" }}>Reorder Pt</span>
              <input type="number" min="0" value={props.editReorderPoint} onChange={e => props.onEditReorderPointChange(e.target.value)}
                className="input w-full" />
            </label>
            <label className="block">
              <span className="block text-[12px] font-bold mb-1" style={{ color: "var(--text-2)" }}>Reorder Qty</span>
              <input type="number" min="0" value={props.editReorderQty} onChange={e => props.onEditReorderQtyChange(e.target.value)}
                className="input w-full" />
            </label>
          </div>
        </div>

        {/* Footer */}
        <div className="sticky bottom-0 border-t px-5 py-4 flex gap-3" style={{ background: "var(--surface)", borderColor: "var(--border)" }}>
          <button type="button" onClick={close}
            className="btn btn-default flex-1 h-11">Cancel</button>
          <button type="button" onClick={() => { onSave(); close() }}
            className="btn btn-primary flex-1 h-11">Save Changes</button>
        </div>
      </div>
    </div>
  )
}

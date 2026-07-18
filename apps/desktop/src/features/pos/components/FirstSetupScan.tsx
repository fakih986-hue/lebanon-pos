import { useMemo, useRef, useState, useEffect } from "react"
import { ArrowLeft, ScanLine, Check, X, Image as ImageIcon } from "lucide-react"

import type { Product } from "../types/product"
import type { StoreStatus } from "../lib/storeSetup"
import { getProductsSync } from "../services/product.service"
import { fileToCompressedDataUrl } from "../lib/image"
import { showToast } from "../services/toast.service"
import {
  resolveScannedBarcode,
  commitScanSetup,
  type ScanCommitMode,
} from "../services/scanSetup.service"

// POS-FIRST-SETUP-CATALOG-1D: fast one-by-one scan into OPENING inventory.
// Preview/resolution is pure; commit uses commitScanSetup (opening flag) so no
// Receive movement and no supplier PO/payment is ever produced.

type SessionRow = { name: string; qty: number; value: number; kind: string }

const num = (s: string) => (s.trim() === "" ? 0 : Number(s))

export default function FirstSetupScan({
  storeStatus, onBack, onFinish,
}: {
  storeStatus: StoreStatus
  onBack: () => void
  onFinish: () => void
}) {
  const [products, setProducts] = useState<Product[]>(() => getProductsSync())
  const [barcode, setBarcode] = useState("")
  const [name, setName] = useState("")
  const [category, setCategory] = useState("General")
  const [cost, setCost] = useState("")
  const [price, setPrice] = useState("")
  const [qty, setQty] = useState("")
  const [extra, setExtra] = useState("")
  const [image, setImage] = useState<string | null>(null)
  // name-nudge decision: "new" keeps as new product; "alias" attaches barcode.
  const [nudge, setNudge] = useState<"new" | "alias">("new")
  const [session, setSession] = useState<SessionRow[]>([])
  const barcodeRef = useRef<HTMLInputElement>(null)
  const lastExistingId = useRef<number | null>(null)

  const resolution = useMemo(
    () => resolveScannedBarcode(barcode, name, products),
    [barcode, name, products],
  )
  const existing = resolution.kind === "existing" ? resolution.product : null
  const nameMatches = resolution.kind === "new" ? resolution.nameMatches : []

  // When a barcode resolves to an existing product, prefill its details once.
  useEffect(() => {
    if (existing && lastExistingId.current !== existing.id) {
      lastExistingId.current = existing.id
      setName(existing.name)
      setCategory(existing.category)
      setCost(String(existing.cost))
      setPrice(String(existing.price))
    } else if (!existing) {
      lastExistingId.current = null
    }
  }, [existing])

  function onImage(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) fileToCompressedDataUrl(file).then(setImage).catch(() => undefined)
    e.target.value = ""
  }

  function resetRow() {
    setBarcode(""); setName(""); setCost(""); setPrice(""); setQty(""); setExtra(""); setImage(null); setNudge("new")
    lastExistingId.current = null
    barcodeRef.current?.focus()
  }

  const parsedQty = Math.max(0, Math.floor(num(qty)))
  const canSave = barcode.trim() !== "" && (existing ? parsedQty > 0 : name.trim() !== "")

  function doCommit(): boolean {
    let mode: ScanCommitMode = "new"
    let targetId: number | undefined
    if (existing) { mode = "existing"; targetId = existing.id }
    else if (nameMatches.length > 0 && nudge === "alias") { mode = "alias"; targetId = nameMatches[0].id }

    const res = commitScanSetup({
      mode, targetId,
      barcode, name, category,
      cost: num(cost), price: num(price), openingQty: parsedQty,
      extraBarcodes: extra.split(/[|,;\s]+/).filter(Boolean),
      image,
    })
    if (!res.ok) { showToast(res.error ?? "Could not save product", "error"); return false }

    const label = existing ? existing.name : (mode === "alias" ? nameMatches[0].name : name)
    setSession((s) => [{ name: label, qty: parsedQty, value: parsedQty * num(cost), kind: res.kind }, ...s])
    setProducts(getProductsSync())
    return true
  }

  function saveNext() { if (canSave && doCommit()) resetRow() }
  function saveFinish() {
    if (canSave && !doCommit()) return
    onFinish()
  }

  const totalUnits = session.reduce((n, r) => n + r.qty, 0)
  const totalValue = session.reduce((n, r) => n + r.value, 0)

  return (
    <div className="space-y-3">
      <button type="button" onClick={onBack} className="btn btn-ghost btn-sm gap-1"><ArrowLeft size={13} /> Back</button>

      {storeStatus !== "fresh" && (
        <div className="rounded-xl p-3 text-[12px]" style={{ background: "var(--amber-soft)", color: "var(--amber)" }}>
          This store already has activity — scan setup records <strong>opening inventory</strong>. For everyday restocking use <strong>Receive stock</strong> instead.
        </div>
      )}

      <div className="rounded-xl border p-3 space-y-2.5" style={{ borderColor: "var(--border)" }}>
        <label className="block">
          <span className="text-[11px] font-semibold" style={{ color: "var(--text-3)" }}>Barcode</span>
          <div className="flex items-center gap-2">
            <ScanLine size={16} style={{ color: "var(--brand)" }} />
            <input ref={barcodeRef} autoFocus value={barcode} onChange={(e) => setBarcode(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") e.preventDefault() }}
              placeholder="Scan or type…" className="input flex-1" aria-label="Barcode" />
          </div>
        </label>

        {existing && (
          <div className="rounded-lg p-2.5 text-[12px]" style={{ background: "var(--brand-soft)", color: "var(--brand-text)" }}>
            <strong>{existing.name}</strong> already exists (stock {existing.stock}).{resolution.kind === "existing" && resolution.matchedAlias ? " Scanned an existing extra barcode." : ""} Enter an opening quantity to add.
          </div>
        )}

        {!existing && nameMatches.length > 0 && (
          <div className="rounded-lg p-2.5 text-[12px] space-y-1.5" style={{ background: "var(--amber-soft)", color: "var(--amber)" }}>
            <p><strong>{nameMatches[0].name}</strong> already exists with a different barcode.</p>
            <div className="flex gap-2">
              <button type="button" onClick={() => setNudge("alias")}
                className={`btn btn-sm ${nudge === "alias" ? "btn-primary" : "btn-default"}`}>Add barcode to it</button>
              <button type="button" onClick={() => setNudge("new")}
                className={`btn btn-sm ${nudge === "new" ? "btn-primary" : "btn-default"}`}>Keep as new</button>
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 gap-2">
          <label className="block col-span-2">
            <span className="text-[11px] font-semibold" style={{ color: "var(--text-3)" }}>Name</span>
            <input value={name} onChange={(e) => setName(e.target.value)} disabled={!!existing}
              placeholder="Product name" className="input w-full disabled:opacity-60" aria-label="Product name" />
          </label>
          <label className="block">
            <span className="text-[11px] font-semibold" style={{ color: "var(--text-3)" }}>Category</span>
            <input value={category} onChange={(e) => setCategory(e.target.value)} disabled={!!existing}
              className="input w-full disabled:opacity-60" aria-label="Category" />
          </label>
          <label className="block">
            <span className="text-[11px] font-semibold" style={{ color: "var(--text-3)" }}>Opening qty</span>
            <input value={qty} onChange={(e) => setQty(e.target.value)} inputMode="numeric"
              placeholder="0" className="input w-full" aria-label="Opening quantity" />
          </label>
          <label className="block">
            <span className="text-[11px] font-semibold" style={{ color: "var(--text-3)" }}>Cost</span>
            <input value={cost} onChange={(e) => setCost(e.target.value)} inputMode="decimal"
              placeholder="0.00" className="input w-full" aria-label="Cost" />
          </label>
          <label className="block">
            <span className="text-[11px] font-semibold" style={{ color: "var(--text-3)" }}>Price</span>
            <input value={price} onChange={(e) => setPrice(e.target.value)} inputMode="decimal"
              placeholder="0.00" className="input w-full" aria-label="Price" />
          </label>
          <label className="block col-span-2">
            <span className="text-[11px] font-semibold" style={{ color: "var(--text-3)" }}>Extra barcodes (optional)</span>
            <input value={extra} onChange={(e) => setExtra(e.target.value)}
              placeholder="Separate with spaces or |" className="input w-full font-mono text-[12px]" aria-label="Extra barcodes" />
          </label>
        </div>

        {!existing && (
          <div className="flex items-center gap-2">
            <label className="btn btn-default btn-sm gap-1.5 cursor-pointer">
              <ImageIcon size={14} /> {image ? "Change image" : "Add image (optional)"}
              <input type="file" accept="image/*" className="hidden" onChange={onImage} />
            </label>
            {image && (
              <button type="button" onClick={() => setImage(null)} className="icon-btn" aria-label="Remove image" style={{ color: "var(--text-3)" }}><X size={16} /></button>
            )}
          </div>
        )}

        <p className="text-[11px]" style={{ color: "var(--text-3)" }}>
          To add sizes/variants, use spreadsheet import or the Products screen.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={saveNext} disabled={!canSave} className="btn btn-primary flex-1 disabled:opacity-40">Save &amp; scan next</button>
        <button type="button" onClick={saveFinish} className="btn btn-default flex-1">{canSave ? "Save & finish" : "Finish"}</button>
        <button type="button" onClick={resetRow} className="btn btn-ghost btn-sm">Clear row</button>
      </div>

      {session.length > 0 && (
        <div className="rounded-xl border p-3" style={{ borderColor: "var(--border)" }}>
          <div className="flex items-center justify-between text-[12px] font-bold" style={{ color: "var(--text)" }}>
            <span>Added this session ({session.length})</span>
            <span style={{ color: "var(--brand-text)" }}>{totalUnits} unit(s){totalValue > 0 ? ` · ${totalValue.toFixed(2)}` : ""}</span>
          </div>
          <ul className="mt-2 space-y-1 max-h-40 overflow-y-auto text-[12px]" style={{ color: "var(--text-2)" }}>
            {session.map((r, i) => (
              <li key={i} className="flex items-center gap-1.5">
                <Check size={13} style={{ color: "var(--success)" }} />
                <span className="flex-1 truncate">{r.name}</span>
                <span style={{ color: "var(--text-3)" }}>{r.kind === "aliased" ? "barcode added" : `+${r.qty}`}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

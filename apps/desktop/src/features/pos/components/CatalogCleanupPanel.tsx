import { useMemo, useState } from "react"
import { X, Layers, Archive, Pencil, AlertTriangle, ImagePlus, LoaderCircle } from "lucide-react"

import type { Product } from "../types/product"
import { formatCurrency, formatNumber } from "../lib/currency"
import { analyzeCatalog } from "../lib/catalogHealth"
import { updateProduct, archiveProduct } from "../services/product.service"
import { getApiUrl, getAuthToken } from "../services/sync.service"
import { generateImageViaApi, completeMissingImages } from "../services/productImage.service"
import { showToast } from "../services/toast.service"

// POS-PRODUCT-CATALOG-CLEANUP-1: surfaces catalog-quality issues and offers only
// non-destructive metadata actions (make-variant reparent, archive-with-confirm,
// edit). It never moves stock, batches, sales history, or ledger entries. Full
// merge of two existing products is intentionally deferred (see report).

type Props = {
  products: Product[]
  onClose: () => void
  onChanged: () => void
  onEditProduct: (p: Product) => void
}

export default function CatalogCleanupPanel({ products, onClose, onChanged, onEditProduct }: Props) {
  const health = useMemo(() => analyzeCatalog(products), [products])
  const [pendingArchive, setPendingArchive] = useState<number | null>(null)
  const [imgBusy, setImgBusy] = useState<Set<number>>(new Set())
  const [batchRunning, setBatchRunning] = useState(false)
  const [batchProgress, setBatchProgress] = useState<{ done: number; total: number } | null>(null)

  const connected = () => {
    if (getApiUrl() && getAuthToken()) return true
    showToast("Connect to the server first (Settings → Devices & Sync).", "error")
    return false
  }

  async function generateOne(p: Product) {
    if (!connected() || imgBusy.has(p.id)) return
    setImgBusy((s) => new Set(s).add(p.id))
    try {
      const gen = await generateImageViaApi({ name: p.name, category: p.category, barcode: p.barcode })
      if (gen?.image) { updateProduct(p.id, { image: gen.image }); showToast(`Image added to ${p.name}${gen.source ? ` (${gen.source})` : ""}.`); onChanged() }
      else showToast(`Could not generate an image for ${p.name}.`, "error")
    } catch (e) { showToast((e as Error).message, "error") }
    finally { setImgBusy((s) => { const n = new Set(s); n.delete(p.id); return n }) }
  }

  async function generateAllMissing() {
    if (batchRunning || !connected()) return
    setBatchRunning(true)
    setBatchProgress({ done: 0, total: health.missingImage.length })
    try {
      const r = await completeMissingImages(health.missingImage, {
        generate: (p) => generateImageViaApi({ name: p.name, category: p.category, barcode: p.barcode }),
        save: (id, image) => updateProduct(id, { image }),
        onProgress: (done, total) => setBatchProgress({ done, total }),
      })
      showToast(`${r.generated} image(s) added${r.failed ? ` · ${r.failed} failed` : ""}.`, r.failed ? "error" : "success")
      onChanged()
    } catch (e) {
      showToast((e as Error).message, "error")
    } finally {
      setBatchRunning(false)
      setBatchProgress(null)
    }
  }

  function makeVariantsOfFirst(group: Product[]) {
    const [parent, ...rest] = group
    for (const child of rest) {
      updateProduct(child.id, {
        parentId: parent.id,
        // give each a distinguishable label so the POS variant picker is clear
        variantName: child.variantName || (child.price !== parent.price ? formatCurrency(child.price) : `#${child.id}`),
      })
    }
    updateProduct(parent.id, { isParent: true })
    showToast(`Grouped ${rest.length} item(s) as variants of ${parent.name}.`)
    onChanged()
  }

  function confirmArchive(p: Product) {
    if (pendingArchive !== p.id) { setPendingArchive(p.id); return }
    archiveProduct(p.id)
    setPendingArchive(null)
    showToast(`${p.name} archived.`)
    onChanged()
  }

  const c = health.counts
  const nothing = Object.values(c).every((n) => n === 0)

  const Row = ({ p, note }: { p: Product; note?: string }) => (
    <div className="flex items-center gap-2 rounded-lg px-2.5 py-1.5" style={{ background: "var(--surface-2)" }}>
      <div className="min-w-0 flex-1">
        <p className="text-[12px] font-semibold truncate" style={{ color: "var(--text)" }}>{p.name}</p>
        <p className="text-[10px] truncate" style={{ color: "var(--text-3)" }}>
          {p.barcode || "no barcode"} · {formatCurrency(p.price)} · stock {formatNumber(p.stock)}{note ? ` · ${note}` : ""}
        </p>
      </div>
      <button type="button" onClick={() => onEditProduct(p)} className="btn btn-ghost btn-sm gap-1 shrink-0" aria-label={`Edit ${p.name}`}>
        <Pencil size={12} /> Edit
      </button>
      <button type="button" onClick={() => confirmArchive(p)} className="btn btn-ghost btn-sm gap-1 shrink-0"
        style={pendingArchive === p.id ? { color: "var(--danger-text)" } : undefined} aria-label={`Archive ${p.name}`}>
        <Archive size={12} /> {pendingArchive === p.id ? "Confirm?" : "Archive"}
      </button>
    </div>
  )

  const Section = ({ title, count, children }: { title: string; count: number; children: React.ReactNode }) =>
    count === 0 ? null : (
      <details className="rounded-xl border" style={{ borderColor: "var(--border)" }}>
        <summary className="flex cursor-pointer items-center justify-between px-3 py-2.5 text-[13px] font-bold" style={{ color: "var(--text)" }}>
          <span>{title}</span>
          <span className="rounded-full px-2 py-0.5 text-[11px]" style={{ background: "var(--surface-3)", color: "var(--text-2)" }}>{count}</span>
        </summary>
        <div className="space-y-1.5 px-3 pb-3">{children}</div>
      </details>
    )

  return (
    <div className="modal-overlay" style={{ zIndex: 100 }} onClick={onClose}>
      <div className="modal-card" style={{ maxWidth: 720 }} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b px-5 py-4" style={{ borderColor: "var(--border)" }}>
          <div className="flex items-center gap-2">
            <AlertTriangle size={18} style={{ color: "var(--brand)" }} />
            <h2 className="text-[15px] font-bold" style={{ color: "var(--text)" }}>Catalog cleanup</h2>
          </div>
          <button onClick={onClose} className="icon-btn" aria-label="Close catalog cleanup" style={{ color: "var(--text-3)" }}><X size={18} /></button>
        </div>

        <div className="p-5 flex flex-col gap-3 max-h-[75vh] overflow-y-auto">
          {/* Counts overview */}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[
              ["Duplicate names", c.duplicateNames],
              ["Barcode conflicts", c.barcodeConflicts],
              ["Missing barcode", c.missingBarcode],
              ["Missing image", c.missingImage],
              ["Uncategorized", c.uncategorized],
              ["Orphan variants", c.orphanVariants],
              ["Alias candidates", c.possibleAliases],
              ["Variant candidates", c.possibleVariants],
            ].map(([label, n]) => (
              <div key={label as string} className="rounded-lg px-2.5 py-2 text-center" style={{ background: "var(--surface-2)" }}>
                <p className="text-[18px] font-bold tabular-nums" style={{ color: (n as number) > 0 ? "var(--text)" : "var(--text-3)" }}>{n as number}</p>
                <p className="text-[10px]" style={{ color: "var(--text-3)" }}>{label as string}</p>
              </div>
            ))}
          </div>

          {nothing && (
            <div className="py-8 text-center">
              <p className="text-[13px] font-bold" style={{ color: "var(--success)" }}>Catalog looks clean</p>
              <p className="text-[11px] mt-0.5" style={{ color: "var(--text-3)" }}>No duplicate names, conflicts, or missing fields.</p>
            </div>
          )}

          <Section title="Duplicate names" count={health.duplicateNames.length}>
            {health.duplicateNames.map((g) => (
              <div key={g.name} className="rounded-lg p-2" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-[12px] font-bold" style={{ color: "var(--text)" }}>{g.name} ×{g.products.length}</span>
                  <span className="rounded px-2 py-0.5 text-[10px] font-semibold" style={{ background: "var(--amber-soft)", color: "var(--amber)" }}>
                    {g.samePrice ? "Same price — same item? (merge deferred)" : "Different prices — likely sizes"}
                  </span>
                </div>
                <div className="space-y-1.5">
                  {g.products.map((p) => <Row key={p.id} p={p} />)}
                </div>
                {!g.samePrice && (
                  <button type="button" onClick={() => makeVariantsOfFirst(g.products)}
                    className="btn btn-default btn-sm gap-1.5 mt-2" aria-label={`Group ${g.name} as variants`}>
                    <Layers size={13} /> Make variants of “{g.products[0].name}” (first)
                  </button>
                )}
              </div>
            ))}
          </Section>

          <Section title="Barcode conflicts" count={health.barcodeConflicts.length}>
            {health.barcodeConflicts.map((b) => {
              const p = products.find((x) => x.id === b.id)
              return p ? <Row key={b.id} p={p} note="shares a barcode" /> : null
            })}
          </Section>

          <Section title="Missing barcode" count={health.missingBarcode.length}>
            {health.missingBarcode.map((p) => <Row key={p.id} p={p} />)}
          </Section>

          {health.missingImage.length > 0 && (
            <details className="rounded-xl border" style={{ borderColor: "var(--border)" }}>
              <summary className="flex cursor-pointer items-center justify-between px-3 py-2.5 text-[13px] font-bold" style={{ color: "var(--text)" }}>
                <span>Missing image</span>
                <span className="rounded-full px-2 py-0.5 text-[11px]" style={{ background: "var(--surface-3)", color: "var(--text-2)" }}>{health.missingImage.length}</span>
              </summary>
              <div className="space-y-1.5 px-3 pb-3">
                <div className="flex items-center gap-2">
                  <button type="button" onClick={generateAllMissing} disabled={batchRunning}
                    className="btn btn-primary btn-sm gap-1.5 disabled:opacity-50">
                    {batchRunning ? <LoaderCircle size={13} className="animate-spin" /> : <ImagePlus size={13} />}
                    {batchRunning && batchProgress
                      ? `Generating ${batchProgress.done}/${batchProgress.total}…`
                      : `Generate all missing (${health.missingImage.length})`}
                  </button>
                  <span className="text-[10px]" style={{ color: "var(--text-3)" }}>Barcode catalog → AI → placeholder. Never overwrites an existing image.</span>
                </div>
                {health.missingImage.map((p) => (
                  <div key={p.id} className="flex items-center gap-2 rounded-lg px-2.5 py-1.5" style={{ background: "var(--surface-2)" }}>
                    <div className="min-w-0 flex-1">
                      <p className="text-[12px] font-semibold truncate" style={{ color: "var(--text)" }}>{p.name}</p>
                      <p className="text-[10px] truncate" style={{ color: "var(--text-3)" }}>{p.barcode || "no barcode"} · {formatCurrency(p.price)}</p>
                    </div>
                    <button type="button" onClick={() => generateOne(p)} disabled={batchRunning || imgBusy.has(p.id)}
                      className="btn btn-ghost btn-sm gap-1 shrink-0 disabled:opacity-50" aria-label={`Generate image for ${p.name}`}>
                      {imgBusy.has(p.id) ? <LoaderCircle size={12} className="animate-spin" /> : <ImagePlus size={12} />} Generate
                    </button>
                    <button type="button" onClick={() => onEditProduct(p)} className="btn btn-ghost btn-sm gap-1 shrink-0" aria-label={`Edit ${p.name}`}>
                      <Pencil size={12} /> Edit
                    </button>
                  </div>
                ))}
              </div>
            </details>
          )}

          <Section title="Uncategorized" count={health.uncategorized.length}>
            {health.uncategorized.map((p) => <Row key={p.id} p={p} note="no category" />)}
          </Section>

          <Section title="Orphan variants" count={health.orphanVariants.length}>
            {health.orphanVariants.map(({ child, reason }) => <Row key={child.id} p={child} note={`parent ${reason}`} />)}
          </Section>
        </div>
      </div>
    </div>
  )
}

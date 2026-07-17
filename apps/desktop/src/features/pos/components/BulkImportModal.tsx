import { useState } from "react"
import { X, Download, Upload, FileSpreadsheet } from "lucide-react"

import type { Product } from "../types/product"
import { showToast } from "../services/toast.service"
import {
  PRODUCT_IMPORT_HEADERS,
  parseProductImport,
  analyzeProductImport,
  commitProductImport,
  buildProductImportTemplateCsv,
  productsToCsv,
  type ProductImportPlan,
} from "../services/import.service"

// POS-PRODUCT-ONBOARDING-1: paste a spreadsheet → preview (dry-run) → commit.
// Preview never mutates; commit reuses the hardened create/receive/update paths.

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv" }))
  const a = document.createElement("a")
  a.href = url
  a.download = name
  a.click()
  URL.revokeObjectURL(url)
}

type Props = {
  products: Product[]
  onClose: () => void
  onImported: () => void
}

export default function BulkImportModal({ products, onClose, onImported }: Props) {
  const [text, setText] = useState("")
  const [plan, setPlan] = useState<ProductImportPlan | null>(null)
  const [parseError, setParseError] = useState<string | null>(null)
  const [importing, setImporting] = useState(false)

  function preview() {
    setPlan(null)
    setParseError(null)
    const { rows, error } = parseProductImport(text)
    if (error) { setParseError(error); return }
    setPlan(analyzeProductImport(rows, products))
  }

  function runImport() {
    if (!plan || importing) return
    setImporting(true)
    try {
      const result = commitProductImport(plan)
      const parts = [`${result.created} created`, `${result.updated} updated`]
      if (result.skipped) parts.push(`${result.skipped} skipped`)
      showToast(parts.join(" · "), result.errors.length ? "error" : "success")
      for (const e of result.errors.slice(0, 3)) showToast(e, "error")
      onImported()
      onClose()
    } finally {
      setImporting(false)
    }
  }

  const committable = plan ? plan.counts.create + plan.counts.existing + plan.counts.variant : 0
  const conflicts = plan?.actions.filter((a) => a.kind === "conflict") ?? []
  const invalids = plan?.actions.filter((a) => a.kind === "invalid") ?? []

  return (
    <div className="modal-overlay" style={{ zIndex: 100 }} onClick={onClose}>
      <div className="modal-card" style={{ maxWidth: 720 }} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b px-5 py-4" style={{ borderColor: "var(--border)" }}>
          <div className="flex items-center gap-2">
            <FileSpreadsheet size={18} style={{ color: "var(--brand)" }} />
            <h2 className="text-[15px] font-bold" style={{ color: "var(--text)" }}>Bulk import products</h2>
          </div>
          <button onClick={onClose} className="icon-btn" aria-label="Close bulk import" style={{ color: "var(--text-3)" }}><X size={18} /></button>
        </div>

        <div className="p-5 flex flex-col gap-3 max-h-[75vh] overflow-y-auto">
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => download("titan-product-import-template.csv", buildProductImportTemplateCsv())}
              className="btn btn-default btn-sm gap-1.5"><Download size={14} /> Download template</button>
            <button type="button" onClick={() => download(`titan-products-${new Date().toISOString().slice(0, 10)}.csv`, productsToCsv(products))}
              className="btn btn-default btn-sm gap-1.5"><Download size={14} /> Export current products</button>
          </div>

          <p className="text-[11px]" style={{ color: "var(--text-3)" }}>
            Columns (CSV or paste from Excel): {PRODUCT_IMPORT_HEADERS.join(", ")}. Separate Extra Barcodes with <span className="font-mono">|</span>.
          </p>

          <textarea
            value={text}
            onChange={(e) => { setText(e.target.value); setPlan(null); setParseError(null) }}
            placeholder={"Paste rows here (include the header row)…"}
            className="input w-full font-mono text-[12px]"
            style={{ height: 150, resize: "vertical" }}
            aria-label="Paste product import data"
          />

          {parseError && (
            <p className="text-[12px] font-semibold rounded-lg px-3 py-2" style={{ background: "var(--danger-soft)", color: "var(--danger-text)" }}>{parseError}</p>
          )}

          {plan && (
            <div className="space-y-3">
              <div className="flex flex-wrap gap-2 text-[11px] font-bold">
                {[
                  ["New", plan.counts.create, "var(--success-text)", "var(--success-soft)"],
                  ["Restock/update", plan.counts.existing, "var(--brand-text)", "var(--brand-soft)"],
                  ["Variants", plan.counts.variant, "var(--info)", "var(--info-soft)"],
                  ["+Barcodes", plan.counts.aliasAdds, "var(--text-2)", "var(--surface-2)"],
                  ["Conflicts", plan.counts.conflict, "var(--danger-text)", "var(--danger-soft)"],
                  ["Invalid", plan.counts.invalid, "var(--danger-text)", "var(--danger-soft)"],
                ].map(([label, n, fg, bg]) => (
                  <span key={label as string} className="rounded-lg px-2.5 py-1" style={{ background: bg as string, color: fg as string }}>
                    {label}: {n as number}
                  </span>
                ))}
              </div>

              {plan.warnings.length > 0 && (
                <div className="rounded-lg p-3 text-[11px]" style={{ background: "var(--amber-soft)", color: "var(--amber)" }}>
                  {plan.warnings.slice(0, 6).map((w) => <p key={w.line}>Line {w.line}: {w.message}</p>)}
                </div>
              )}

              {(conflicts.length > 0 || invalids.length > 0) && (
                <div className="rounded-lg p-3 text-[11px] max-h-40 overflow-y-auto" style={{ background: "var(--danger-soft)", color: "var(--danger-text)" }}>
                  {[...invalids, ...conflicts].slice(0, 20).map((a) => (
                    <p key={`${a.kind}-${a.line}`}>Line {a.line} ({a.name || a.primaryBarcode || "?"}): {a.reason}</p>
                  ))}
                  <p className="mt-1 opacity-70">Rejected rows are not imported. Fix them and re-paste.</p>
                </div>
              )}
            </div>
          )}

          <div className="flex gap-2 pt-1">
            <button type="button" onClick={preview} disabled={!text.trim()}
              className="btn btn-default flex-1 disabled:opacity-40">Preview</button>
            <button type="button" onClick={runImport} disabled={!plan || committable === 0 || importing}
              className="btn btn-primary flex-1 disabled:opacity-40">
              {importing ? "Importing…" : committable > 0 ? `Import ${committable} product(s)` : "Nothing to import"}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

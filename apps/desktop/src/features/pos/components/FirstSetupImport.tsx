import { useRef, useState } from "react"
import { Download, Upload, ArrowLeft, ShieldAlert, PackageOpen } from "lucide-react"

import type { Product } from "../types/product"
import type { StoreStatus } from "../lib/storeSetup"
import { showToast } from "../services/toast.service"
import {
  PRODUCT_IMPORT_HEADERS,
  parseProductImport,
  analyzeProductImport,
  commitProductImport,
  buildProductImportTemplateCsv,
  productsToCsv,
  summarizeOpeningStock,
  type ProductImportPlan,
} from "../services/import.service"

// POS-FIRST-SETUP-CATALOG-1C: guided spreadsheet import that commits into
// OPENING inventory (not daily Receive). Preview is a pure dry-run; commit only
// runs after an explicit confirm. Invalid/conflict rows never commit.

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv" }))
  const a = document.createElement("a")
  a.href = url
  a.download = name
  a.click()
  URL.revokeObjectURL(url)
}

type Sub = "input" | "confirm"

export default function FirstSetupImport({
  products, storeStatus, onBack, onCommitted,
}: {
  products: Product[]
  storeStatus: StoreStatus
  onBack: () => void
  onCommitted: () => void
}) {
  const [sub, setSub] = useState<Sub>("input")
  const [text, setText] = useState("")
  const [plan, setPlan] = useState<ProductImportPlan | null>(null)
  const [parseError, setParseError] = useState<string | null>(null)
  const [importing, setImporting] = useState(false)
  const [ack, setAck] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const resetPlan = () => { setPlan(null); setParseError(null); setSub("input"); setAck(false) }

  function preview() {
    setPlan(null); setParseError(null)
    const { rows, error } = parseProductImport(text)
    if (error) { setParseError(error); return }
    setPlan(analyzeProductImport(rows, products))
  }

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => { setText(String(reader.result ?? "")); resetPlan() }
    reader.readAsText(file)
    e.target.value = ""
  }

  function commit() {
    if (!plan || importing) return
    setImporting(true)
    try {
      // Opening mode → Opening movements/batches, no supplier PO/payment.
      const result = commitProductImport(plan, { opening: true })
      const parts = [`${result.created} created`]
      if (result.updated) parts.push(`${result.updated} updated`)
      if (result.skipped) parts.push(`${result.skipped} skipped`)
      showToast(`Opening inventory imported — ${parts.join(" · ")}`, result.errors.length ? "error" : "success")
      for (const e of result.errors.slice(0, 3)) showToast(e, "error")
      onCommitted()
    } finally {
      setImporting(false)
    }
  }

  const committable = plan ? plan.counts.create + plan.counts.existing + plan.counts.variant : 0
  const conflicts = plan?.actions.filter((a) => a.kind === "conflict") ?? []
  const invalids = plan?.actions.filter((a) => a.kind === "invalid") ?? []
  const opening = plan ? summarizeOpeningStock(plan) : { units: 0, value: 0, lines: 0 }

  // ── Confirm step ──────────────────────────────────────────────────────────
  if (sub === "confirm" && plan) {
    return (
      <div className="space-y-3">
        <button type="button" onClick={() => setSub("input")} className="btn btn-ghost btn-sm gap-1"><ArrowLeft size={13} /> Back to preview</button>

        <div className="rounded-xl border p-4" style={{ borderColor: "var(--border)", background: "var(--surface-2)" }}>
          <div className="flex items-center gap-2">
            <PackageOpen size={16} style={{ color: "var(--brand)" }} />
            <p className="text-[14px] font-bold" style={{ color: "var(--text)" }}>Confirm opening inventory</p>
          </div>
          <ul className="mt-2 space-y-1 text-[12px]" style={{ color: "var(--text-2)" }}>
            <li><strong>{committable}</strong> product(s) will be added ({plan.counts.create} new · {plan.counts.variant} variant(s) · {plan.counts.existing} restock/update).</li>
            <li><strong>{opening.units}</strong> unit(s) of opening stock across {opening.lines} line(s){opening.value > 0 ? <> · cost value <strong>{opening.value.toFixed(2)}</strong></> : null}.</li>
            <li>Recorded as <strong>Opening inventory</strong> — no supplier purchase, no supplier payment.</li>
            {(conflicts.length > 0 || invalids.length > 0) && (
              <li style={{ color: "var(--danger-text)" }}>{conflicts.length + invalids.length} rejected row(s) will <strong>not</strong> be imported.</li>
            )}
          </ul>
        </div>

        {storeStatus !== "fresh" && (
          <div className="rounded-xl p-3 text-[12px]" style={{ background: "var(--danger-soft)", color: "var(--danger-text)" }}>
            <div className="flex items-center gap-1.5 font-bold"><ShieldAlert size={14} /> This store isn&apos;t empty.</div>
            <p className="mt-1">Opening inventory is meant for initial setup. If you&apos;re already trading, restocking through <strong>Receive stock</strong> keeps your purchase reports accurate. Continue only if you&apos;re intentionally setting up the starting catalog.</p>
          </div>
        )}

        <label className="flex items-start gap-2 text-[12px]" style={{ color: "var(--text-2)" }}>
          <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} className="mt-0.5" />
          <span>I understand these quantities are recorded as opening inventory{storeStatus !== "fresh" ? " on a store that already has activity" : ""}.</span>
        </label>

        <button type="button" onClick={commit} disabled={!ack || committable === 0 || importing}
          className="btn btn-primary w-full disabled:opacity-40">
          {importing ? "Importing…" : `Commit ${committable} product(s) as opening inventory`}
        </button>
      </div>
    )
  }

  // ── Input + preview step ────────────────────────────────────────────────
  return (
    <div className="space-y-3">
      <button type="button" onClick={onBack} className="btn btn-ghost btn-sm gap-1"><ArrowLeft size={13} /> Back</button>

      <p className="text-[13px]" style={{ color: "var(--text-2)" }}>
        Paste or upload your product list. Quantities in <strong>Opening Qty</strong> are recorded as opening inventory.
      </p>

      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => download("titan-product-import-template.csv", buildProductImportTemplateCsv())}
          className="btn btn-default btn-sm gap-1.5"><Download size={14} /> Download template</button>
        {products.length > 0 && (
          <button type="button" onClick={() => download(`titan-products-${new Date().toISOString().slice(0, 10)}.csv`, productsToCsv(products))}
            className="btn btn-default btn-sm gap-1.5"><Download size={14} /> Export current</button>
        )}
        <button type="button" onClick={() => fileRef.current?.click()}
          className="btn btn-default btn-sm gap-1.5"><Upload size={14} /> Upload CSV</button>
        <input ref={fileRef} type="file" accept=".csv,.tsv,text/csv,text/plain" className="hidden" onChange={onFile} />
      </div>

      <p className="text-[11px]" style={{ color: "var(--text-3)" }}>
        Columns (CSV or paste from Excel): {PRODUCT_IMPORT_HEADERS.join(", ")}. Separate Extra Barcodes with <span className="font-mono">|</span>.
      </p>

      <textarea
        value={text}
        onChange={(e) => { setText(e.target.value); resetPlan() }}
        placeholder={"Paste rows here (include the header row)…"}
        className="input w-full font-mono text-[12px]"
        style={{ height: 140, resize: "vertical" }}
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

          <div className="rounded-lg px-3 py-2 text-[12px] font-semibold" style={{ background: "var(--brand-soft)", color: "var(--brand-text)" }}>
            Opening stock: {opening.units} unit(s) across {opening.lines} line(s){opening.value > 0 ? ` · cost value ${opening.value.toFixed(2)}` : ""}
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
        <button type="button" onClick={() => setSub("confirm")} disabled={!plan || committable === 0}
          className="btn btn-primary flex-1 disabled:opacity-40">
          {committable > 0 ? `Review & confirm (${committable})` : "Nothing to import"}
        </button>
      </div>
    </div>
  )
}

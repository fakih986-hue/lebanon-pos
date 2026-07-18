import { useMemo, useState } from "react"
import { X, FileSpreadsheet, ScanLine, Sparkles, PackageOpen, CheckCircle2, ArrowLeft } from "lucide-react"

import { getStoreState, markSetupCompleted } from "../lib/storeSetup"
import { showToast } from "../services/toast.service"

// POS-FIRST-SETUP-CATALOG-1B: wizard SHELL only. "Start empty" is functional
// (marks setup done). Import / Scan / Review / Confirm are signposts — the real
// workflows land in 1C+. Commits no product or opening-inventory data here.

type Step = "welcome" | "import" | "scan" | "done"

export default function FirstSetupWizard({ onClose, onCompleted }: { onClose: () => void; onCompleted?: () => void }) {
  const [step, setStep] = useState<Step>("welcome")
  const state = useMemo(() => getStoreState(), [])

  function finishEmpty() {
    markSetupCompleted()
    onCompleted?.()
    setStep("done")
    showToast("Catalog setup marked done. Add products any time from Products.")
  }

  const Placeholder = ({ title, body, cta }: { title: string; body: string; cta: string }) => (
    <div className="space-y-3">
      <button type="button" onClick={() => setStep("welcome")} className="btn btn-ghost btn-sm gap-1"><ArrowLeft size={13} /> Back</button>
      <div className="rounded-xl border p-4" style={{ borderColor: "var(--border)", background: "var(--surface-2)" }}>
        <p className="text-[14px] font-bold" style={{ color: "var(--text)" }}>{title}</p>
        <p className="text-[12px] mt-1" style={{ color: "var(--text-2)" }}>{body}</p>
        <p className="text-[12px] mt-3 font-semibold" style={{ color: "var(--brand-text)" }}>{cta}</p>
      </div>
    </div>
  )

  return (
    <div className="modal-overlay" style={{ zIndex: 100 }} onClick={onClose}>
      <div className="modal-card" style={{ maxWidth: 620 }} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b px-5 py-4" style={{ borderColor: "var(--border)" }}>
          <div className="flex items-center gap-2">
            <PackageOpen size={18} style={{ color: "var(--brand)" }} />
            <h2 className="text-[15px] font-bold" style={{ color: "var(--text)" }}>First-time catalog setup</h2>
          </div>
          <button onClick={onClose} className="icon-btn" aria-label="Close setup" style={{ color: "var(--text-3)" }}><X size={18} /></button>
        </div>

        <div className="p-5 flex flex-col gap-3 max-h-[75vh] overflow-y-auto">
          {step === "welcome" && (
            <>
              {state.status !== "fresh" && (
                <div className="rounded-xl p-3 text-[12px]" style={{ background: "var(--amber-soft)", color: "var(--amber)" }}>
                  <p className="font-bold">This is intended for initial setup.</p>
                  <p className="mt-0.5">{state.reasons.join(" · ")}. For normal stock, use <strong>Receive stock</strong>; to add products in bulk, use <strong>Products → Tools → Bulk Import</strong>.</p>
                </div>
              )}
              <p className="text-[13px]" style={{ color: "var(--text-2)" }}>
                Set up your starting catalog. Opening stock is recorded as <strong>opening inventory</strong> — not a supplier purchase — so your purchase reports stay clean.
              </p>
              <div className="grid gap-2 sm:grid-cols-2">
                <button type="button" onClick={() => setStep("import")}
                  className="flex items-start gap-3 rounded-xl border p-3 text-start transition hover:opacity-80" style={{ borderColor: "var(--border)" }}>
                  <FileSpreadsheet size={18} style={{ color: "var(--brand)" }} />
                  <span><span className="block text-[13px] font-bold" style={{ color: "var(--text)" }}>Import a spreadsheet</span>
                    <span className="block text-[11px]" style={{ color: "var(--text-3)" }}>Paste or upload your product list</span></span>
                </button>
                <button type="button" onClick={() => setStep("scan")}
                  className="flex items-start gap-3 rounded-xl border p-3 text-start transition hover:opacity-80" style={{ borderColor: "var(--border)" }}>
                  <ScanLine size={18} style={{ color: "var(--brand)" }} />
                  <span><span className="block text-[13px] font-bold" style={{ color: "var(--text)" }}>Scan one by one</span>
                    <span className="block text-[11px]" style={{ color: "var(--text-3)" }}>Add products as you scan them</span></span>
                </button>
                <button type="button" disabled title="Coming soon"
                  className="flex items-start gap-3 rounded-xl border p-3 text-start opacity-40" style={{ borderColor: "var(--border)" }}>
                  <Sparkles size={18} style={{ color: "var(--text-3)" }} />
                  <span><span className="block text-[13px] font-bold" style={{ color: "var(--text)" }}>Load a sample catalog</span>
                    <span className="block text-[11px]" style={{ color: "var(--text-3)" }}>Try the POS with demo products</span></span>
                </button>
                <button type="button" onClick={finishEmpty}
                  className="flex items-start gap-3 rounded-xl border p-3 text-start transition hover:opacity-80" style={{ borderColor: "var(--border)" }}>
                  <PackageOpen size={18} style={{ color: "var(--text-2)" }} />
                  <span><span className="block text-[13px] font-bold" style={{ color: "var(--text)" }}>Start empty</span>
                    <span className="block text-[11px]" style={{ color: "var(--text-3)" }}>Add products later, one at a time</span></span>
                </button>
              </div>
            </>
          )}

          {step === "import" && (
            <Placeholder
              title="Spreadsheet import"
              body="The guided first-setup import (with opening-inventory stock) is coming in the next update."
              cta="Available now: Products → Tools → Bulk Import."
            />
          )}
          {step === "scan" && (
            <Placeholder
              title="Scan products one by one"
              body="Guided scan setup is coming in the next update."
              cta="Available now: Receive stock (for stock you're buying) or Products → New Product."
            />
          )}
          {step === "done" && (
            <div className="py-8 text-center">
              <CheckCircle2 size={30} className="mx-auto mb-2" style={{ color: "var(--success)" }} />
              <p className="text-[14px] font-bold" style={{ color: "var(--success)" }}>You're set up</p>
              <p className="text-[12px] mt-1" style={{ color: "var(--text-3)" }}>Add products any time from the Products screen.</p>
              <button type="button" onClick={onClose} className="btn btn-primary mt-4">Done</button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

import { useState } from "react"
import { Printer } from "lucide-react"
import { useI18n } from "@lebanonpos/shared"

import { DEFAULT_PRINTABLE_MM, getReceiptPrinter, setReceiptPrinter, type ReceiptPaperMm } from "../lib/receiptPrinter"
import { printTestReceipt } from "../lib/printReceipt"
import { getSettings } from "../services/settings.service"
import { showToast } from "../services/toast.service"

const field = "mt-2 h-11 w-full rounded-lg border border-zinc-200 bg-zinc-50 px-3 font-medium outline-none focus:border-emerald-400 focus:bg-white focus:ring-4 focus:ring-emerald-100"

/** Paper width, printable width and safe margin of this register's receipt printer (stored on this device only). */
export default function ReceiptPrinterSettings() {
  const { t } = useI18n()
  const [printer, setPrinter] = useState(getReceiptPrinter())
  const save = (patch: Parameters<typeof setReceiptPrinter>[0]) => setPrinter(setReceiptPrinter(patch))

  return (
    <div className="rounded-lg border border-zinc-200 p-4 md:col-span-2">
      <div className="mb-1 flex items-center gap-2 text-sm font-bold text-zinc-800">
        <Printer size={17} aria-hidden="true" />
        {t("settings.printer.title")}
      </div>
      <p className="mb-3 text-sm text-zinc-600">{t("settings.printer.help")}</p>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="block text-sm font-bold text-zinc-700">
          {t("settings.printer.paper")}
          <select className={field} value={printer.paperMm}
            onChange={(e) => { const paperMm = Number(e.target.value) as ReceiptPaperMm; save({ paperMm, printableMm: DEFAULT_PRINTABLE_MM[paperMm] }) }}>
            <option value={80}>80 mm</option>
            <option value={58}>58 mm</option>
          </select>
        </label>
        <label className="block text-sm font-bold text-zinc-700">
          {t("settings.printer.printable")}
          <input type="number" inputMode="decimal" min={30} max={printer.paperMm} step={0.5} dir="ltr" className={field}
            value={printer.printableMm} onChange={(e) => save({ printableMm: Number(e.target.value) })} />
        </label>
        <label className="block text-sm font-bold text-zinc-700">
          {t("settings.printer.margin")}
          <input type="number" inputMode="decimal" min={0} max={10} step={0.5} dir="ltr" className={field}
            value={printer.marginMm} onChange={(e) => save({ marginMm: Number(e.target.value) })} />
        </label>
      </div>
      <button type="button" onClick={() => { printTestReceipt(getSettings()); showToast(t("settings.printer.saved")) }}
        className="mt-3 flex h-11 items-center gap-2 rounded-lg border border-zinc-300 px-4 text-sm font-bold text-zinc-800 transition hover:bg-zinc-50">
        <Printer size={16} aria-hidden="true" />
        {t("settings.printer.test")}
      </button>
    </div>
  )
}

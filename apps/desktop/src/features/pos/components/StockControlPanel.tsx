import { ClipboardCheck, PackageMinus, Plus, Save } from "lucide-react"

import { useI18n } from "@lebanonpos/shared"
import { formatCurrency, formatNumber } from "../lib/currency"
import type { InventoryBatch } from "../services/inventoryBatch.service"
import type {
  StockAdjustment,
  StockAdjustmentReason,
} from "../services/inventoryAdjustment.service"
import type { StockCountLine, StockCountSession } from "../services/stockCount.service"
import type { Product } from "../types/product"

const adjustmentReasons: StockAdjustmentReason[] = [
  "Damage",
  "Expired",
  "Theft",
  "Count Correction",
  "Supplier Return",
  "Internal Use",
  "Manual Correction",
]

function normalizeBarcode(value: string) {
  return value.trim().replace(/\s+/g, "")
}

type Props = {
  products: Product[]
  adjustmentProduct: Product | undefined
  adjustmentProductId: number | null
  onAdjustmentProductIdChange: (id: number) => void
  adjustmentMode: "Add" | "Remove"
  onAdjustmentModeChange: (mode: "Add" | "Remove") => void
  adjustmentQuantity: string
  onAdjustmentQuantityChange: (value: string) => void
  adjustmentReason: StockAdjustmentReason
  onAdjustmentReasonChange: (reason: StockAdjustmentReason) => void
  adjustmentBatchId: string
  onAdjustmentBatchIdChange: (id: string) => void
  adjustmentNote: string
  onAdjustmentNoteChange: (note: string) => void
  selectedProductBatches: InventoryBatch[]
  recentAdjustments: StockAdjustment[]
  activeStockCount: StockCountSession | undefined
  countProductId: number | null
  onCountProductIdChange: (id: number) => void
  countedQuantity: string
  onCountedQuantityChange: (value: string) => void
  countSearch: string
  onCountSearchChange: (value: string) => void
  countLines: StockCountLine[]
  onSaveStockAdjustment: () => void
  onBeginStockCount: () => void
  onSaveCountLine: () => void
  onPostStockCount: () => void
}

export default function StockControlPanel({
  products,
  adjustmentProduct,
  adjustmentProductId,
  onAdjustmentProductIdChange,
  adjustmentMode,
  onAdjustmentModeChange,
  adjustmentQuantity,
  onAdjustmentQuantityChange,
  adjustmentReason,
  onAdjustmentReasonChange,
  adjustmentBatchId,
  onAdjustmentBatchIdChange,
  adjustmentNote,
  onAdjustmentNoteChange,
  selectedProductBatches,
  recentAdjustments,
  activeStockCount,
  countProductId,
  onCountProductIdChange,
  countedQuantity,
  onCountedQuantityChange,
  countSearch,
  onCountSearchChange,
  countLines,
  onSaveStockAdjustment,
  onBeginStockCount,
  onSaveCountLine,
  onPostStockCount,
}: Props) {
  const { t } = useI18n()

  return (
    <section className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1fr)_420px]">
      <div className="rounded-lg border border-zinc-200 bg-white shadow-sm">
        <div className="flex flex-col gap-3 border-b border-zinc-200 p-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-rose-100 text-rose-700">
              <PackageMinus size={21} />
            </div>
            <div>
              <h2 className="text-xl font-bold text-zinc-950">
                {t("pos.stock.adjustment_title")}
              </h2>
              <p className="text-sm text-zinc-500">
                {t("pos.stock.adjustment_desc")}
              </p>
            </div>
          </div>
          <span className="rounded-lg bg-zinc-100 px-3 py-2 text-sm font-bold text-zinc-700">
            {t("pos.stock.recent_logs", { count: formatNumber(recentAdjustments.length) })}
          </span>
        </div>

        <div className="grid gap-4 p-4 lg:grid-cols-6">
          <label className="block text-sm font-bold text-zinc-700 lg:col-span-2">
            {t("pos.product")}
            <select
              value={adjustmentProduct?.id ?? ""}
              onChange={(event) =>
                onAdjustmentProductIdChange(Number(event.target.value))
              }
              className="mt-2 h-11 w-full rounded-lg border border-zinc-200 bg-zinc-50 px-3 outline-none focus:border-emerald-400 focus:bg-white focus:ring-4 focus:ring-emerald-100"
            >
              {products.map((product) => (
                <option key={product.id} value={product.id}>
                  {product.name} / {formatNumber(product.stock)}
                </option>
              ))}
            </select>
          </label>

          <label className="block text-sm font-bold text-zinc-700">
            {t("pos.stock.action")}
            <select
              value={adjustmentMode}
              onChange={(event) =>
                onAdjustmentModeChange(event.target.value as "Add" | "Remove")
              }
              className="mt-2 h-11 w-full rounded-lg border border-zinc-200 bg-zinc-50 px-3 outline-none focus:border-emerald-400 focus:bg-white focus:ring-4 focus:ring-emerald-100"
            >
              <option value="Remove">{t("pos.stock.remove_stock")}</option>
              <option value="Add">{t("pos.stock.add_stock")}</option>
            </select>
          </label>

          <label className="block text-sm font-bold text-zinc-700">
            {t("pos.quantity")}
            <input
              type="number"
              min="0"
              value={adjustmentQuantity}
              onChange={(event) => onAdjustmentQuantityChange(event.target.value)}
              className="mt-2 h-11 w-full rounded-lg border border-zinc-200 bg-zinc-50 px-3 outline-none focus:border-emerald-400 focus:bg-white focus:ring-4 focus:ring-emerald-100"
            />
          </label>

          <label className="block text-sm font-bold text-zinc-700">
            {t("pos.reason")}
            <select
              value={adjustmentReason}
              onChange={(event) =>
                onAdjustmentReasonChange(event.target.value as StockAdjustmentReason)
              }
              className="mt-2 h-11 w-full rounded-lg border border-zinc-200 bg-zinc-50 px-3 outline-none focus:border-emerald-400 focus:bg-white focus:ring-4 focus:ring-emerald-100"
            >
              {adjustmentReasons.map((reason) => (
                <option key={reason} value={reason}>
                  {t("pos.stock.reason." + reason.toLowerCase().replace(/\s+/g, "_"))}
                </option>
              ))}
            </select>
          </label>

          <label className="block text-sm font-bold text-zinc-700">
            {t("pos.stock.lot")}
            <select
              value={adjustmentBatchId}
              onChange={(event) => onAdjustmentBatchIdChange(event.target.value)}
              className="mt-2 h-11 w-full rounded-lg border border-zinc-200 bg-zinc-50 px-3 outline-none focus:border-emerald-400 focus:bg-white focus:ring-4 focus:ring-emerald-100"
            >
              <option value="">{t("pos.stock.auto_lot")}</option>
              {selectedProductBatches.map((batch) => (
                <option key={batch.id} value={batch.id}>
                  {batch.batchNumber} / {formatNumber(batch.quantityRemaining)}
                </option>
              ))}
            </select>
          </label>

          <label className="block text-sm font-bold text-zinc-700 lg:col-span-5">
            {t("pos.note")}
            <input
              value={adjustmentNote}
              onChange={(event) => onAdjustmentNoteChange(event.target.value)}
              placeholder={t("pos.stock.optional_reason_detail")}
              className="mt-2 h-11 w-full rounded-lg border border-zinc-200 bg-zinc-50 px-3 outline-none focus:border-emerald-400 focus:bg-white focus:ring-4 focus:ring-emerald-100"
            />
          </label>

          <button
            type="button"
            onClick={onSaveStockAdjustment}
            disabled={!adjustmentProduct}
            className="mt-7 flex h-11 items-center justify-center gap-2 rounded-lg bg-zinc-950 px-3 text-sm font-bold text-white transition hover:bg-zinc-800 disabled:bg-zinc-300"
          >
            <Save size={17} />
            {t("pos.stock.post")}
          </button>
        </div>

        <div className="border-t border-zinc-200 p-4">
          <div className="grid gap-2 lg:grid-cols-3">
            {recentAdjustments.slice(0, 3).map((adjustment) => (
              <div
                key={adjustment.id}
                className="rounded-lg border border-zinc-200 p-3"
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="truncate font-bold text-zinc-950">
                    {adjustment.productName}
                  </p>
                  <span
                    className={`rounded-lg px-2 py-1 text-xs font-black ${
                      adjustment.quantityChange >= 0
                        ? "bg-emerald-50 text-emerald-700"
                        : "bg-rose-50 text-rose-700"
                    }`}
                  >
                    {adjustment.quantityChange > 0 ? "+" : ""}
                    {formatNumber(adjustment.quantityChange)}
                  </span>
                </div>
                <p className="mt-1 text-xs font-semibold text-zinc-500">
                  {adjustment.adjustmentNumber} / {adjustment.reason}
                </p>
              </div>
            ))}

            {recentAdjustments.length === 0 ? (
              <div className="rounded-lg border border-dashed border-zinc-300 p-5 text-sm font-medium text-zinc-500 lg:col-span-3">
                {t("pos.stock.no_corrections")}
              </div>
            ) : null}
          </div>
        </div>
      </div>

      <aside className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-sky-100 text-sky-700">
            <ClipboardCheck size={21} />
          </div>
          <div>
            <h2 className="text-lg font-bold text-zinc-950">
              {t("pos.stock.physical_count_title")}
            </h2>
            <p className="text-sm text-zinc-500">
              {t("pos.stock.physical_count_desc")}
            </p>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={onBeginStockCount}
            className="flex h-11 items-center justify-center gap-2 rounded-lg bg-zinc-950 px-3 text-sm font-bold text-white transition hover:bg-zinc-800"
          >
            <Plus size={16} />
            {activeStockCount ? t("pos.resume") : t("pos.stock.start_count")}
          </button>
          <button
            type="button"
            onClick={onPostStockCount}
            disabled={!activeStockCount}
            className="flex h-11 items-center justify-center gap-2 rounded-lg bg-emerald-600 px-3 text-sm font-bold text-white transition hover:bg-emerald-500 disabled:bg-zinc-300"
          >
            <ClipboardCheck size={16} />
            {t("pos.stock.complete_count")}
          </button>
        </div>

        {activeStockCount ? (
          <>
            <div className="mt-4 rounded-lg border border-sky-100 bg-sky-50 p-3 text-sm text-sky-950">
              <div className="flex justify-between gap-3">
                <span className="font-bold">{activeStockCount.countNumber}</span>
                <span className="font-bold">
                  {t("pos.stock.net_variance", { variance: formatNumber(activeStockCount.totalVariance) })}
                </span>
              </div>
              <p className="mt-1 font-medium text-sky-800">
                {t("pos.stock.value_impact", { impact: formatCurrency(activeStockCount.totalValueImpact) })}
              </p>
            </div>

            <label className="mt-4 block text-sm font-bold text-zinc-700">
              {t("pos.product")}
              <select
                value={countProductId ?? ""}
                onChange={(event) =>
                  onCountProductIdChange(Number(event.target.value))
                }
                className="mt-2 h-11 w-full rounded-lg border border-zinc-200 bg-zinc-50 px-3 outline-none focus:border-sky-400 focus:bg-white focus:ring-4 focus:ring-sky-100"
              >
                {activeStockCount.lines.map((line) => (
                  <option key={line.productId} value={line.productId}>
                    {line.productName}
                  </option>
                ))}
              </select>
            </label>

            <div className="mt-3 grid grid-cols-[minmax(0,1fr)_96px] gap-2">
              <input
                type="number"
                min="0"
                value={countedQuantity}
                onChange={(event) => onCountedQuantityChange(event.target.value)}
                placeholder={t("pos.stock.counted_quantity")}
                className="h-11 rounded-lg border border-zinc-200 bg-zinc-50 px-3 outline-none focus:border-sky-400 focus:bg-white focus:ring-4 focus:ring-sky-100"
              />
              <button
                type="button"
                onClick={onSaveCountLine}
                className="h-11 rounded-lg bg-sky-700 px-3 text-sm font-bold text-white transition hover:bg-sky-600"
              >
                {t("pos.save")}
              </button>
            </div>

            <label className="mt-3 block text-sm font-bold text-zinc-700">
              {t("pos.stock.find_line")}
              <input
                value={countSearch}
                onChange={(event) => onCountSearchChange(event.target.value)}
                placeholder={t("pos.stock.search_count_lines")}
                className="mt-2 h-10 w-full rounded-lg border border-zinc-200 bg-zinc-50 px-3 outline-none focus:border-sky-400 focus:bg-white focus:ring-4 focus:ring-sky-100"
              />
            </label>

            <div className="mt-3 space-y-2">
              {countLines.map((line) => (
                <button
                  key={line.productId}
                  type="button"
                  onClick={() => onCountProductIdChange(line.productId)}
                  className="flex w-full items-center justify-between gap-3 rounded-lg border border-zinc-200 p-3 text-left transition hover:bg-zinc-50"
                >
                  <span className="min-w-0">
                    <span className="block truncate font-bold text-zinc-950">
                      {line.productName}
                    </span>
                    <span className="text-xs font-semibold text-zinc-500">
                      {t("pos.stock.expected_counted", {
                        expected: formatNumber(line.expectedQuantity),
                        counted: typeof line.countedQuantity === "number" ? formatNumber(line.countedQuantity) : "-"
                      })}
                    </span>
                  </span>
                  <span
                    className={`shrink-0 rounded-lg px-2 py-1 text-xs font-black ${
                      line.variance === 0
                        ? "bg-zinc-100 text-zinc-600"
                        : line.variance > 0
                          ? "bg-emerald-50 text-emerald-700"
                          : "bg-rose-50 text-rose-700"
                    }`}
                  >
                    {line.variance > 0 ? "+" : ""}
                    {formatNumber(line.variance)}
                  </span>
                </button>
              ))}
            </div>
          </>
        ) : (
          <div className="mt-4 rounded-lg border border-dashed border-zinc-300 p-5 text-sm font-medium text-zinc-500">
            {t("pos.stock.start_count_hint")}
          </div>
        )}
      </aside>
    </section>
  )
}

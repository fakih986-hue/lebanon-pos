import { AlertTriangle, Boxes, Layers3, PackageCheck } from "lucide-react"

import { useI18n } from "@lebanonpos/shared"
import { formatCurrency, formatNumber } from "../lib/currency"

type Props = {
  totalProducts: number
  totalStock: number
  totalValue: number
  urgentReorderCount: number
}

export default function KpiCards({
  totalProducts,
  totalStock,
  totalValue,
  urgentReorderCount,
}: Props) {
  const { t } = useI18n()
  return (
    <section className="grid grid-cols-1 gap-3 md:grid-cols-4">
      <div className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-emerald-100 text-emerald-700">
            <PackageCheck size={21} />
          </div>
          <div>
            <p className="text-sm font-medium text-zinc-500">
              {t("pos.kpi.active_products")}
            </p>
            <p className="text-2xl font-bold text-zinc-950">
              {formatNumber(totalProducts)}
            </p>
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-indigo-100 text-indigo-700">
            <Boxes size={21} />
          </div>
          <div>
            <p className="text-sm font-medium text-zinc-500">
              {t("pos.kpi.units_in_stock")}
            </p>
            <p className="text-2xl font-bold text-zinc-950">
              {formatNumber(totalStock)}
            </p>
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-amber-100 text-amber-700">
            <Layers3 size={21} />
          </div>
          <div>
            <p className="text-sm font-medium text-zinc-500">
              {t("pos.kpi.stock_value")}
            </p>
            <p className="text-2xl font-bold text-zinc-950">
              {formatCurrency(totalValue)}
            </p>
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-rose-100 text-rose-700">
            <AlertTriangle size={21} />
          </div>
          <div>
            <p className="text-sm font-medium text-zinc-500">
              {t("pos.kpi.reorder_needed")}
            </p>
            <p className="text-2xl font-bold text-zinc-950">
              {formatNumber(urgentReorderCount)}
            </p>
          </div>
        </div>
      </div>
    </section>
  )
}

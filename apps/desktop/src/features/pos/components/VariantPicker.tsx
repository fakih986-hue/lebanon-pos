import { useCallback } from "react"
import { X } from "lucide-react"

import { useI18n } from "@lebanonpos/shared"
import { formatCurrency, formatNumber } from "../lib/currency"
import type { Product } from "../types/product"

type Props = {
  product: Product
  products: Product[]
  onSelectVariant: (variant: Product, source: string) => void
  onClose: () => void
}

export default function VariantPicker({ product, products, onSelectVariant, onClose }: Props) {
  const { t } = useI18n()

  const handleSelect = useCallback((variant: Product) => {
    onSelectVariant(variant, "variant picker")
    onClose()
  }, [onSelectVariant, onClose])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-black/40" onClick={onClose} />
      <div className="relative w-full max-w-sm rounded-lg border border-zinc-200 bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-zinc-200 px-5 py-4">
          <h2 className="text-lg font-bold text-zinc-950">{product.name}</h2>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-600"
          >
            <X size={18} />
          </button>
        </div>

        <div className="max-h-80 overflow-y-auto px-5 py-4">
          <p className="mb-3 text-sm text-zinc-500">{t("pos.choose_variant")}</p>
          <div className="space-y-2">
            {products
              .filter((p) => p.parentId === product.id)
              .map((variant) => {
                const outOfStock = variant.stock <= 0
                return (
                  <button
                    key={variant.id}
                    type="button"
                    disabled={outOfStock}
                    onClick={() => handleSelect(variant)}
                    className={`w-full rounded-lg border p-3 text-left transition ${
                      outOfStock
                        ? "cursor-not-allowed border-zinc-100 bg-zinc-50 opacity-50"
                        : "border-zinc-200 bg-white hover:border-emerald-300 hover:bg-emerald-50"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-zinc-950">
                        {variant.variantName ?? variant.name}
                      </span>
                      <span className="text-sm font-semibold text-zinc-800">
                        {formatCurrency(variant.price)}
                      </span>
                    </div>
                    <div className="mt-1 flex items-center gap-3 text-xs text-zinc-500">
                      <span>{t("pos.in_stock", { n: formatNumber(variant.stock) })}</span>
                      <span>{variant.barcode}</span>
                    </div>
                  </button>
                )
              })}
          </div>
        </div>
      </div>
    </div>
  )
}
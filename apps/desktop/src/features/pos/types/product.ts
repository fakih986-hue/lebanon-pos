import type { Product as SharedProduct, ProductAccent } from "@lebanonpos/types"

export type { ProductAccent }

export type Product = SharedProduct & {
  barcode: string
  variantName?: string
  supplierId?: string
  supplierName?: string
  expiryDate?: string
  variants?: Product[]
}

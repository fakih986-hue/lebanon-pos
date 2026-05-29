export type ProductAccent =
  | "amber" | "cyan" | "emerald" | "indigo" | "rose" | "violet"

export type Product = {
  id: number
  parentId?: number | null
  isParent?: boolean
  variantName?: string | null
  name: string
  price: number
  cost: number
  stock: number
  barcode: string | null
  barcodeAliases?: string[]
  category: string
  accent: ProductAccent
  favorite?: boolean
  reorderPoint?: number | null
  reorderQuantity?: number | null
  supplierId?: string | null
  supplierName?: string | null
  expiryDate?: string | null
  image?: string | null
  createdAt?: string
  updatedAt?: string
}

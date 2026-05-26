export type ProductAccent =
  | "amber"
  | "cyan"
  | "emerald"
  | "indigo"
  | "rose"
  | "violet"

export type Product = {
  id: number
  parentId?: number | null
  isParent?: boolean
  variantName?: string
  variants?: Product[]
  name: string
  price: number
  cost: number
  stock: number
  barcode: string
  barcodeAliases?: string[]
  category: string
  accent: ProductAccent
  favorite?: boolean
  reorderPoint?: number
  reorderQuantity?: number
  supplierId?: string
  supplierName?: string
  expiryDate?: string
  image?: string
}

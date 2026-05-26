export type ProductAccent =
  | "amber"
  | "cyan"
  | "emerald"
  | "indigo"
  | "rose"
  | "violet"

export type Product = {
  id: number
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

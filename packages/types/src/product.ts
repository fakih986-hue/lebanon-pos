export type ProductAccent =
  | "amber" | "cyan" | "emerald" | "indigo" | "rose" | "violet"

export type Product = {
  id: number
  /**
   * Stable cross-system sync identity, generated once at product creation and
   * preserved identically across hub, LAN clients, and Railway. This — NOT the
   * numeric `id` — is the identity used to match a product across databases.
   * `id` is a local/internal autoincrement PK (and local FK target) whose value
   * legitimately differs between hub and cloud for the same logical product.
   * Optional/nullable during the transition: legacy rows are backfilled
   * cloud-authoritatively and old clients may omit it.
   */
  syncId?: string | null
  parentId?: number | null
  isParent?: boolean
  variantName?: string | null
  name: string
  price: number
  wholesalePrice?: number | null
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
  archived?: boolean
  createdAt?: string
  updatedAt?: string
}

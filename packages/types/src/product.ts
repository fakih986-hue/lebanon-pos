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
  /** Optional. A product without one has barcode null; identity is syncId (SPRINT-1). */
  barcode: string | null
  barcodeAliases?: string[]
  /** SPRINT-1: "tracked" (default: stock + lots) or "untracked" (made to order: no stock, no lots). */
  stockPolicy?: "tracked" | "untracked"
  /** Server-owned: +1 on every stock-policy change; a sale line carries the version it was sold under. */
  stockPolicyVersion?: number
  /** SPRINT-1: current stock-policy revision id ("initial" = as created). Minted once by whoever changes the policy. */
  stockPolicyRev?: string
  /** Sent with a policy change: the revision it was made on top of (the server detects concurrent edits with it). */
  stockPolicyParentRev?: string
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

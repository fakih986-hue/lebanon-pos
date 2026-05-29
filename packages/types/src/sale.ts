export type SaleItem = {
  id: string
  saleId: string
  productId: number
  productName: string
  barcode: string
  quantity: number
  unitPrice: number
  total: number
  cost?: number | null
}

export type SaleTender = {
  id: string
  saleId: string
  currency: string
  exchangeRate: number
  paidUsd: number
  paidLbp: number
  paidTotalUsd: number
  paidTotalLbp: number
  changeUsd: number
  changeLbp: number
}

export type Sale = {
  id: string
  saleNumber: string
  paymentMethod: string
  customerId?: string | null
  customerName?: string | null
  subtotal: number
  discountTotal?: number | null
  tax: number
  total: number
  cost: number
  profit: number
  tender?: SaleTender | null
  items: SaleItem[]
  cashier: string
  status: string
  createdAt: string
}

export type SaleRefund = {
  id: string
  refundNumber: string
  saleId: string
  saleNumber: string
  customerId?: string
  customerName?: string
  method: "Cash" | "Card" | "Wallet" | "Debt Credit"
  reason: string
  total: number
  items: RefundItem[]
  cashier: string
  createdAt: string
}

export type RefundItem = {
  id: number
  name: string
  barcode: string
  quantity: number
  unitPrice: number
  total: number
  cost?: number
}

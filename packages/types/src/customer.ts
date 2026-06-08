export type Customer = {
  id: string
  name: string
  mobile: string
  creditLimit: number
  isWholesale?: boolean
  sellAtCost?: boolean
  notes: string
  createdAt: string
}

export type CustomerLedger = Customer & {
  debtTotal: number
  paidTotal: number
  balance: number
  lastActivityAt: string | null
  overLimit: boolean
  overdue: boolean
}

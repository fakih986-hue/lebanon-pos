export type DeliveryOrderItem = {
  id: string
  deliveryOrderId: string
  productId: number
  productName: string
  barcode: string
  quantity: number
  unitPrice: number
  total: number
}

export type DeliveryOrder = {
  id: string
  orderNumber: string
  status: string
  customerName: string
  customerPhone: string
  address: string
  itemsTotal: number
  deliveryFee: number
  total: number
  paymentMethod: string
  paidAmount: number
  changeRequired: number
  assignedName?: string | null
  driverId?: string | null
  notes: string
  deliveryNote?: string
  cancelledReason?: string
  items: DeliveryOrderItem[]
  createdAt: string
  updatedAt: string
}

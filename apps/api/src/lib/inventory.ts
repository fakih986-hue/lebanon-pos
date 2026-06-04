type DecrementItem = {
  productId: number
  productName?: string
  quantity: number
}

type ProductStock = {
  id: number
  stock: number
  name: string
}

export async function decrementProductStock(
  tx: any,
  tenantId: string,
  items: DecrementItem[],
): Promise<void> {
  const ids = items.map((i) => i.productId)
  const prods = await tx.product.findMany({
    where: { tenantId, id: { in: ids } },
    select: { id: true, stock: true, name: true },
  }) as ProductStock[]

  const stockMap = new Map(prods.map((p) => [p.id, { stock: Number(p.stock), name: p.name }]))

  for (const item of items) {
    const info = stockMap.get(item.productId) ?? { stock: 0, name: item.productName ?? `ID ${item.productId}` }
    if (info.stock < item.quantity) {
      throw new Error(`Insufficient stock for "${info.name}": ${info.stock} available, ${item.quantity} required`)
    }
  }

  for (const item of items) {
    await tx.product.updateMany({
      where: { tenantId, id: item.productId },
      data: { stock: { decrement: item.quantity } },
    })
  }
}

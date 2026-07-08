type DecrementItem = {
  productId: number
  productName?: string
  quantity: number
}

export async function decrementProductStock(
  tx: any,
  tenantId: string,
  items: DecrementItem[],
): Promise<void> {
  for (const item of items) {
    const result = await tx.product.updateMany({
      where: { tenantId, id: item.productId, stock: { gte: item.quantity } },
      data: { stock: { decrement: item.quantity }, updatedAt: new Date() },
    })
    if (result.count === 0) {
      const product = await tx.product.findFirst({
        where: { tenantId, id: item.productId },
        select: { name: true, stock: true },
      })
      const name = product?.name ?? item.productName ?? `ID ${item.productId}`
      const stock = Number(product?.stock ?? 0)
      throw new Error(`Insufficient stock for "${name}": ${stock} available, ${item.quantity} required`)
    }
  }
}

export async function increaseProductStock(
  tx: any,
  tenantId: string,
  items: DecrementItem[],
): Promise<void> {
  for (const item of items) {
    await tx.product.updateMany({
      where: { tenantId, id: item.productId },
      data: { stock: { increment: item.quantity }, updatedAt: new Date() },
    })
  }
}

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
    // SPRINT-1: an untracked (made-to-order) product has no stock to decrement or to run out of.
    const result = await tx.product.updateMany({
      where: { tenantId, id: item.productId, stockPolicy: "tracked", stock: { gte: item.quantity } },
      data: { stock: { decrement: item.quantity }, updatedAt: new Date() },
    })
    if (result.count === 0) {
      const product = await tx.product.findFirst({
        where: { tenantId, id: item.productId },
        select: { name: true, stock: true, stockPolicy: true },
      })
      if (product?.stockPolicy === "untracked") continue
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
      where: { tenantId, id: item.productId, stockPolicy: "tracked" },
      data: { stock: { increment: item.quantity }, updatedAt: new Date() },
    })
  }
}

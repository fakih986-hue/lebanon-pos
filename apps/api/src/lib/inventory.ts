type DecrementItem = {
  productId: number
  productName?: string
  quantity: number
}

export async function decrementProductStock(
  tx: any,
  tenantId: string,
  optsOrItems: { byLinePolicy?: boolean } | DecrementItem[],
  maybeItems?: DecrementItem[],
): Promise<void> {
  // SPRINT-1: byLinePolicy = the caller passes only lines SOLD as tracked (a sale's policy is its
  // line's, never the product's current setting). Otherwise an untracked product is skipped.
  const byLine = !Array.isArray(optsOrItems) && !!optsOrItems.byLinePolicy
  const items = Array.isArray(optsOrItems) ? optsOrItems : maybeItems ?? []
  for (const item of items) {
    const result = await tx.product.updateMany({
      where: { tenantId, id: item.productId, ...(byLine ? {} : { stockPolicy: "tracked" }), stock: { gte: item.quantity } },
      data: { stock: { decrement: item.quantity }, updatedAt: new Date() },
    })
    if (result.count === 0) {
      const product = await tx.product.findFirst({
        where: { tenantId, id: item.productId },
        select: { name: true, stock: true, stockPolicy: true },
      })
      if (!byLine && product?.stockPolicy === "untracked") continue
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

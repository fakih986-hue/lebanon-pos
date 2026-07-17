import { describe, it, expect, vi } from "vitest"
import { completeMissingImages } from "../features/pos/services/productImage.service"
import type { Product } from "../features/pos/types/product"

// POS-CATALOG-IMAGE-BATCH-1
const p = (over: Partial<Product>): Product => ({
  id: 0, name: "X", price: 1, cost: 0.5, stock: 5, barcode: "B", category: "Test",
  accent: "emerald", barcodeAliases: [], image: undefined, ...over,
})

describe("POS-CATALOG-IMAGE-BATCH-1 — completeMissingImages", () => {
  it("targets only products without an image (skips existing + archived)", async () => {
    const generate = vi.fn().mockResolvedValue({ image: "data:img" })
    const save = vi.fn()
    const products = [
      p({ id: 1, name: "NoImg" }),
      p({ id: 2, name: "HasImg", image: "existing" }),
      p({ id: 3, name: "ArchivedNoImg", archived: true }),
    ]
    const r = await completeMissingImages(products, { generate, save })
    expect(r.total).toBe(1)
    expect(generate).toHaveBeenCalledTimes(1)
    expect(generate.mock.calls[0][0].id).toBe(1)
    expect(save).toHaveBeenCalledWith(1, "data:img")
    expect(r.generated).toBe(1)
  })

  it("never overwrites: a product that already has an image is left alone", async () => {
    const generate = vi.fn().mockResolvedValue({ image: "new" })
    const save = vi.fn()
    await completeMissingImages([p({ id: 5, image: "keep" })], { generate, save })
    expect(generate).not.toHaveBeenCalled()
    expect(save).not.toHaveBeenCalled()
  })

  it("records a failure and keeps processing the rest", async () => {
    const generate = vi.fn(async (prod: Product) => (prod.id === 1 ? null : { image: `img-${prod.id}` }))
    const save = vi.fn()
    const r = await completeMissingImages([p({ id: 1, name: "Fails" }), p({ id: 2, name: "Ok" })], { generate, save })
    expect(r.generated).toBe(1)
    expect(r.failed).toBe(1)
    expect(r.failures).toEqual([{ id: 1, name: "Fails" }])
    expect(save).toHaveBeenCalledWith(2, "img-2") // #2 still processed after #1 failed
  })

  it("a thrown error is caught per-product, does not abort the batch", async () => {
    const generate = vi.fn(async (prod: Product) => { if (prod.id === 1) throw new Error("boom"); return { image: "x" } })
    const save = vi.fn()
    const r = await completeMissingImages([p({ id: 1 }), p({ id: 2 })], { generate, save })
    expect(r.failed).toBe(1)
    expect(r.generated).toBe(1)
  })

  it("reports progress for every target", async () => {
    const onProgress = vi.fn()
    await completeMissingImages([p({ id: 1 }), p({ id: 2 })], {
      generate: vi.fn().mockResolvedValue({ image: "x" }), save: vi.fn(), onProgress,
    })
    expect(onProgress).toHaveBeenCalledTimes(2)
    expect(onProgress).toHaveBeenLastCalledWith(2, 2)
  })
})

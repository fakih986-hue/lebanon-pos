import { describe, it, expect } from "vitest"
import { detectStoreState, type StoreSignals } from "../features/pos/lib/storeSetup"

// POS-FIRST-SETUP-CATALOG-1B — pure fresh/active/review detection.
const base: StoreSignals = {
  productCount: 0,
  salesCount: 0,
  dailyCloseCount: 0,
  receivedBatchCount: 0,
  openingBatchCount: 0,
}

describe("POS-FIRST-SETUP-CATALOG-1B — detectStoreState", () => {
  it("fresh: empty store with no products or activity", () => {
    const r = detectStoreState({ ...base })
    expect(r.status).toBe("fresh")
  })

  it("active: any sale recorded", () => {
    const r = detectStoreState({ ...base, productCount: 3, salesCount: 1 })
    expect(r.status).toBe("active")
    expect(r.reasons.join(" ")).toMatch(/sale/i)
  })

  it("active: received (non-opening) stock batches exist", () => {
    const r = detectStoreState({ ...base, productCount: 3, receivedBatchCount: 2 })
    expect(r.status).toBe("active")
    expect(r.reasons.join(" ")).toMatch(/received/i)
  })

  it("active: a daily close exists", () => {
    const r = detectStoreState({ ...base, dailyCloseCount: 1 })
    expect(r.status).toBe("active")
  })

  it("review: products exist but no trading activity", () => {
    const r = detectStoreState({ ...base, productCount: 10 })
    expect(r.status).toBe("review")
    expect(r.reasons.join(" ")).toMatch(/product/i)
  })

  it("review: opening batches added but not yet trading", () => {
    const r = detectStoreState({ ...base, productCount: 5, openingBatchCount: 5 })
    expect(r.status).toBe("review")
    expect(r.reasons.join(" ")).toMatch(/opening/i)
  })

  it("opening batches are setup-in-progress (review), not trading activity (active)", () => {
    // opening batches present but no sales/received/closes → review, never active
    const r = detectStoreState({ ...base, openingBatchCount: 3 })
    expect(r.status).toBe("review")
  })
})

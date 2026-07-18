import { describe, it, expect, beforeEach } from "vitest"
import { detectStoreState, getStoreState, type StoreSignals } from "../features/pos/lib/storeSetup"

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

// POS-FIRST-SETUP-OFFLINE-FRESH-1 — getStoreState reads raw storage so a
// brand-new install (products key never written) reads as fresh, without the
// bundled demo catalog getProductsSync() falls back to being counted.
const PRODUCTS = "lebanonpos.products.v1"
const SALES = "lebanonpos.sales.v1"
const BATCHES = "lebanonpos.inventory-batches.v1"
const CLOSES = "lebanonpos.daily-closes.v1"

describe("POS-FIRST-SETUP-OFFLINE-FRESH-1 — getStoreState over raw storage", () => {
  beforeEach(() => {
    try { window.localStorage.clear() } catch { /* jsdom */ }
  })

  it("absent products key + no activity → fresh (bundled demo not counted)", () => {
    // products.v1 deliberately not set — getProductsSync() would return 12 demo
    // items here, but detection must ignore that fallback.
    expect(getStoreState().status).toBe("fresh")
  })

  it("absent products key + a sale → active", () => {
    window.localStorage.setItem(SALES, JSON.stringify([{ id: "s1" }]))
    expect(getStoreState().status).toBe("active")
  })

  it("products key = [] → fresh", () => {
    window.localStorage.setItem(PRODUCTS, "[]")
    expect(getStoreState().status).toBe("fresh")
  })

  it("products key with a real product (no activity) → review", () => {
    window.localStorage.setItem(PRODUCTS, JSON.stringify([{ id: 1, name: "Cola", barcode: "C1" }]))
    expect(getStoreState().status).toBe("review")
  })

  it("opening (OPENING-*) batches do NOT count as daily activity → review, not active", () => {
    window.localStorage.setItem(PRODUCTS, JSON.stringify([{ id: 1, name: "Cola", barcode: "C1" }]))
    window.localStorage.setItem(BATCHES, JSON.stringify([{ batchNumber: "OPENING-123" }]))
    expect(getStoreState().status).toBe("review")
  })

  it("received LOT batches count as active", () => {
    window.localStorage.setItem(PRODUCTS, JSON.stringify([{ id: 1, name: "Cola", barcode: "C1" }]))
    window.localStorage.setItem(BATCHES, JSON.stringify([{ batchNumber: "LOT-999" }]))
    expect(getStoreState().status).toBe("active")
  })

  it("a daily close alone → active (even with no products stored)", () => {
    window.localStorage.setItem(CLOSES, JSON.stringify([{ id: "dc1" }]))
    expect(getStoreState().status).toBe("active")
  })
})

import { describe, it, expect, vi, beforeAll } from "vitest"

// POS-FIRST-SETUP-QA-1 — fresh-store acceptance drill. Walks the real 1.0.39
// first-setup code paths against ONE disposable store (jsdom localStorage,
// cleared once at the start, no network) — the live store is never touched.
// Steps run in order and share state, mirroring a single setup session.

const { enqueueMock } = vi.hoisted(() => ({ enqueueMock: vi.fn() }))
vi.mock("../features/pos/services/sync.service", () => ({
  enqueueSyncOperation: (op: unknown) => enqueueMock(op),
  assertCanWrite: () => {},
}))

import { PRODUCT_IMPORT_HEADERS, parseProductImport, analyzeProductImport, commitProductImport, summarizeOpeningStock } from "../features/pos/services/import.service"
import { resolveScannedBarcode, commitScanSetup } from "../features/pos/services/scanSetup.service"
import { receiveProducts, getProductsSync } from "../features/pos/services/product.service"
import { getInventoryBatches, getStockMovements } from "../features/pos/services/inventoryBatch.service"
import { getStoreState, shouldShowFirstRunPrompt, dismissSetupPrompt } from "../features/pos/lib/storeSetup"
import { buildOpeningInventoryReport, openingReportToCsv } from "../features/pos/lib/openingInventoryReport"

const HEADER = PRODUCT_IMPORT_HEADERS.join(",")
const allOps = () => enqueueMock.mock.calls.map((c) => c[0] as any)
const byId = (name: string) => getProductsSync().find((p) => p.name === name)
const movesFor = (pid: number) => getStockMovements().filter((m) => m.productId === pid)
const batchesFor = (pid: number) => getInventoryBatches().filter((b) => b.productId === pid)

function runImport(body: string) {
  const { rows, error } = parseProductImport(`${HEADER}\n${body}`)
  expect(error).toBeUndefined()
  const plan = analyzeProductImport(rows, getProductsSync())
  return { plan, result: commitProductImport(plan, { opening: true }) }
}

beforeAll(() => {
  try {
    window.localStorage.clear()
    // A connected hub on a fresh tenant has done a full pull, which writes an
    // empty products array (sync.service full-pull → writeLocalWithIndexedDB
    // key,[]). That empty key — NOT the bundled demo fallback getProductsSync()
    // uses pre-sync — is the real fresh-store state onboarding runs against.
    window.localStorage.setItem("lebanonpos.products.v1", "[]")
    window.localStorage.setItem("lebanonpos.suppliers.v1", "[]")
  } catch { /* jsdom */ }
  enqueueMock.mockClear()
})

describe("POS-FIRST-SETUP-QA-1 — fresh store acceptance drill", () => {
  it("1. fresh-store detection: fresh + prompt shown, dismiss silences it", () => {
    expect(getStoreState().status).toBe("fresh")
    expect(shouldShowFirstRunPrompt()).toBe(true)
    dismissSetupPrompt()
    expect(shouldShowFirstRunPrompt()).toBe(false)
  })

  it("2a. spreadsheet import #1 — two new products with opening qty", () => {
    const { plan, result } = runImport(
      "Cola,COLA-1,,Beverages,0.40,0.75,24,,,,\nChips,CHIPS-1,,Snacks,0.30,0.60,10,,,,",
    )
    expect(plan.counts).toMatchObject({ create: 2, conflict: 0, invalid: 0 })
    expect(summarizeOpeningStock(plan)).toMatchObject({ units: 34, lines: 2 })
    expect(result.created).toBe(2)
    expect(byId("Cola")?.stock).toBe(24)
    expect(byId("Chips")?.stock).toBe(10)
    // once products exist (no sales/received), the store reads as "review"
    expect(getStoreState().status).toBe("review")
  })

  it("2b. spreadsheet import #2 — variant, existing restock, alias, conflict, invalid", () => {
    const before = getProductsSync().length
    const { plan, result } = runImport(
      [
        "Cola 1L,COLA-1L,,Beverages,0.80,1.50,6,,,Cola,1L", // variant
        "Cola,COLA-1,,Beverages,0.40,0.75,12,,,,",           // existing restock
        "Chips,CHIPS-1,CHIPS-ALT,Snacks,0.30,0.60,0,,,,",    // existing + alias
        "Imposter,COLA-1,,Beverages,1,2,3,,,,",              // conflict (barcode owned by Cola, dup in file)
        "NoBarcode,,,Beverages,1,2,1,,,,",                   // invalid
      ].join("\n"),
    )
    expect(plan.counts).toMatchObject({ variant: 1, existing: 2, conflict: 1, invalid: 1 })
    // valid rows commit; conflict + invalid do not
    expect(result.created).toBe(1)   // the variant
    expect(getProductsSync().length).toBe(before + 1) // no Imposter/NoBarcode
    expect(byId("Cola")?.stock).toBe(24 + 12)          // restocked
    expect(byId("Cola - 1L")?.parentId).toBe(byId("Cola")?.id)
    expect((byId("Chips")?.barcodeAliases ?? [])).toContain("CHIPS-ALT")
  })

  it("3. scan setup — new, existing, and name-nudge alias", () => {
    // new barcode → new product
    const r1 = commitScanSetup({ mode: "new", barcode: "WATER-1", name: "Water", category: "Beverages", cost: 0.5, price: 1, openingQty: 5 })
    expect(r1).toMatchObject({ ok: true, kind: "created" })
    expect(byId("Water")?.stock).toBe(5)

    // existing barcode → add opening qty
    const cola = byId("Cola")!
    const resolveCola = resolveScannedBarcode("COLA-1", "", getProductsSync())
    expect(resolveCola.kind).toBe("existing")
    const r2 = commitScanSetup({ mode: "existing", targetId: cola.id, barcode: "COLA-1", name: "Cola", category: "Beverages", cost: 0.4, price: 0.75, openingQty: 4 })
    expect(r2).toMatchObject({ ok: true, kind: "restocked" })
    expect(byId("Cola")?.stock).toBe(24 + 12 + 4)

    // new barcode whose NAME matches Water → nudge surfaces the match; "add barcode" attaches it
    const resolveNudge = resolveScannedBarcode("NEWCODE-9", "Water", getProductsSync())
    expect(resolveNudge.kind).toBe("new")
    if (resolveNudge.kind === "new") expect(resolveNudge.nameMatches.map((p) => p.name)).toContain("Water")
    const water = byId("Water")!
    const r3 = commitScanSetup({ mode: "alias", targetId: water.id, barcode: "NEWCODE-9", name: "Water", category: "Beverages", cost: 0.5, price: 1, openingQty: 0 })
    expect(r3).toMatchObject({ ok: true, kind: "aliased" })
    expect((byId("Water")?.barcodeAliases ?? [])).toContain("NEWCODE-9")
  })

  it("4. opening report — lists opening rows, totals correct, CSV works, Opening-only", () => {
    const report = buildOpeningInventoryReport(getStockMovements(), getInventoryBatches(), getProductsSync())
    // opening units: import1 24+10, import2 6+12, scan 5+4 = 61 across 4 products
    expect(report.summary.units).toBe(61)
    expect(report.summary.products).toBe(4)
    expect(report.summary.value).toBeCloseTo(24 * 0.4 + 10 * 0.3 + 6 * 0.8 + 12 * 0.4 + 5 * 0.5 + 4 * 0.4)
    // every row traces to an OPENING-* batch, never a LOT-*
    expect(report.rows.every((r) => r.batchNumber.startsWith("OPENING-"))).toBe(true)
    const csv = openingReportToCsv(report)
    expect(csv.split("\n")[0]).toBe("Date,Product,Barcode,Category,Quantity,Unit Cost,Value,Batch")
    expect(csv.split("\n").length).toBe(report.rows.length + 1)
  })

  it("5. daily receiving stays separate — Receive movement + LOT batch, excluded from opening report", () => {
    const openingRowsBefore = buildOpeningInventoryReport(getStockMovements(), getInventoryBatches(), getProductsSync()).rows.length

    receiveProducts([{ name: "Cola", barcode: "COLA-1", category: "Beverages", stock: 20, cost: 0.4, price: 0.75 }]) // NO opening flag
    const cola = byId("Cola")!
    expect(byId("Cola")?.stock).toBe(24 + 12 + 4 + 20)

    // a Receive movement + a LOT-* batch now exist for Cola
    expect(movesFor(cola.id).some((m) => m.type === "Receive" && m.quantity === 20)).toBe(true)
    expect(batchesFor(cola.id).some((b) => b.batchNumber.startsWith("LOT-"))).toBe(true)

    // the opening report is unchanged by the daily receive
    const openingAfter = buildOpeningInventoryReport(getStockMovements(), getInventoryBatches(), getProductsSync())
    expect(openingAfter.rows.length).toBe(openingRowsBefore)
    expect(openingAfter.rows.every((r) => r.batchNumber.startsWith("OPENING-"))).toBe(true)

    // detection now reads "active" because real received stock exists
    expect(getStoreState().status).toBe("active")
  })

  it("6. no supplier PO or payment was ever created by setup", () => {
    const entities = allOps().map((o) => o.entity)
    expect(entities).not.toContain("purchase-order")
    expect(entities).not.toContain("supplier-payment")
  })

  it("7. reconciliation — aggregate == sum(batch initial) == sum(ledger) for every product (no drift)", () => {
    for (const p of getProductsSync()) {
      const aggregate = p.stock
      const batchInitial = batchesFor(p.id).reduce((n, b) => n + b.initialQuantity, 0)
      const ledger = movesFor(p.id).reduce((n, m) => n + m.quantity, 0)
      expect(`${p.name}:${aggregate}`).toBe(`${p.name}:${batchInitial}`)
      expect(`${p.name}:${aggregate}`).toBe(`${p.name}:${ledger}`)
    }
  })
})

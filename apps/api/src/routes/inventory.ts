import { Router } from "express"
import type { ServerResponse } from "node:http"
import { randomUUID } from "node:crypto"
import prisma from "../lib/prisma.js"
import { recordStockMovement, recordStockMovementOnce } from "../lib/ledger.js"
import { requireAuth, json, type AuthRequest } from "../middleware/auth.js"

/**
 * POS-SYNC-AUTHORITY-2C-1 — Inventory Reconciliation (READ-ONLY report) + the
 * explicit 2C-0 "Initialize ledger" baseline action.
 *
 * Compares three INDEPENDENT views of stock per product:
 *   A — aggregate:      Product.stock
 *   B — open batches:   Σ InventoryBatch.quantityRemaining (status = Open)
 *   L — ledger expected: Σ StockMovement.quantity
 * …and surfaces the differences, a severity, a classification, and a suggested
 * (safe) action. It does NOT change any stock and does NOT make the ledger the
 * source of truth — repair is a separate, gated step (2C-2).
 */

const router = Router()
const EPS = 0.001
const isManager = (role?: string) => role === "Admin" || role === "Manager" || role === "Owner"

// ── GET /api/inventory/reconciliation ────────────────────────────────────────
// Read-only. Returns per-product A/B/L, diffs, severity, classification.
// Query: includeOk=1 to include products where all three views agree.
router.get("/reconciliation", requireAuth, async (req: AuthRequest, res: ServerResponse) => {
  try {
    const tenantId = req.auth!.tenantId
    if (!isManager(req.auth!.role)) { json(res, { error: "Managers only" }, 403); return }
    const includeOk = req.query.includeOk === "1" || req.query.includeOk === "true"

    const [products, openBatchSums, batchProductIds, ledgerSums, movementCounts] = await Promise.all([
      prisma.product.findMany({
        where: { tenantId, archived: false, isParent: false },
        select: { id: true, syncId: true, name: true, barcode: true, category: true, stock: true },
      }),
      prisma.inventoryBatch.groupBy({ by: ["productId"], where: { tenantId, status: "Open" }, _sum: { quantityRemaining: true } }),
      prisma.inventoryBatch.groupBy({ by: ["productId"], where: { tenantId }, _count: { _all: true } }),
      (prisma as any).stockMovement.groupBy({ by: ["productId"], where: { tenantId }, _sum: { quantity: true } }),
      (prisma as any).stockMovement.groupBy({ by: ["productId"], where: { tenantId }, _count: { _all: true } }),
    ])

    const openByProd = new Map<number, number>(openBatchSums.map((r: any) => [r.productId, Number(r._sum.quantityRemaining ?? 0)]))
    const hasBatch = new Set<number>(batchProductIds.map((r: any) => r.productId))
    const ledgerByProd = new Map<number, number>(ledgerSums.map((r: any) => [r.productId, Number(r._sum.quantity ?? 0)]))
    const movesByProd = new Map<number, number>(movementCounts.map((r: any) => [r.productId, Number(r._count._all ?? 0)]))

    const rows = []
    for (const p of products) {
      const A = Number(p.stock)
      const B = openByProd.get(p.id) ?? 0
      const L = ledgerByProd.get(p.id) ?? 0
      const hasBatches = hasBatch.has(p.id)
      const nMoves = movesByProd.get(p.id) ?? 0
      const diffAB = round(A - B), diffAL = round(A - L), diffBL = round(B - L)

      const classification: string[] = []
      let severity: "ok" | "warn" | "error" = "ok"
      if (nMoves === 0 && Math.abs(A) > EPS) { classification.push("no_opening_baseline"); severity = "warn" }
      if (hasBatches && Math.abs(diffAB) > EPS) { classification.push("stock_batch_mismatch"); severity = "error" }
      if (nMoves > 0 && Math.abs(diffAL) > EPS) { classification.push("ledger_vs_aggregate"); if (severity !== "error") severity = "warn" }
      if (B < -EPS) { classification.push("negative_batch"); severity = "error" }

      if (severity === "ok" && !includeOk) continue

      rows.push({
        productId: p.id, syncId: p.syncId, name: p.name, barcode: p.barcode, category: p.category,
        aggregate: A, openBatchTotal: round(B), ledgerExpected: round(L), diffAB, diffAL, diffBL,
        hasBatches, movementCount: nMoves, severity, classification,
        suggestedAction: suggest(classification, hasBatches),
      })
    }
    rows.sort((a, b) => sevRank(b.severity) - sevRank(a.severity) || Math.abs(b.diffAB) - Math.abs(a.diffAB))

    json(res, {
      generatedAt: new Date().toISOString(),
      totalProducts: products.length,
      flagged: rows.length,
      summary: {
        error: rows.filter(r => r.severity === "error").length,
        warn: rows.filter(r => r.severity === "warn").length,
        needsBaseline: rows.filter(r => r.classification.includes("no_opening_baseline")).length,
      },
      rows,
    })
  } catch (err) {
    console.error("reconciliation error:", err)
    json(res, { error: "Failed to build reconciliation report" }, 500)
  }
})

// ── POST /api/inventory/ledger/initialize ─────────────────────────────────────
// 2C-0: anchor each product's ledger to its current aggregate by seeding an
// Opening = (Product.stock − Σ existing movements), so ledgerExpected == stock
// as a baseline. Idempotent (recordStockMovementOnce skips an existing opening).
// Admin only. RECORD-ONLY — creates ledger rows, changes no stock.
router.post("/ledger/initialize", requireAuth, async (req: AuthRequest, res: ServerResponse) => {
  try {
    const tenantId = req.auth!.tenantId
    if (req.auth!.role !== "Admin") { json(res, { error: "Admins only" }, 403); return }

    const [products, ledgerSums] = await Promise.all([
      prisma.product.findMany({ where: { tenantId, archived: false, isParent: false }, select: { id: true, syncId: true, stock: true } }),
      (prisma as any).stockMovement.groupBy({ by: ["productId"], where: { tenantId }, _sum: { quantity: true } }),
    ])
    const sumByProd = new Map<number, number>(ledgerSums.map((r: any) => [r.productId, Number(r._sum.quantity ?? 0)]))

    let seeded = 0
    for (const p of products) {
      const A = Number(p.stock)
      const existing = sumByProd.get(p.id) ?? 0
      const openingQty = round(A - existing)
      if (Math.abs(openingQty) <= EPS) continue // already anchored
      const before = await (prisma as any).stockMovement.count({ where: { tenantId, productId: p.id } })
      await recordStockMovementOnce(prisma, tenantId, {
        productId: p.id, type: "Opening", quantity: openingQty,
        reference: `opening:${p.syncId ?? p.id}`,
        note: "Ledger baseline (initialize)",
        userId: req.auth!.userId,
      })
      const after = await (prisma as any).stockMovement.count({ where: { tenantId, productId: p.id } })
      if (after > before) seeded++
    }
    json(res, { ok: true, seeded, totalProducts: products.length })
  } catch (err) {
    console.error("ledger initialize error:", err)
    json(res, { error: "Failed to initialize ledger" }, 500)
  }
})

// ── POST /api/inventory/reconciliation/repair ────────────────────────────────
// 2C-2: the ONE narrow repair action — lower an over-stated aggregate down to the
// open-batch total. NEVER increases stock, NEVER touches batches, ONLY for
// batch-tracked products (guards against zeroing legitimately-untracked stock).
// Goes through the same adjustment + movement logic and records full audit
// evidence. Idempotent by precondition: a second click finds no mismatch and is
// rejected cleanly. Does NOT make the ledger the source of truth.
router.post("/reconciliation/repair", requireAuth, async (req: AuthRequest, res: ServerResponse) => {
  try {
    const tenantId = req.auth!.tenantId
    if (!isManager(req.auth!.role)) { json(res, { error: "Managers only" }, 403); return }
    const productId = Number((req.body as any)?.productId)
    const reason = String((req.body as any)?.reason ?? "").trim()
    if (!productId || productId <= 0) { json(res, { error: "productId is required" }, 400); return }
    if (!reason) { json(res, { error: "A reason is required" }, 400); return }

    const result = await prisma.$transaction(async (tx) => {
      const product = await tx.product.findFirst({
        where: { tenantId, id: productId },
        select: { id: true, name: true, barcode: true, stock: true, cost: true },
      })
      if (!product) throw new RepairError(404, "Product not found")

      // Only batch-tracked products may be reconciled to batches — zeroing an
      // untracked product would destroy real stock (see AUTHORITY-1).
      const batchCount = await tx.inventoryBatch.count({ where: { tenantId, productId } })
      if (batchCount === 0) throw new RepairError(400, "Product has no batch records — cannot reconcile to batches (would wipe untracked stock). Use a physical stock count instead.")

      const aggregateBefore = Number(product.stock)
      const openAgg = await tx.inventoryBatch.aggregate({ where: { tenantId, productId, status: "Open" }, _sum: { quantityRemaining: true } })
      const batchTotal = round(Number(openAgg._sum.quantityRemaining ?? 0))
      const delta = round(batchTotal - aggregateBefore) // negative when over-stated

      // Only allowed direction: aggregate strictly greater than batch total.
      if (delta >= -EPS) throw new RepairError(400, `No downward mismatch to repair (aggregate ${aggregateBefore} ≤ open-batch total ${batchTotal}).`)

      // Guarded decrement: fails if stock changed under us (concurrent sale/repair),
      // which also makes a double-click a clean no-op (second call sees no mismatch).
      const upd = await tx.product.updateMany({
        where: { tenantId, id: productId, stock: aggregateBefore },
        data: { stock: batchTotal, updatedAt: new Date() },
      })
      if (upd.count === 0) throw new RepairError(409, "Stock changed during repair — refresh and try again.")

      const adjustmentId = randomUUID()
      const adjustmentNumber = `REPAIR-${adjustmentId.slice(0, 8).toUpperCase()}`
      await tx.stockAdjustment.create({
        data: {
          id: adjustmentId, tenantId, adjustmentNumber,
          productId: product.id, productName: product.name, barcode: product.barcode,
          quantityBefore: aggregateBefore, quantityChange: delta, quantityAfter: batchTotal,
          reason, note: "Reconcile: lower aggregate to open-batch total",
          batchId: null, valueImpact: delta * Number(product.cost),
        } as any,
      })
      // Same ledger logic as the adjustment path.
      await recordStockMovement(tx as any, tenantId, {
        productId: product.id, type: "Adjustment", quantity: delta, reference: adjustmentId,
        note: "Reconcile aggregate→batch", userId: req.auth!.userId, userName: req.auth!.userId,
      })
      await tx.auditEvent.create({
        data: {
          tenantId, action: "inventory.reconcile.repair", entity: "inventory",
          summary: `Lowered ${product.name} stock ${aggregateBefore} → ${batchTotal} to match open batches`,
          metadata: { productId: product.id, aggregateBefore, batchTotal, delta, adjustmentId, reason },
          userId: req.auth!.userId, userName: "system", userRole: req.auth!.role,
        } as any,
      })
      return { aggregateBefore, batchTotal, aggregateAfter: batchTotal, delta, adjustmentId }
    })

    json(res, { ok: true, ...result })
  } catch (err) {
    if (err instanceof RepairError) { json(res, { error: err.message }, err.status); return }
    console.error("repair error:", err)
    json(res, { error: "Repair failed" }, 500)
  }
})

class RepairError extends Error {
  constructor(public status: number, message: string) { super(message) }
}

function round(n: number): number { return Math.round(n * 1000) / 1000 }
function sevRank(s: string): number { return s === "error" ? 2 : s === "warn" ? 1 : 0 }
function suggest(classification: string[], hasBatches: boolean): string {
  if (classification.includes("negative_batch")) return "Repair the negative batch (Control panel)."
  if (classification.includes("stock_batch_mismatch")) return hasBatches ? "Reconcile aggregate to open-batch total, or run a physical stock count." : "Run a physical stock count."
  if (classification.includes("no_opening_baseline")) return "Run Initialize ledger to anchor this product's baseline."
  if (classification.includes("ledger_vs_aggregate")) return "Investigate an unledgered stock change; a stock count will re-anchor."
  return "No action needed."
}

export default router

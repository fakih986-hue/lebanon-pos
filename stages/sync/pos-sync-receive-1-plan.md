# POS-SYNC-RECEIVE-1 — Server-Authoritative Receiving (PLAN)

**Date:** 2026-07-14
**Status:** plan only — **do not implement yet**
**Goal:** make the server `inventory/receive` handler authoritative for aggregate `Product.stock`, so the trust-based `_stockUpdate` marker (HARDEN-2) can be removed and `product.update` can strip `stock` unconditionally.

---

## 1. Current flow audit (code-grounded)

### Client — `receiveProducts` (product.service.ts:~200–345)
Order of enqueued ops per receive (batches enqueued **after** product ops, line 336):
| # | Case | Op | Payload stock | Notes |
|---|------|-----|---------------|-------|
| 1 | New product | `product.create` | `stock = entry.stock` (l.276, via `newlyCreated`) | full product incl. stock |
| 2 | Existing product | `product.update` | `stock = existing + entry.stock` (l.243) + **`_stockUpdate: true`** (l.332) | full product incl. new aggregate |
| 3 | Both | `inventory/receive` (`receiveInventoryBatches`, inventoryBatch.service:205–247) | batch `quantityRemaining = entry.quantity`, **stable `id: createId("batch")`** (l.211) | one op with all batches |

Local cache (`writeProducts`) is updated to the real new stock for immediate display.

### Server — `processOperation` (sync.ts)
- **`product.create`** (696–745): match syncId→barcode→create; on genuine create → `db.product.create({...incl stock})`; **2A**: if `created.stock !== 0` → `recordStockMovementOnce("Opening", stock, opening:<syncId>)`.
- **`product.update`** (680–695 + HARDEN-2): strips `stock` from patch **unless `_stockUpdate`** marker present (then re-attaches stock). No stock movement.
- **`inventory/receive`** (1124–1131): `resolveProductId`; `inventoryBatch.upsert({where:{id:batchId}})`; `recordMovement("Receive", qty, batchId)`. **Does NOT change `Product.stock`.**

### Where the aggregate actually changes today
`Product.stock` for a restock is set by op #1 (new, `=entry.stock`) or op #2 (existing, `=existing+qty`). The receive op (#3) only creates the batch + a Receive movement. This is exactly why HARDEN-2 needed the `_stockUpdate` exception.

---

## 2. Proposed design

**Move the aggregate delta into the receive handler; stop sending it via product ops.**

- **Server `inventory/receive`** becomes authoritative: when a batch is **first** created, increment `Product.stock` by that batch's quantity and record the Receive movement. On a retry (batch already exists), do neither (idempotent).
- **Client `receiveProducts`**:
  - New product → `product.create` op payload sends **`stock: 0`** (local cache keeps the real stock for display). Create sets 0 → no Opening movement; the receive op provides the +qty and the Receive movement.
  - Existing product → keep the **metadata** `product.update` (price/cost/reorder/supplier/expiry) but **without `stock` and without `_stockUpdate`**. The aggregate comes solely from the receive op.
  - Remove the `_stockUpdate` marker entirely.
- **Server `product.update` guard** → strip `stock` **unconditionally** (drop the `_stockUpdate` branch).

### Why this prevents double-counting
| Case | create sets stock | receive increments | product.update stock | Result |
|------|-------------------|--------------------|----------------------|--------|
| New (receive) | 0 | +qty (once) | n/a | qty ✅ |
| Existing (receive) | n/a | +qty (once) | stripped | existing+qty ✅ |
| Setup-form create (no receive) | input.stock (+Opening) | none | n/a | input.stock ✅ (unchanged) |

The only source of the received delta is the receive op. `product.create`/`product.update` never contribute stock in the receive path.

### Opening movements stay correct
- Receive-created product: created at 0 (no Opening) → Receive movement `+qty` → Σmovements = qty = stock. ✅
- Setup-form product (opening stock, no batch): Opening = input.stock, no receive. ✅ (unchanged)

---

## 3. Idempotency (SyncOperation ordering)

Two layers, both required:
1. **Op-id layer (existing):** `/api/sync/push` skips an op whose id is already `Synced` (sync.ts:154). Handles exact-duplicate retries.
2. **Batch-existence layer (new):** the receive handler increments stock + records the Receive movement **only when the batch id is newly created**. A retry that re-wraps the same batch under a new op id sees the batch already exists → skips the increment. Backed by the stable client-generated batch `id`.
   - Implementation: replace the current `inventoryBatch.upsert` with an explicit `findUnique(id)` → **create + increment + `recordStockMovementOnce`** (new) / **update only** (exists, no increment). Mirrors the cloudSync batch pattern.
   - `recordStockMovementOnce(reference=batchId, type="Receive")` makes the movement idempotent too.

**Ordering:** the client already enqueues create/update **before** receive (l.336), and the push handler processes ops in array order, so the product exists when the receive op runs. Preserve this ordering. If a create fails but its receive is attempted, `resolveProductId` returns 0 and the increment is skipped (batch create also fails) — same failure mode as today; the whole receive is re-pushed.

**Cloud (Railway):** same handler code runs on hub and cloud. Hub receive increments hub stock (batch new); hub pushes create(0)+update(meta)+receive → cloud increments cloud stock (batch new on cloud) once; retry → batch exists → skip. AUTHORITY-1 keeps the hub ignoring cloud stock on pull, so no interference.

---

## 4. Exact proposed changes

### Client — `apps/desktop/src/features/pos/services/product.service.ts` (`receiveProducts`)
- **New-product create op:** change the enqueue payload to send stock 0 without altering the local cache:
  `payload: newlyCreated.map(p => ({ ...p, stock: 0 }))` (local `nextProducts` still holds `stock: entry.stock` from l.276 for display).
- **Existing-product update op:** send metadata only, no stock, no marker:
  `const { stock: _stock, ...meta } = mod; enqueue({ entity:"product", action:"update", payload: meta })` — drop the `_stockUpdate: true` (l.332) and the HARDEN-2 comment.
- Grep-remove any remaining `_stockUpdate` references in the client.

### Server — `apps/api/src/routes/sync.ts`
- **`inventory/receive`** (1124–1131): replace the batch `upsert` with:
  ```
  const existing = await db.inventoryBatch.findUnique({ where: { id: batchId }, select: { id: true } })
  if (!existing) {
    await db.inventoryBatch.create({ data: { ...batchData, id: batchId, tenantId } })
    const qty = Number(item.quantityRemaining ?? item.initialQuantity ?? 0)
    if (productId > 0 && qty !== 0) {
      await db.product.updateMany({ where: { tenantId, id: productId }, data: { stock: { increment: qty }, updatedAt: new Date() } })
    }
    await recordStockMovementOnce(db, tenantId, { productId, type: "Receive", quantity: qty, reference: batchId, note: `Batch ${item.batchNumber ?? ""}`, ...source })
  } else {
    await db.inventoryBatch.update({ where: { id: batchId }, data: batchData })   // metadata correction; NO stock change
  }
  ```
  (Switch `recordMovement` → `recordStockMovementOnce`; thread `source` deviceId/userId already available.)
- **`product.update`** guard (680–695): remove the `_stockUpdate` branch; always strip `stock`:
  `const { id, syncId, tenantId: _t, stock: _stock, ...patch } = { ...item }` + warn if `_stock !== undefined`. (Delete the `if (_stockUpdate) …` logic.)

### No schema/migration change. No changes to sale/refund/void/adjust/count handlers.

---

## 5. Tests

**Server (`sync.test.ts` / new cases):**
1. New batch receive → `Product.stock` increments by qty **once**; Receive movement recorded once.
2. Retry receive (same batch id, new op id) → stock **not** incremented again; movement not duplicated.
3. Existing-product receive (product.update metadata, no stock; then receive) → stock = existing + qty.
4. `product.update` carrying `stock` (no marker) → stock **stripped** (guard now unconditional); metadata applied.
5. `product.create` with `stock: 0` (receive path) → no Opening movement; subsequent receive → stock = qty.
6. Setup-form `product.create` with `stock > 0` (no receive) → stock set + Opening movement (unchanged).
7. Multi-batch receive for the same product → stock increments by the **sum**.
8. Regression: sale decrements, refund/void restore, adjustment applies — all unchanged; reconciliation endpoints unaffected.

**Client (desktop):**
9. `receiveProducts` new-product create-op payload has `stock === 0` while local cache stock === received qty.
10. `receiveProducts` existing-product update-op payload has **no** `stock` and **no** `_stockUpdate`; local cache stock === existing + qty.
11. No `_stockUpdate` string remains in the client bundle.

---

## 6. Edge cases, risks, non-goals

- **Legacy/untracked product receive:** batch created + stock += qty → aggregate = legacy + qty, batch = qty. Reconciliation may flag aggregate>batch — **expected** for a now-partially-tracked product; not a regression.
- **Transient within a push:** after `create(0)` and before `receive`, the server briefly has stock 0; the ordered receive in the same push resolves it to qty. No external observer sees the transient mid-push.
- **Marker removal is the security win:** once shipped, no client can inflate stock via a marked update; the guard is absolute.
- **Non-goals:** no checkout/tender/tax/customer-debt/sale/refund logic changes; no schema/migration; no new features.
- **Deploy:** requires a hub installer build + a Railway deploy (server code); no migration. Fully revertible (code-only).

## 7. Rollout
1. Implement client + server changes + tests. 2. API/desktop/electron typecheck + API/desktop tests. 3. Live-smoke on dev API: new+existing receive, retry idempotency, guard-strip. 4. Build installer (next version) + Railway deploy. 5. Real-hub acceptance: restock existing (+N once), receive new (=N), edit product (stock unchanged), retry safe.

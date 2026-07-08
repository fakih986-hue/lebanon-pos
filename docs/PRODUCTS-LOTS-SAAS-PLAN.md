# Products, Lots, Receiving & Inventory — SaaS Implementation Plan

**Date:** 2026-07-08
**Status:** Planning — no implementation
**Design Direction:** Midnight Gold (premium dark, gold accent, calm surfaces)

---

## 1. Executive Summary

The product/inventory system has strong foundations but critical gaps:
- **Stock changes bypass batches** — createProduct, updateProduct, and pull sync all change stock without batch tracking
- **Stock changes bypass movement records** — decreaseProductStock/increaseProductStock have no audit trail
- **Refunds don't restore batches** — server-side refund sync only restores product.stock, not batch quantities
- **Receiving UX is slow** — no batch scan, no PO linkage, no paste-from-spreadsheet
- **Archive is client-only** — `archived` field not in DB, lost on full re-sync
- **Barcode aliases not fully protected** — createProduct doesn't check aliases for conflicts

This plan addresses all gaps in 5 phases, from data safety through UX overhaul.

---

## 2. Current Architecture Summary

### Product Model
- **DB**: `Product` table (schema.prisma:164-201) — 30+ fields, Decimal(18,4) for money, Float for quantity
- **Unique**: `[tenantId, barcode]` — allows null barcodes (no constraint on null)
- **Variants**: Parent/child via `parentId` self-relation
- **Archive**: `archived` field in TypeScript type only — NOT in Prisma schema. Client-side filter only.

### Batch Model
- **DB**: `InventoryBatch` (schema.prisma:498-521) — FIFO/FEFO tracking with `quantityRemaining`
- **Status**: Open | Consumed | Expired
- **Sorting**: Expiry date first (FEFO), then receipt date (FIFO)
- **Consumption**: `consumeInventoryBatches()` allocates from oldest valid batches
- **Restore**: LIFO restore (by receivedAt desc) — matches refund, not original consumption order

### Stock Movement
- **Desktop**: `lebanonpos.stock-movements.v1` localStorage key
- **Server**: `StockMovement` table (schema.prisma:676-691)
- **Two separate audit trails** — desktop and server movements are independent

### Sync Paths
- **Desktop push**: localStorage → enqueueSyncOperation → POST /api/sync/push
- **Desktop pull**: GET /api/sync/pull → merge by ID → overwrite localStorage
- **Cloud bridge**: local PostgreSQL ↔ Railway bi-directional sync
- **Idempotency**: Most entities use upsert by ID. Product without barcode can duplicate.

---

## 3. Product Lifecycle Map

```
CREATE → (with barcode?) → sync push
  ├─ barcode exists → upsert to existing (merge stock)
  ├─ no barcode → create (can duplicate on retry)
  └─ with initial stock → NO batch created

UPDATE → cleanPatch → normalize name/barcode/category
  ├─ barcode change → checks duplicates (covers aliases)
  ├─ stock change → direct mutation, NO batch, NO movement
  └─ price/cost change → does NOT affect historical profit

ARCHIVE → sets archived=true (client only)
  ├─ cascades to child variants
  ├─ audit event recorded
  └─ lost on full re-sync (field not in DB)

DELETE → permanently removes + cascades
  ├─ deletes batches, adjustments, movements, count lines
  ├─ does NOT check sale/refund/delivery item references
  └─ no audit event (hard delete)

RECEIVE → creates batch, increases stock
  ├─ existing barcode → merges stock + creates batch
  ├─ new barcode → creates product + batch
  ├─ dual-writes stock (in receiveProducts + receiveInventoryBatches)
  └─ PO/supplier linked to batch
```

---

## 4. Lot/Batch Lifecycle Map

```
RECEIVE → create batch (Open, initialQuantity = quantityRemaining)
  └─ optimistic stock update on product

CONSUME (sale) → FIFO/FEFO decrement
  ├─ sort: expiry date, then receipt date
  ├─ expired batches pushed to end
  ├─ allocates from multiple batches as needed
  ├─ legacy-stock allocation for unconsumed remainder
  └─ records StockMovement(type="Sale")

RESTORE (refund/void) → LIFO increment
  ├─ fills batches up to initialQuantity
  ├─ overflow creates RETURN-* batch
  ├─ records StockMovement(type="Refund")
  └─ restores different lot than consumed (LIFO vs FIFO mismatch)

ADJUST (manual) → positive or negative delta
  ├─ positive: selects specific batch or creates new
  ├─ negative: FIFO/FEFO decrement from available
  └─ records StockMovement(type="Receive" or "Adjustment")

EXPIRE → auto-marked as Expired
  └─ updateBatchStatus() checks expiryDate vs now()
```

---

## 5. Stock Mutation Map (all paths where Product.stock changes)

| # | Path | Batch? | Movement? | Idempotent? | Risk |
|---|---|---|---|---|---|
| A | `createProduct` (new barcode) | **NO** | **NO** | No (no-barcode) | Stock without provenance |
| B | `createProduct` (dup merge) | **NO** | **NO** | Yes (upsert) | Stock without batch |
| C | `receiveProducts` (existing) | YES | YES (Receive) | Yes (upsert) | Dual-stock-write |
| D | `receiveProducts` (new) | YES | YES (Receive) | Yes (upsert) | Safe |
| E | `updateProduct` (stock patch) | **NO** | **NO** | Yes (upsert) | Silent stock change |
| F | `decreaseProductStock` | **NO** | **NO** | N/A | No audit |
| G | `increaseProductStock` | **NO** | **NO** | N/A | No audit |
| H | POS sale (consumeBatches) | YES | YES (Sale) | Yes (ID guard) | Safe |
| I | POS refund (restoreBatches) | YES | YES (Refund) | Server: NO guard | Server double-restore |
| J | POS void (restoreBatches) | YES | YES (Refund) | Yes (Voided guard) | Safe |
| K | Delivery deliver (server) | **NO** | **NO** | Yes (status guard) | No batch, no movement |
| L | Pull sync overwrite | N/A | **NO** | Yes (replace) | Full overwrite |

---

## 6. Current Risks and Bugs

### Critical
1. **Server-side refund sync has NO idempotency guard** — `sync.ts:680-718` always increments stock. Retried refund doubles the stock increment. Product: line 710-713 — `stock: { increment: item.quantity }` is unconditional.

2. **createProduct creates stock without batch** — `product.service.ts:405` sets stock directly. No `receiveInventoryBatches` call. Stock has no provenance.

3. **Archive field not in DB** — `packages/types/src/product.ts:25` has `archived?: boolean` but `schema.prisma:164-201` does NOT. Any full re-sync loses all archive state.

4. **Dual stock-writes in receiving** — `receiveProducts` writes stock via `nextProducts` array, AND `receiveInventoryBatches` writes stock via raw localStorage. Both for the same product in the same call.

### High
5. **Refund restores wrong batch** — LIFO restore vs FIFO consume means different lots are restored on refund.

6. **Server refund doesn't restore batches** — `sync.ts:680-718` only restores `product.stock` via increment, not `InventoryBatch.quantityRemaining`.

7. **Barcode aliases not fully protected** — `createProduct` checks primary barcode only, not aliases.

8. **POS receiving writes per-row** — If batch save fails mid-way, partial mutations are committed with no rollback.

### Medium
9. **Receiving UX slow** — external barcode lookup calls 4 APIs sequentially with no timeout.
10. **ProductTable shows archived products** — ProductsPage catalog doesn't filter archived.
11. **Two separate StockMovement audit trails** — desktop and server never reconcile.

---

## 7. Data Model Gaps

| Gap | Current State | Needed |
|-----|--------------|--------|
| `archived` field | TypeScript only | Add to Prisma Product model |
| Batch create on product create | Not done | Call `receiveInventoryBatches` in `createProduct` |
| Server refund batch restore | Not done | Add batch increment logic to refund sync handler |
| Server void batch restore | Not done | Add batch increment logic to void sync handler |
| Server delivery batch | Not done | Pass batch allocations in delivery sync |
| Barcode alias unique constraint | Partial | Add server+client alias duplicate checks |

---

## 8. Sync/Offline Risks

| Risk | Impact | Fix |
|------|--------|-----|
| Product without barcode duplicates on retry | Stale duplicates | Add barcode requirement or fallback unique ID |
| Pull overwrites unsynced archive state | Archive lost | Add `archived` to DB, sync properly |
| Desktop and server stock movements diverge | Audit gap | Unify to single movement source |
| Server refund double-increment | Stock inflation | Add idempotency guard (check if already processed) |

---

## 9. API/Server Risks

1. **Refund handler** (`sync.ts:680-718`): No idempotency. Always increments stock. Always creates refund. No check if refund already exists.
2. **Product delete cascading** (`sync.ts:539-556`): Deletes batches, adjustments, movements. Irreversible.
3. **Delivery handler** (`delivery.ts:520-540`): Stock decrement on delivery uses `decrementProductStock` which only touches `product.stock`. No batch consumption.
4. **No transaction wrapping on refund/void server sync** — stock increment and batch increment are separate operations.

---

## 10. UI/UX Workflow Problems

### Receiving (`ProductReceivePage.tsx`)
- External barcode API calls 4 sources sequentially, no timeout
- No batch paste from spreadsheet
- No PO linkage to the receive form
- PO status updates disconnected from receiving
- No receipt history sidebar for reference
- Form validation only shows generic toast, not per-row
- Label printing requires manual entry per row

### Products Page (`ProductsPage.tsx`)
- Archived products visible in catalog table
- Category management manual per-category rename
- No inline stock adjustment from the catalog

### POS Checkout
- Stock snapshotted at add-time — concurrent pull could change real stock
- No warning when cart total exceeds available stock across items

---

## 11. Recommended Target Architecture

### Add `archived` to DB
```prisma
archived Boolean @default(false)
```
Migration: `ALTER TABLE "Product" ADD COLUMN "archived" BOOLEAN NOT NULL DEFAULT false;`

### Fix server refund idempotency
```typescript
// Before processing refund sync:
const existing = await db.saleRefund.findUnique({ where: { id: payload.id } })
if (existing) return // already processed, skip stock/batch changes
```

### Fix createProduct to create batch
```typescript
// After setting stock in createProduct:
if (input.stock > 0) {
  receiveInventoryBatches([{
    productId: newProduct.id, productName: newProduct.name,
    barcode: newProduct.barcode, quantity: input.stock,
    unitCost: input.cost, unitPrice: input.price,
  }])
}
```

### Unify stock movements
- Remove desktop-only `lebanonpos.stock-movements.v1`
- Rely on server-side StockMovement records
- Pull movements as part of sync

### Fix receiving dual-write
- Remove optimistic localStorage write from `receiveInventoryBatches`
- Let `receiveProducts` be the single source of truth for product stock

---

## 12. Recommended Target Product Workflow

```
Product create:
  1. User enters: name, barcode, price, cost, stock, category
  2. Validate: name required, barcode unique (primary + aliases), price >= 0, cost >= 0
  3. createProduct → sets stock → creates batch for initial stock
  4. Enqueue sync → product/create + inventory/receive
  5. "Save and add another" → clears form, keeps category/supplier defaults

Product edit:
  6. Edit modal: name, category, price, cost, barcode, reorder, supplier
  7. Stock change → requires receiving flow (not inline edit)
  8. Price/cost change → does NOT affect historical profit (already correct)

Product archive:
  9. Click archive → confirmation → sets archived=true
  10. Variants archived together
  11. Hidden from POS + active lists
  12. Visible in reports/history
  13. Reversible by manager/admin

Product delete:
  14. Only allowed if: no sales, no refunds, no delivery items, no PO items
  15. Otherwise: force archive instead
  16. Admin-only action, requires confirmation
```

---

## 13. Recommended Target Receiving Workflow

```
1. Barcode-first input: scan → auto-fill from catalog → show existing stock/cost
2. Unknown barcode: suggest create with minimal fields (name, price, cost)
3. Batch receive mode: scan multiple items → review list → save all at once
4. PO link: select open PO → auto-fill items from PO lines → mark as received
5. Supplier defaults: remember last supplier, PO number, cost margin
6. Label print: checkbox "Print labels" → auto-calculate quantity per item
7. Validation per row: red border on invalid fields, inline error messages
8. Batch save with rollback: all-or-nothing write with transaction simulation
```

---

## 14. Recommended Target Lots Workflow

```
1. Lots view: table with batch number, product, quantity, cost, expiry, supplier
2. Auto-expiry: batches marked Expired when past expiryDate
3. Expired lots filtered from consumption
4. Write-off: manual "write off expired" action → adjustment + stock decrement
5. Batch history: click batch → see all allocations (sales, adjustments, refunds)
6. Cost audit: each batch shows unitCost, total acquired value, remaining value
```

---

## 15. Recommended Target Stock Adjustment/Count Workflow

```
1. Quick adjust: select product → enter +/- quantity → reason → save
2. Batch-aware: adjust chooses specific batch or auto-allocates from oldest
3. Stock count session: start → scan/count items → review variances → complete
4. Variance review: shows expected vs counted, positive/negative deltas
5. Complete with audit: creates adjustments for each variance, records movements
6. Rollback safety: count session rolled back if save fails mid-way
```

---

## 16. Recommended Archive/Delete Policy

| Entity | Archive? | Delete? | Condition |
|--------|---------|---------|-----------|
| Product | Yes | Only if 0 sales/refunds/POs | Archive otherwise |
| Customer | Yes | Only if 0 orders/debt | Archive otherwise |
| Supplier | Yes | Only if 0 POs/payments | Archive otherwise |
| Sale | No (void) | Never | Void only — preserves history |
| Refund | No | Never | Linked to sale forever |
| Shift | No (close) | Never | Close only |

---

## 17. Recommended Barcode/Alias Policy

1. Primary barcode: unique per tenant (DB constraint)
2. Aliases: must not match any primary barcode OR any other alias across all products
3. Null barcodes: allowed but products without barcode can only be found by name search
4. Barcode generation: auto-generate when creating product without barcode (50 attempts)
5. Import: validate both primary and alias uniqueness before writing

---

## 18. Recommended Sync/Idempotency Policy

1. **All entities use upsert by ID** — never plain create without ID check
2. **Product without barcode** — must have a synthetic barcode or unique ID for upsert
3. **Server refund** — check if refund ID exists before incrementing stock
4. **Server void** — already idempotent (Voided guard) ✓
5. **Delivery stock** — pass batch allocations in sync operation, use batch consume on server
6. **Receiving** — single-write (receiveProducts only, remove dual-write)

---

## 19. Recommended Test Plan

### Critical Path Tests
- Create product with initial stock → verify batch created
- Sale consumes batch → verify quantityRemaining decreased
- Refund restores batch → verify quantityRemaining increased
- Server refund retry → verify stock increments only once
- Archive product → verify hidden from POS, visible in reports
- Archive survives full re-sync → verify `archived` in DB
- Barcode alias conflict rejected → verify both create + update paths

### Receiving Tests
- Scan existing barcode → verify auto-fill
- Unknown barcode → verify create flow
- PO-linked receive → verify batch gets PO number
- Batch save with partial failure → verify rollback

### Sync Tests
- Product create retry (barcode) → no duplicate
- Product create retry (no barcode) → duplicate with synthetic barcode
- Receiving sync retry → stock increments only once
- Refund sync retry → stock increments only once (FIX REQUIRED)

---

## 20. Exact Phased Implementation Plan

### Phase 1: Data Safety (3 days)
1. Add `archived` column to Product model + migration
2. Add idempotency guard to server refund handler
3. Fix `createProduct` to create batch on initial stock
4. Add `archived` filter to ProductsPage ProductTable
5. Fix receiving dual-write (remove optimistic stock write)
6. Add audit events to product archive/restore

### Phase 2: Receiving UX (3 days)
7. Redesign ProductReceivePage: barcode-first, batch mode, PO link
8. Add per-row validation with inline errors
9. Add batch paste support
10. Add receive defaults persistence (supplier, PO, category)
11. Remove or timeout external barcode API calls
12. Add label print integration

### Phase 3: Lots & Stock Control (2 days)
13. Add batch write-off action
14. Add batch history view (allocations)
15. Add stock count rollback safety
16. Fix refund restore to use FIFO batch selection (match consumption order)

### Phase 4: Sync & Server (2 days)
17. Unify stock movements to server-only
18. Add server refund batch restore
19. Add server void batch restore
20. Fix product sync idempotency for no-barcode products

### Phase 5: Polish & QA (2 days)
21. Full audit of all 13 stock mutation paths
22. End-to-end test: create → receive → sell → refund → verify
23. Archive/re-sync verification
24. Performance: large catalog (1000+ products) search speed

---

## 21. Files Likely Needing Changes

### Schema
- `apps/api/prisma/schema.prisma` — add `archived` to Product

### Desktop Services
- `product.service.ts` — createProduct batch creation, archive/restore audit
- `inventoryBatch.service.ts` — remove dual-write, FIFO restore
- `sales.service.ts` — none (already correct)
- `sync.service.ts` — product pull filtering

### API Routes
- `sync.ts` — refund idempotency, refund batch restore, void batch restore
- `delivery.ts` — batch consumption on delivery

### Desktop Pages
- `ProductsPage.tsx` — archived filter
- `ProductReceivePage.tsx` — full redesign
- `POSPage.tsx` — archived filter (already done)

### Types
- `packages/types/src/product.ts` — already has `archived`

---

## 22. Acceptance Criteria

- [ ] Product created with stock > 0 has a corresponding batch
- [ ] Server refund only increments stock once (retry-safe)
- [ ] Server refund also restores batch quantities
- [ ] Archived products survive full re-sync
- [ ] Archived products hidden from POS + catalog table
- [ ] Receiving barcode-scan auto-fills from catalog
- [ ] Receiving batch-save with failure rolls back all changes
- [ ] Barcode alias collision caught in createProduct + updateProduct
- [ ] All 13 stock mutation paths create StockMovement records
- [ ] All typechecks pass, builds pass, tests pass

---

## 23. Things to Avoid

- Do NOT change how historical profit is calculated (already correct)
- Do NOT change the variant parent/child model
- Do NOT change currency/Decimal handling
- Do NOT add new sync entities without full idempotency
- Do NOT remove `decreaseProductStock` / `increaseProductStock` without updating all 6 callers
- Do NOT touch Midnight Gold design work
- Do NOT change POS checkout logic

---

## 24. Open Questions

1. Should we add a synthetic barcode (auto-generated) for products without barcodes, to prevent sync duplicates?
2. Should StockMovement records be server-only, with desktop pulling them as audit data?
3. Should the receiving page use a modal or a full page?
4. Should batch write-off require a separate permission from stock adjustment?
5. Should we add `updatedAt` to InventoryBatch for conflict resolution?
6. Should the ProductsPage catalog table default to hiding archived products (with a toggle to show)?

# Titan POS — Sync Ownership Model

**Sprint:** POS-SYNC-AUTHORITY-1
**Date:** 2026-07-13
**Status:** enforced in code (this sprint) for inventory; the rest is documented intent to be hardened by revision/mutation model in POS-SYNC-AUTHORITY-2.

---

## Deployment assumption — SINGLE HUB

This model assumes a **single store hub** architecture:

- Exactly **one hub** per store is authoritative for live inventory.
- Connected devices (CONNECT_TO_HUB) **write through the hub** for stock-decrementing sales — they never commit stock locally.
- **Railway is a cloud mirror / backup / dashboard**, NOT the authority for in-store stock.
- All in-store stock mutations (sales, receiving, damage, stock counts, adjustments) originate **at the hub**.

**Consequence / known limitation:** because the hub ignores cloud-supplied inventory quantities for rows it already has (see below), a stock change made *somewhere other than this hub* — a second hub, or an owner editing stock in the Railway web dashboard — will **not** propagate into this hub during normal sync. That is an accepted trade-off for the single-hub model: it is the price of making stock impossible to resurrect from a stale cloud snapshot. Distinguishing a *legitimate* cloud-originated stock edit from a *stale* mirror requires the stock revision/mutation model, which is **POS-SYNC-AUTHORITY-2**.

---

## Ownership table

| Data | Owner | Sync behavior |
|------|-------|---------------|
| **Product metadata** (name, price, cost, category, barcode, unit, image, archived, syncId) | Hub or cloud admin | Bi-directional. Last-writer-by-`updatedAt`. Safe to overwrite. |
| **Product.stock** (aggregate) | **Hub only** | Hub → cloud (push) and cloud → new hubs (bootstrap create). Cloud → **existing** hub row on normal pull: **BLOCKED** (never overwritten). Cloud → existing hub row only on explicit restore *and* no pending local stock ops. |
| **InventoryBatch.quantityRemaining / status** | **Hub only** | Same rule as Product.stock. A new batch is created from cloud; an existing batch is **not** updated from cloud on a normal pull. |
| **InventoryBatch** immutable fields (batchNumber, initialQuantity, unitCost, unitPrice, expiry, supplier, receivedAt) | Hub (set at receive) | Flow in on the create that first brings the batch across; not re-applied to existing rows on normal pull. |
| **Sale / SaleItem / SaleTender** | Append-only, hub-committed | Idempotent by sale UUID. Never mutated after commit. Stock effect applied once at commit. |
| **Refund / Void** | Append-only, hub-committed | Idempotent — a duplicate retry must not double-restore stock. |
| **Receiving / Damage / Adjustment / Stock count** | **Hub** (stock mutation) | Produce hub-owned stock/batch changes. Currently field-synced (not yet event-sourced — AUTHORITY-2). |
| **Settings / registerName** | Device-local | `registerName` is per-device and never synced across devices. |
| **Tenant / license / billing / subscription** | **Railway only** | Cloud → hub read-only. Hub never writes these up. |
| **Staff / permissions / PINs** | Railway or hub admin | Synced; local SHA-256 PINs are preserved across pulls (server stores bcrypt, useless for offline match). |

---

## What POS-SYNC-AUTHORITY-1 enforces in code

1. **`InventoryBatch.updatedAt`** added (`@updatedAt`, additive migration) so batch quantity/status changes have a mutation timestamp.
2. **Incremental pull** (`GET /api/sync/pull?since=`) now filters batches by `receivedAt` **OR** `updatedAt` (was `receivedAt` only), so a batch consumed by a sale is surfaced to other devices — previously stranded until a full pull.
3. **Hub ignores cloud inventory quantities** on normal cloud pull (`cloudSync.ts`):
   - existing product → `stock` stripped from the update patch (metadata still applies);
   - existing batch → update skipped entirely;
   - new product/batch → still created (bootstrap / new item).
4. **Explicit-restore carve-out:** only `triggerFullPull` (operator-initiated "restore from cloud" via `/api/setup/pull-from-cloud`) may overwrite existing hub inventory —
5. **…and only when no local stock ops are pending/failed** (`SyncOperation` with entity in `sale | refund | inventory | product`). Otherwise the restore is downgraded to metadata-only so un-pushed local stock truth is never discarded. Logged clearly when skipped.

## Deferred to POS-SYNC-AUTHORITY-2

- Stock revision counters + a `StockMutation` ledger (sale/refund/void/receive/damage/adjustment/count as append-only events with idempotency keys and source device).
- `Product.stock` / batch totals become a **maintained projection** of accepted events rather than a synced field.
- Conflict resolution that can accept a *legitimate* cloud-originated stock change (multi-hub / dashboard edit) via revision comparison, removing the single-hub limitation above.
- Reconciling the two remaining truths (aggregate `Product.stock` vs sum of open `InventoryBatch.quantityRemaining`) structurally instead of by periodic data fix.

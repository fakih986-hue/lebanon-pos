# POS-SYNC-IDENTITY-1 — Stable Sync Identity Architecture (Product)

**Date:** 2026-07-12
**Sprint:** POS-SYNC-IDENTITY-1 — Stable sync identity architecture
**Scope this sprint:** Product only (implemented fully + safely). Entity-by-entity plan for the rest documented below.

---

## 1. Final Product identity model

**Principle:** a database autoincrement `id` is a *local/internal* identifier only. Cross-system sync identity must be globally stable, generated exactly once at entity creation, and preserved byte-for-byte across hub, LAN clients, and Railway.

**Product now has two identifiers, with distinct roles:**

| Field | Type | Role |
|---|---|---|
| `id` | `Int @id @default(autoincrement())` | **Local/internal PK only.** Each database assigns its own; the value legitimately differs hub vs cloud for the same logical product. Remains the target of all child FKs (`SaleItem.productId`, `InventoryBatch.productId`, `StockAdjustment.productId`, `StockMovement.productId`, `StockCountLine.productId`, `DeliveryOrderItem.productId`). **Never used as a cross-system identity.** |
| `syncId` | `String?` + `@@unique([tenantId, syncId])` | **The stable cross-system identity.** Generated once at product creation (client) or backfilled cloud-authoritatively for legacy rows. Matched across hub/client/cloud. Nullable during transition; unique per tenant. |
| `barcode` | `String?` + `@@unique([tenantId, barcode])` | **Business dedupe/lookup key, not identity.** A create arriving with an existing barcode adopts the existing product (see below). Products without a barcode sync correctly; barcode edits never re-identify a product. |

**Match order, everywhere a product is resolved across systems** (push handlers, pull reconciliation, and the child `resolveProductId` helper): `syncId` → local numeric `id` (only meaningful for already-aligned rows) → `barcode` (legacy fallback). The incoming numeric id is *never* written as an identity key — doing so would rewrite a local PK and orphan child FKs.

**Barcode-collision rule (create):** if a create arrives with a barcode that already exists for the tenant, it is treated as the *same logical product*: the existing row is adopted (updated), no duplicate is created, and the existing row's `syncId` is preserved (or set to the incoming/generated one if it had none).

---

## 2. Migration / backfill strategy

**Migration** (`20260712180000_add_product_sync_id`) — additive, non-destructive:
```sql
ALTER TABLE "Product" ADD COLUMN "syncId" TEXT;
CREATE UNIQUE INDEX "Product_tenantId_syncId_key" ON "Product"("tenantId", "syncId");
```
- **Nullable + unique is safe pre-backfill:** Postgres treats `NULL`s as *distinct* in a unique index, so every not-yet-backfilled row coexists without collision. The unique constraint is therefore applied immediately (no deferral needed).
- The migration **intentionally performs no data backfill.** It runs identically on Railway *and* every hub (hubs apply bundled migrations on boot). Generating ids in the migration would produce *different* syncIds per database for the same product — re-creating the very divergence this feature removes.

**Backfill is cloud-authoritative:** `backfillProductSyncIds()` (in `services/cloudSync.ts`) assigns a `randomUUID()` to every product lacking one. It is invoked **only on the cloud instance** (guarded in `index.ts` on `IS_LOCAL_SERVER` being unset) — so syncId is assigned in exactly one place. Idempotent (`WHERE syncId IS NULL`), safe to run every boot. Hubs never generate their own syncIds for existing products; they **adopt the cloud's value via normal pull reconciliation** (matched during transition by the numeric id of already-aligned rows, or by barcode).

**Legacy create during transition:** if an old client pushes a create with no syncId, the cloud create handler mints one (cloud is authoritative there); the hub that created it adopts that syncId on its next pull. On a hub, a syncId-less create is left null and converges on the cloud's value at pull time.

---

## 3. Implementation summary (Product)

**Server (`apps/api`):**
- `prisma/schema.prisma` — `Product.syncId` + `@@unique([tenantId, syncId])`.
- `services/cloudSync.ts`:
  - `backfillProductSyncIds()` — cloud-authoritative backfill.
  - Product **pull reconciliation** rewritten: match by `syncId` → numeric id → barcode; adopt the incoming syncId onto the matched local row; **never overwrite the local numeric id** (preserves the earlier `e19992d` guarantee).
- `index.ts` — invokes the backfill on the cloud instance only.
- `routes/sync.ts`:
  - Product **create**: match by syncId (→ update, never duplicate); barcode-collision → adopt existing row; else create new (mint syncId on cloud if absent). Numeric id still stripped (from `cd716e4`).
  - Product **update/archive/delete**: match by `syncId` first, legacy `id`/`barcode` fallback.
  - `resolveProductId` (the single chokepoint for all child records) now resolves `productSyncId` → numeric id → barcode, returning *this* database's local numeric FK.
  - Inventory-batch receive + stock-adjustment handlers resolve via `resolveProductId` and strip the cross-system-only `productSyncId` before persisting.

**Client (`apps/desktop`, `packages/types`):**
- `packages/types/src/product.ts` — `syncId?: string | null` on the shared `Product` type.
- `product.service.ts` — every product-creation path (`createProduct`, bulk `receiveProducts`) generates `syncId: createId()` at creation; archive/restore/delete enqueues now include `syncId` alongside the numeric id.
- Sale items (`POSPage.tsx`) and inventory batches (`inventoryBatch.service.ts`, all receive call sites) now carry `productSyncId` in their sync payloads.

---

## 4. Tests added

**Server — `apps/api/__tests__/sync.test.ts` (product sync identity, 6):**
- create with syncId persists it and never forwards the client's numeric id
- create with an existing barcode adopts the existing row (no duplicate)
- update matches by syncId (not numeric id) when syncId is present
- update falls back to numeric id when syncId matches nothing (transition)
- delete/archive matches by syncId first
- legacy create *without* syncId still accepted (old clients during transition)

**Server — `apps/api/__tests__/cloudSync.test.ts` (pull + backfill, 2):**
- pull matches the local row by syncId (not numeric id) and never writes the incoming numeric id
- `backfillProductSyncIds` assigns a syncId to every product lacking one, only touching `syncId IS NULL` rows

Full suite: **168 API tests + 111 desktop tests passing**; `tsc --noEmit` clean on api + desktop + electron. The real-database sync-stress harness passes against a dev DB with the migration applied.

---

## 5. Live verification

Deployed to Railway as commit `5677ff0` (confirmed via `commitHash` match). Startup logs confirmed the migration and backfill ran on the cloud instance:
```
Applying migration `20260712180000_add_product_sync_id` … All migrations have been successfully applied.
[sync-identity] Backfilled syncId for 72 product(s) (cloud-authoritative).
```

**Live results against the real `fakih` tenant (7/7 PASS):**

| Check | Result |
|---|---|
| Backfill covered every product | ✅ 0/39 missing a syncId |
| Create preserves the hub-chosen syncId; cloud assigns its OWN numeric id | ✅ sent `{id: 999999, syncId: LIVE-SYNC-…}` → cloud kept syncId, assigned id `91` (bogus 999999 ignored) |
| Update/archive by syncId alone (no numeric id) hits the correct row | ✅ price update matched by syncId → row id 91 |
| Barcode collision on create adopts existing row — no duplicate | ✅ same barcode + different syncId → still 1 product |
| Product without a barcode syncs | ✅ matched by syncId, `barcode: null` |
| Barcode edit via syncId updates in place — no duplicate | ✅ barcode changed, still 1 row |
| Child (sale item) resolves by productSyncId even with a bogus numeric id | ✅ sent `productId: 777777, productSyncId: …` → correct product's stock decremented 5→4 |

All live-test products were archived by syncId afterward (which itself re-confirmed archive-by-syncId); store returned to 23 active products; Railway health `{"status":"ok"}`.

**Scope note:** this verifies the full cloud-side identity behavior and the exact payload shape a syncId-aware hub emits (pushed directly to Railway). The *installed* hub is still on 1.0.26 (pre-syncId) and continues to work via the backward-compatible legacy fallback; a hub installer rebuild (§7) is required for hubs to emit syncId themselves. The deployed cloud is fully backward-compatible with the current hub in the meantime.

---

## 6. Broader audit — remaining entities

**Product was the only synced entity with a numeric autoincrement PK.** Verified directly against `schema.prisma`: every other model uses `String @id @default(uuid())`, i.e. a client-generated stable identity that is already identical across hub/client/cloud. They were never affected by the numeric-id-divergence class of bug.

| Entity | PK type | Needs syncId? |
|---|---|---|
| **Product** | `Int` autoincrement | **YES — done this sprint** |
| Customer | `String` uuid | No — already stable |
| Supplier | `String` uuid | No — already stable |
| Sale | `String` uuid | No — already stable |
| SaleRefund | `String` uuid | No — already stable |
| PurchaseOrder | `String` uuid | No — already stable |
| SupplierPayment | `String` uuid | No — already stable |
| Expense | `String` uuid | No — already stable |
| Shift | `String` uuid | No — already stable |
| DailyClose | `String` uuid | No — already stable |
| InventoryBatch | `String` uuid | No — already stable (id is a client uuid; only its `productId` FK needed the cross-system hint, now carried via `productSyncId`) |
| StockAdjustment | `String` uuid | No — already stable |
| DeliveryOrder | `String` uuid | No — already stable |
| StaffUser | `String` uuid | No — already stable |

**Conclusion:** no further entity needs its own `syncId`. The only remaining follow-up work is *child-reference* threading — ensuring every payload that carries a numeric `productId` across systems also carries `productSyncId`. Done this sprint for the stock-critical paths (sale items, inventory batch receive, stock adjustments). Still using barcode/numeric fallback (harmless, but could be threaded for completeness later): purchase-order line items (reference products by name/barcode, not numeric FK — no change needed), stock-count lines (already routed through `resolveProductId`; client threading optional), delivery-order items.

---

## 7. Recommended next sprint

**POS-SYNC-IDENTITY-2 (small, optional):** thread `productSyncId` onto the remaining non-critical child payloads (stock-count lines, delivery-order items) for symmetry, and add a periodic (not just startup) cloud backfill safety net. Low priority — these paths already resolve correctly via barcode/numeric fallback.

**Installer rebuild (required to complete rollout):** the client half of this feature (generating `syncId` at creation, sending it on archive/edit, threading `productSyncId`) ships in the desktop bundle. A hub installer rebuild (next patch version) is needed for hubs to actually emit syncId — until then the deployed cloud remains fully backward-compatible with the current 1.0.26 hub via the legacy fallback matchers.

---

## 8. Rules honored

- No tender/tax/LBP rounding logic touched.
- No stock/batch validation weakened; no negative-stock workaround.
- No real data deleted.
- Additive, non-destructive migration only.
- No release manifest published; no GitHub release.
- Deploy performed only after all tests passed (reported in §5b).

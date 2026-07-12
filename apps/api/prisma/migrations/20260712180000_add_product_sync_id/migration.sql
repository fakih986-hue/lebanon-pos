-- Stable cross-system sync identity for Product (POS-SYNC-IDENTITY-1).
--
-- The numeric autoincrement `id` remains the local/internal primary key and
-- the target of all child FKs (SaleItem.productId, InventoryBatch.productId,
-- StockAdjustment.productId, StockMovement.productId, StockCountLine.productId,
-- DeliveryOrderItem.productId). `syncId` is the globally stable identity used
-- to match a product ACROSS databases — because two independent Postgres
-- instances (hub vs Railway) assign different autoincrement ids to the same
-- logical product, the numeric id cannot be a cross-system identity.
--
-- Additive + nullable + unique is safe to apply before any backfill:
-- Postgres treats NULLs as DISTINCT in a unique index, so every not-yet-
-- backfilled row (all of them, at migration time) coexists without collision.
--
-- IMPORTANT: this migration intentionally does NOT backfill syncId values.
-- It runs identically on Railway AND on every hub, so generating ids here
-- would produce DIFFERENT syncIds per database for the same product —
-- entrenching the very divergence this feature removes. Backfill is
-- cloud-authoritative (see backfillProductSyncIds in services/cloudSync.ts,
-- invoked only on the cloud instance at startup); hubs adopt the cloud's
-- syncId via normal pull reconciliation.

-- AlterTable
ALTER TABLE "Product" ADD COLUMN "syncId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Product_tenantId_syncId_key" ON "Product"("tenantId", "syncId");

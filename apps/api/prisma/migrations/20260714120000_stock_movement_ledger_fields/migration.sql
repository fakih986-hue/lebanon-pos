-- POS-SYNC-AUTHORITY-2A: additive stock-ledger fields (record-only, non-destructive).
-- Nullable source/attribution + batch link on StockMovement, plus a NON-unique
-- lookup/idempotency index. No unique constraint (deferred to a data-verified step).
ALTER TABLE "StockMovement" ADD COLUMN "batchId" TEXT;
ALTER TABLE "StockMovement" ADD COLUMN "deviceId" TEXT;
ALTER TABLE "StockMovement" ADD COLUMN "userId" TEXT;
ALTER TABLE "StockMovement" ADD COLUMN "userName" TEXT;

CREATE INDEX "StockMovement_tenantId_reference_type_productId_idx" ON "StockMovement"("tenantId", "reference", "type", "productId");

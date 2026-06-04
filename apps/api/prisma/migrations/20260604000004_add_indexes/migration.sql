-- Add missing indexes for query performance

CREATE INDEX IF NOT EXISTS "SaleItem_productId_idx"
    ON "SaleItem"("productId");

CREATE INDEX IF NOT EXISTS "SyncOperation_tenantId_entity_status_idx"
    ON "SyncOperation"("tenantId", "entity", "status");

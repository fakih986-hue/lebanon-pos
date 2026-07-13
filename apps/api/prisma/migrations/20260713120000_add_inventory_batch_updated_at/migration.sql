-- POS-SYNC-AUTHORITY-1: add InventoryBatch.updatedAt (additive, non-destructive)
-- Existing rows are backfilled to now(); the DEFAULT is then dropped so Prisma's
-- @updatedAt manages the value on every write (matches the StaffUser.updatedAt
-- convention). This lets incremental sync surface batch quantity/status changes.
ALTER TABLE "InventoryBatch" ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT now();
ALTER TABLE "InventoryBatch" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- Index for the incremental pull filter (WHERE tenantId AND updatedAt >= since)
CREATE INDEX "InventoryBatch_tenantId_updatedAt_idx" ON "InventoryBatch"("tenantId", "updatedAt");

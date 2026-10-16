-- REFUND-INTEGRITY-1 follow-up: display numbers are references, not identities.
-- Refund, stock-adjustment and stock-count numbers are generated offline on
-- each device (adjustments and counts as per-device counters, ADJ-00001 /
-- COUNT-00001 …), so two devices legally
-- produce the same number. The tenant-wide UNIQUE index turned that into a
-- permanent sync failure for a valid refund or adjustment. The immutable
-- operation id (the primary key, a client-generated UUID) remains the identity
-- and the idempotency anchor; the number keeps a plain index for lookups.
-- Dropping a unique index cannot fail on existing data. Rolling back (re-adding
-- the UNIQUE index) fails if duplicates were accepted meanwhile — see
-- docs/STOCK-ACCOUNTING-REVIEW.md.

-- DropIndex
DROP INDEX IF EXISTS "SaleRefund_tenantId_refundNumber_key";

-- DropIndex
DROP INDEX IF EXISTS "StockAdjustment_tenantId_adjustmentNumber_key";

-- DropIndex
DROP INDEX IF EXISTS "StockCountSession_tenantId_countNumber_key";

-- CreateIndex
CREATE INDEX IF NOT EXISTS "SaleRefund_tenantId_refundNumber_idx" ON "SaleRefund"("tenantId", "refundNumber");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "StockAdjustment_tenantId_adjustmentNumber_idx" ON "StockAdjustment"("tenantId", "adjustmentNumber");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "StockCountSession_tenantId_countNumber_idx" ON "StockCountSession"("tenantId", "countNumber");

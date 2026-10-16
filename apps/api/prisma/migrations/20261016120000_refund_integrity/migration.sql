-- REFUND-INTEGRITY-1 (additive only; safe to apply ahead of new clients).
-- * SaleItem gains a stable line identity (lineId) and the lots the server
--   actually consumed (batchAllocations). Existing rows keep lineId NULL and
--   are treated as legacy lines (pooled per product, product-stock-only
--   refunds) — no lot or identity is invented for them.
-- * SaleRefund records the ORIGINAL sale's exchange rate (NULL + rateSource
--   'unavailable' when the sale recorded none).
-- * RefundItem records which sale line was refunded and which lots came back.
-- * Sale.refundVersion is bumped in every refund/void transaction so
--   concurrent refunds of one sale serialize on the row lock.
-- The unique (saleId, lineId) index cannot conflict with existing rows: all
-- existing lineId values are NULL, and NULLs are distinct in Postgres.

-- AlterTable
ALTER TABLE "Sale" ADD COLUMN     "refundVersion" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "SaleItem" ADD COLUMN     "batchAllocations" JSONB,
ADD COLUMN     "lineId" TEXT,
ADD COLUMN     "lineIndex" INTEGER;

-- AlterTable
ALTER TABLE "SaleRefund" ADD COLUMN     "exchangeRate" DECIMAL(18,4),
ADD COLUMN     "rateSource" TEXT;

-- AlterTable
ALTER TABLE "RefundItem" ADD COLUMN     "batchAllocations" JSONB,
ADD COLUMN     "saleLineId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "SaleItem_saleId_lineId_key" ON "SaleItem"("saleId", "lineId");


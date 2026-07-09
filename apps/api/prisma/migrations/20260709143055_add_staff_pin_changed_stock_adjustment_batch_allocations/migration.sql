-- AlterTable
ALTER TABLE "StaffUser" ADD COLUMN     "pinChanged" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "StockAdjustment" ADD COLUMN     "batchAllocations" JSONB;

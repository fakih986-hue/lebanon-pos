-- Operational readiness: authoritative attribution on business records (lib/attribution.ts). Additive only:
-- existing rows keep NULL (never upgraded to authenticated after the fact).
ALTER TABLE "Sale" ADD COLUMN "voidedById" TEXT, ADD COLUMN "voidedByName" TEXT, ADD COLUMN "voidedAt" TIMESTAMP(3), ADD COLUMN "voidAttribution" JSONB, ADD COLUMN "attribution" JSONB;
ALTER TABLE "SaleRefund" ADD COLUMN "attribution" JSONB;
ALTER TABLE "Expense" ADD COLUMN "attribution" JSONB;
ALTER TABLE "CashMovement" ADD COLUMN "attribution" JSONB;
ALTER TABLE "InventoryBatch" ADD COLUMN "receivedById" TEXT, ADD COLUMN "receivedByName" TEXT, ADD COLUMN "attribution" JSONB;
ALTER TABLE "StockAdjustment" ADD COLUMN "createdById" TEXT, ADD COLUMN "createdByName" TEXT, ADD COLUMN "attribution" JSONB;
ALTER TABLE "StockCountSession" ADD COLUMN "completedById" TEXT, ADD COLUMN "completedByName" TEXT, ADD COLUMN "attribution" JSONB;
ALTER TABLE "SupplierPayment" ADD COLUMN "recordedById" TEXT, ADD COLUMN "attribution" JSONB;
ALTER TABLE "PurchaseOrder" ADD COLUMN "createdById" TEXT, ADD COLUMN "attribution" JSONB;
ALTER TABLE "DebtSale" ADD COLUMN "recordedById" TEXT, ADD COLUMN "recordedByName" TEXT, ADD COLUMN "attribution" JSONB;
ALTER TABLE "DebtPayment" ADD COLUMN "recordedById" TEXT, ADD COLUMN "recordedByName" TEXT, ADD COLUMN "attribution" JSONB;
ALTER TABLE "Shift" ADD COLUMN "openAttribution" JSONB, ADD COLUMN "closeAttribution" JSONB;
ALTER TABLE "DailyClose" ADD COLUMN "closedById" TEXT, ADD COLUMN "attribution" JSONB;
ALTER TABLE "OperationEvidence" ADD COLUMN "attribution" JSONB;

-- SPRINT-1: authoritative sale-time stock policy.
-- Product.stockPolicyVersion increases on every policy change; a sale line carries the version it
-- was sold under. A line whose sale-time policy differs from the product's at sync time (or whose
-- policy cannot be established) is flagged in SaleItem.stockPolicyConflict and audited.
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "stockPolicyVersion" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "stockPolicyChangedAt" TIMESTAMP(3);
ALTER TABLE "SaleItem" ADD COLUMN IF NOT EXISTS "stockPolicyConflict" TEXT;

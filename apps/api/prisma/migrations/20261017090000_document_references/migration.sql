-- RELEASE BLOCKER: document references are display references, not identities.
--
-- Sale, shift, expense and purchase-order numbers are generated offline on
-- each device. A tenant can legitimately end up with two records sharing one
-- (docs/evidence/reference-collisions.cjs), and the tenant-wide UNIQUE index
-- turned that into a permanent sync failure for the second, legitimate record.
-- Record ids (client-generated UUIDs, the primary keys) are the identity.
--
-- Order matters:
-- 1. DebtSale gains saleId, the immutable link to its sale. It used to be
--    linked only by saleNumber.
-- 2. Backfill saleId WHILE (tenantId, saleNumber) is still unique, so each
--    debt resolves to at most one sale. The customer must match too; a debt
--    whose sale cannot be identified keeps saleId NULL and the code treats it
--    conservatively (DebtSale fallbacks in routes/sync.ts).
-- 3. Only then drop the UNIQUE indexes, keeping plain indexes for lookups and
--    search. Historical numbers are not changed.
-- Every statement is additive or idempotent; dropping a unique index cannot
-- fail on existing data. Rollback limits: docs/STOCK-ACCOUNTING-REVIEW.md R7.

-- 1. AlterTable
ALTER TABLE "DebtSale" ADD COLUMN IF NOT EXISTS "saleId" TEXT;

-- 2. Backfill (unambiguous while the unique index still exists)
UPDATE "DebtSale" d
SET "saleId" = s."id"
FROM "Sale" s
WHERE d."saleId" IS NULL
  AND s."tenantId" = d."tenantId"
  AND s."saleNumber" = d."saleNumber"
  AND s."customerId" = d."customerId";

-- CreateIndex
CREATE INDEX IF NOT EXISTS "DebtSale_tenantId_saleId_idx" ON "DebtSale"("tenantId", "saleId");

-- 3. DropIndex / CreateIndex
DROP INDEX IF EXISTS "Sale_tenantId_saleNumber_key";
CREATE INDEX IF NOT EXISTS "Sale_tenantId_saleNumber_idx" ON "Sale"("tenantId", "saleNumber");

DROP INDEX IF EXISTS "Shift_tenantId_shiftNumber_key";
CREATE INDEX IF NOT EXISTS "Shift_tenantId_shiftNumber_idx" ON "Shift"("tenantId", "shiftNumber");

DROP INDEX IF EXISTS "Expense_tenantId_expenseNumber_key";
CREATE INDEX IF NOT EXISTS "Expense_tenantId_expenseNumber_idx" ON "Expense"("tenantId", "expenseNumber");

DROP INDEX IF EXISTS "PurchaseOrder_tenantId_poNumber_key";
CREATE INDEX IF NOT EXISTS "PurchaseOrder_tenantId_poNumber_idx" ON "PurchaseOrder"("tenantId", "poNumber");

-- SPRINT-2 (staff-auth batch): an approval may cover several permissions; a date may have several
-- daily closes (one per register and shift), and a correction is a linked revision (the corrected
-- close is kept). Additive: existing closes become scope "store", revision 1.
ALTER TABLE "ManagerApproval" ADD COLUMN "permissions" TEXT[] DEFAULT ARRAY[]::TEXT[];

ALTER TABLE "DailyClose" ADD COLUMN "scope" TEXT NOT NULL DEFAULT 'store',
ADD COLUMN "registerId" TEXT,
ADD COLUMN "shiftId" TEXT,
ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN "revisionOf" TEXT,
ADD COLUMN "correction" TEXT,
ADD COLUMN "supersededById" TEXT,
ADD COLUMN "supersededAt" TIMESTAMP(3);

DROP INDEX "DailyClose_tenantId_dateKey_key";
CREATE UNIQUE INDEX "DailyClose_tenantId_dateKey_scope_revision_key" ON "DailyClose"("tenantId", "dateKey", "scope", "revision");
CREATE INDEX "DailyClose_tenantId_dateKey_idx" ON "DailyClose"("tenantId", "dateKey");

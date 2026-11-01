-- SPRINT-2 F: held evidence kept with refused work, and recorded review decisions.
ALTER TABLE "SyncOperation" ADD COLUMN "heldEvidence" JSONB;
CREATE TABLE "ReviewResolution" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "opId" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "decision" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "reviewerId" TEXT NOT NULL,
    "reviewerName" TEXT NOT NULL,
    "note" TEXT NOT NULL,
    "previewToken" TEXT NOT NULL,
    "originalReason" TEXT,
    "originalEvidence" JSONB,
    "money" JSONB,
    "applyResult" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ReviewResolution_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ReviewResolution_opId_key" ON "ReviewResolution"("opId");
CREATE INDEX "ReviewResolution_tenantId_createdAt_idx" ON "ReviewResolution"("tenantId", "createdAt");

-- SPRINT-2 E: online manager approvals and the approval checked with each operation.
CREATE TABLE "ManagerApproval" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "recordId" TEXT NOT NULL,
    "materialDigest" TEXT NOT NULL,
    "material" JSONB NOT NULL,
    "permission" TEXT NOT NULL,
    "approverId" TEXT NOT NULL,
    "approverName" TEXT NOT NULL,
    "requestedById" TEXT,
    "sessionChecked" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "usedByOpId" TEXT,
    "cancelledAt" TIMESTAMP(3),
    CONSTRAINT "ManagerApproval_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ManagerApproval_tenantId_deviceId_idx" ON "ManagerApproval"("tenantId", "deviceId");
CREATE INDEX "ManagerApproval_tenantId_recordId_idx" ON "ManagerApproval"("tenantId", "recordId");
ALTER TABLE "OperationEvidence" ADD COLUMN "approval" JSONB;

-- SPRINT-2 D: enrolled hub signing keys and the attestation check on relayed evidence.
CREATE TABLE "HubKey" (
    "kid" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "publicPem" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "enrolledById" TEXT NOT NULL,
    "enrolledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rotatedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "revokedById" TEXT,
    "revokeNote" TEXT,
    CONSTRAINT "HubKey_pkey" PRIMARY KEY ("kid")
);
CREATE INDEX "HubKey_tenantId_status_idx" ON "HubKey"("tenantId", "status");
ALTER TABLE "OperationEvidence" ADD COLUMN "attestation" TEXT, ADD COLUMN "attestationKid" TEXT;

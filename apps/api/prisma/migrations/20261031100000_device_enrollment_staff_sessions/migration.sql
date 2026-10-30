-- SPRINT-2 Phase C (observe mode): device enrollment credentials and per-staff sessions.
-- Additive only; existing devices are unenrolled (credentialVersion 0, enrolledAt NULL).
ALTER TABLE "Device" ADD COLUMN IF NOT EXISTS "credentialVersion" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Device" ADD COLUMN IF NOT EXISTS "enrolledAt" TIMESTAMP(3);
ALTER TABLE "Device" ADD COLUMN IF NOT EXISTS "enrolledById" TEXT;
ALTER TABLE "PairingCode" ADD COLUMN IF NOT EXISTS "createdById" TEXT;

CREATE TABLE IF NOT EXISTS "StaffSession" (
  "id"        TEXT NOT NULL,
  "tenantId"  TEXT NOT NULL,
  "deviceId"  TEXT NOT NULL,
  "staffId"   TEXT NOT NULL,
  "authTime"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "endedAt"   TIMESTAMP(3),
  "endReason" TEXT,
  CONSTRAINT "StaffSession_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "StaffSession_tenantId_deviceId_idx" ON "StaffSession"("tenantId", "deviceId");
CREATE INDEX IF NOT EXISTS "StaffSession_tenantId_staffId_idx" ON "StaffSession"("tenantId", "staffId");

ALTER TABLE "OperationEvidence" ADD COLUMN IF NOT EXISTS "enrolledDeviceId" TEXT;
ALTER TABLE "OperationEvidence" ADD COLUMN IF NOT EXISTS "deviceCheck" TEXT;
ALTER TABLE "OperationEvidence" ADD COLUMN IF NOT EXISTS "sessionId" TEXT;
ALTER TABLE "OperationEvidence" ADD COLUMN IF NOT EXISTS "sessionStaffId" TEXT;
ALTER TABLE "OperationEvidence" ADD COLUMN IF NOT EXISTS "sessionAuthTime" TIMESTAMP(3);
ALTER TABLE "OperationEvidence" ADD COLUMN IF NOT EXISTS "sessionCheck" TEXT;
ALTER TABLE "OperationEvidence" ADD COLUMN IF NOT EXISTS "relayed" JSONB;

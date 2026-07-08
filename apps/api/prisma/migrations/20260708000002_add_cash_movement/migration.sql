-- CreateTable
CREATE TABLE "CashMovement" (
    "id"              TEXT NOT NULL,
    "tenantId"        TEXT NOT NULL,
    "shiftId"         TEXT,
    "shiftNumber"     TEXT,
    "type"            TEXT NOT NULL,
    "direction"       TEXT NOT NULL DEFAULT 'Out',
    "amountUsd"       DECIMAL(18,4) NOT NULL,
    "reason"          TEXT NOT NULL,
    "note"            TEXT NOT NULL DEFAULT '',
    "referenceEntity" TEXT,
    "referenceId"     TEXT,
    "recordedById"    TEXT,
    "recordedByName"  TEXT NOT NULL,
    "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CashMovement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CashMovement_tenantId_createdAt_idx" ON "CashMovement"("tenantId", "createdAt");
CREATE INDEX "CashMovement_tenantId_shiftId_idx" ON "CashMovement"("tenantId", "shiftId");
CREATE INDEX "CashMovement_tenantId_type_idx" ON "CashMovement"("tenantId", "type");

-- AddForeignKey
ALTER TABLE "CashMovement" ADD CONSTRAINT "CashMovement_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

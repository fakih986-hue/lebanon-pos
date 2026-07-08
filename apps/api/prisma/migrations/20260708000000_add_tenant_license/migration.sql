-- AlterTable — adds license/suspension fields for offline-first remote control
ALTER TABLE "Tenant" ADD COLUMN     "licenseStatus"     TEXT    NOT NULL DEFAULT 'active';
ALTER TABLE "Tenant" ADD COLUMN     "licenseReason"     TEXT    NOT NULL DEFAULT '';
ALTER TABLE "Tenant" ADD COLUMN     "licenseMessage"    TEXT    NOT NULL DEFAULT '';
ALTER TABLE "Tenant" ADD COLUMN     "suspendedAt"       TIMESTAMP(3);
ALTER TABLE "Tenant" ADD COLUMN     "offlineGraceDays"  INTEGER NOT NULL DEFAULT 7;
ALTER TABLE "Tenant" ADD COLUMN     "leaseExpiresAt"    TIMESTAMP(3);
ALTER TABLE "Tenant" ADD COLUMN     "policyVersion"     INTEGER NOT NULL DEFAULT 1;

-- Update existing suspended tenants to the new license status
UPDATE "Tenant" SET "licenseStatus" = 'suspended' WHERE "suspended" = true;

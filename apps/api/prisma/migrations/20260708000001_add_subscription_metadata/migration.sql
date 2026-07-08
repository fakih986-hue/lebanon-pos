-- AlterTable — adds subscription metadata for SaaS billing
ALTER TABLE "Tenant" ADD COLUMN     "planName"              TEXT    NOT NULL DEFAULT '';
ALTER TABLE "Tenant" ADD COLUMN     "trialStartDate"        TIMESTAMP(3);
ALTER TABLE "Tenant" ADD COLUMN     "trialEndDate"          TIMESTAMP(3);
ALTER TABLE "Tenant" ADD COLUMN     "subscriptionStart"     TIMESTAMP(3);
ALTER TABLE "Tenant" ADD COLUMN     "subscriptionEnd"       TIMESTAMP(3);
ALTER TABLE "Tenant" ADD COLUMN     "renewalDate"           TIMESTAMP(3);
ALTER TABLE "Tenant" ADD COLUMN     "billingContact"        TEXT    NOT NULL DEFAULT '';
ALTER TABLE "Tenant" ADD COLUMN     "internalNotes"         TEXT    NOT NULL DEFAULT '';

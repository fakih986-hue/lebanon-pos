-- Additive schema fixes for fields the desktop client already syncs but the
-- Prisma schema was missing, which caused every sync of these entities to
-- fail with a Prisma "Unknown argument" error (found by the 2026-07-11 QA audit).

-- AlterTable
ALTER TABLE "AppSettings" ADD COLUMN "profitPercent1" DECIMAL(6,2) NOT NULL DEFAULT 25;
ALTER TABLE "AppSettings" ADD COLUMN "profitPercent2" DECIMAL(6,2) NOT NULL DEFAULT 35;

-- AlterTable
ALTER TABLE "DailyClose" ADD COLUMN "unsyncedCountAtClose" INTEGER;

-- AlterTable
ALTER TABLE "Customer" ADD COLUMN "archived" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Supplier" ADD COLUMN "archived" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Sale" ADD COLUMN     "soldAtCost" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "StaffUser" ALTER COLUMN "updatedAt" DROP DEFAULT;

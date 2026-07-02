/*
  Warnings:

  - You are about to alter the column `exchangeRate` on the `SaleTender` table. The data in that column could be lost. The data in that column will be cast from `DoublePrecision` to `Decimal(18,4)`.

*/
-- DropForeignKey
ALTER TABLE "SaleRefund" DROP CONSTRAINT "SaleRefund_saleId_fkey";

-- AlterTable
ALTER TABLE "SaleTender" ALTER COLUMN "exchangeRate" SET DATA TYPE DECIMAL(18,4);

-- AddForeignKey
ALTER TABLE "SaleRefund" ADD CONSTRAINT "SaleRefund_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "Sale"("id") ON DELETE CASCADE ON UPDATE CASCADE;

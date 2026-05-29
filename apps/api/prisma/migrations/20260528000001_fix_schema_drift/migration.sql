-- AlterEnum - add Driver value for delivery driver role
ALTER TYPE "UserRole" ADD VALUE 'Driver';

-- AlterTable - add code column to StaffUser for employee identification
ALTER TABLE "StaffUser" ADD COLUMN "code" TEXT NOT NULL DEFAULT '';

-- CreateIndex - add tenantId+code index for StaffUser
CREATE INDEX "StaffUser_tenantId_code_idx" ON "StaffUser"("tenantId", "code");

-- AlterTable - add delivery configuration fields to AppSettings
ALTER TABLE "AppSettings" ADD COLUMN "deliveryFee" DOUBLE PRECISION NOT NULL DEFAULT 2.0;
ALTER TABLE "AppSettings" ADD COLUMN "whatsAppAdmin" TEXT NOT NULL DEFAULT '';
ALTER TABLE "AppSettings" ADD COLUMN "whatsAppDriverEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "AppSettings" ADD COLUMN "assignMode" TEXT NOT NULL DEFAULT 'manual';
ALTER TABLE "AppSettings" ADD COLUMN "assignTimeout" INTEGER NOT NULL DEFAULT 5;
ALTER TABLE "AppSettings" ADD COLUMN "defaultDriverId" TEXT NOT NULL DEFAULT '';

-- AlterTable - add pin to Customer for customer-facing authentication
ALTER TABLE "Customer" ADD COLUMN "pin" TEXT NOT NULL DEFAULT '';

-- AlterTable - add driver assignment fields to DeliveryOrder
ALTER TABLE "DeliveryOrder" ADD COLUMN "driverId" TEXT;
ALTER TABLE "DeliveryOrder" ADD COLUMN "driverAssignedAt" TIMESTAMP(3);

-- AddForeignKey - link DeliveryOrder.driverId to StaffUser
ALTER TABLE "DeliveryOrder" ADD CONSTRAINT "DeliveryOrder_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "StaffUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey - link DeliveryOrder.customerId to Customer
ALTER TABLE "DeliveryOrder" ADD CONSTRAINT "DeliveryOrder_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

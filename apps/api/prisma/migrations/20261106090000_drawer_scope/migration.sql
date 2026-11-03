-- Batch 83: which register opened a shift, and the store's explicit drawer scope.
-- Additive and nullable: existing rows keep NULL (unknown register; drawer scope not chosen).
ALTER TABLE "Shift" ADD COLUMN "deviceId" TEXT;
ALTER TABLE "Shift" ADD COLUMN "deviceName" TEXT;
ALTER TABLE "AppSettings" ADD COLUMN "drawerScope" TEXT;

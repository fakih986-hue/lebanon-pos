-- Add wholesale pricing support
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "wholesalePrice" DECIMAL(18,4);
ALTER TABLE "Customer" ADD COLUMN IF NOT EXISTS "isWholesale" BOOLEAN NOT NULL DEFAULT false;

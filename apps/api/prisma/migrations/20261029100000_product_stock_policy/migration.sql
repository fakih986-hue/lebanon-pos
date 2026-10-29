-- SPRINT-1: optional barcodes and untracked (made-to-order) products.
-- Existing products stay "tracked": mini-market stores behave exactly as before.
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "stockPolicy" TEXT NOT NULL DEFAULT 'tracked';
ALTER TABLE "SaleItem" ADD COLUMN IF NOT EXISTS "stockPolicy" TEXT NOT NULL DEFAULT 'tracked';

-- A blank barcode is "no barcode": store NULL so any number of products can have none
-- (the unique (tenantId, barcode) index allows many NULLs, but only one '').
UPDATE "Product" SET "barcode" = NULL WHERE "barcode" IS NOT NULL AND btrim("barcode") = '';

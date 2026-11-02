-- Release batch: stable product ids recorded with each operation by the first server that knew the products
-- (additive; older servers ignore the column).
ALTER TABLE "SyncOperation" ADD COLUMN "productRefs" JSONB;

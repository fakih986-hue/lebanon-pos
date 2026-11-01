-- Cafe batch: modifier groups, recipe revisions, ingredient units, sale-line snapshots (all additive; existing rows
-- keep their behaviour: products stay sellable with unit stock and no groups; old sale lines keep NULL snapshots).

ALTER TABLE "Product" ADD COLUMN "sellable" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Product" ADD COLUMN "stockUnit" TEXT NOT NULL DEFAULT 'unit';
ALTER TABLE "Product" ADD COLUMN "purchaseUnit" TEXT;
ALTER TABLE "Product" ADD COLUMN "unitsPerPurchase" DECIMAL(18,4);
ALTER TABLE "Product" ADD COLUMN "modifierGroupIds" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "Product" ADD COLUMN "recipeRev" TEXT;

ALTER TABLE "SaleItem" ADD COLUMN "modifiers" JSONB;
ALTER TABLE "SaleItem" ADD COLUMN "note" TEXT;
ALTER TABLE "SaleItem" ADD COLUMN "basePrice" DECIMAL(18,4);
ALTER TABLE "SaleItem" ADD COLUMN "recipeRev" TEXT;
ALTER TABLE "SaleItem" ADD COLUMN "consumption" JSONB;
ALTER TABLE "SaleItem" ADD COLUMN "costStatus" TEXT;
ALTER TABLE "SaleItem" ADD COLUMN "recipeConflict" TEXT;
ALTER TABLE "SaleItem" ADD COLUMN "modifierConflict" TEXT;

ALTER TABLE "InventoryBatch" ADD COLUMN "purchaseUnit" TEXT;
ALTER TABLE "InventoryBatch" ADD COLUMN "purchaseQuantity" DECIMAL(18,4);
ALTER TABLE "InventoryBatch" ADD COLUMN "unitsPerPurchase" DECIMAL(18,4);
ALTER TABLE "InventoryBatch" ADD COLUMN "purchasePrice" DECIMAL(18,4);
ALTER TABLE "InventoryBatch" ADD COLUMN "supplierReference" TEXT;

ALTER TABLE "StockAdjustment" ADD COLUMN "wasteRef" TEXT;
ALTER TABLE "StockAdjustment" ADD COLUMN "wasteOf" TEXT;

CREATE TABLE "ModifierGroup" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameAr" TEXT NOT NULL DEFAULT '',
    "required" BOOLEAN NOT NULL DEFAULT false,
    "minSelect" INTEGER NOT NULL DEFAULT 0,
    "maxSelect" INTEGER NOT NULL DEFAULT 1,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "options" JSONB NOT NULL DEFAULT '[]',
    "revision" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ModifierGroup_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ModifierGroup_tenantId_updatedAt_idx" ON "ModifierGroup"("tenantId", "updatedAt");

CREATE TABLE "RecipeRevision" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "productSyncId" TEXT NOT NULL,
    "yield" INTEGER NOT NULL DEFAULT 1,
    "lines" JSONB NOT NULL DEFAULT '[]',
    "note" TEXT NOT NULL DEFAULT '',
    "parentRev" TEXT,
    "createdById" TEXT,
    "createdByName" TEXT,
    "attribution" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RecipeRevision_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "RecipeRevision_tenantId_productSyncId_idx" ON "RecipeRevision"("tenantId", "productSyncId");
CREATE INDEX "RecipeRevision_tenantId_createdAt_idx" ON "RecipeRevision"("tenantId", "createdAt");

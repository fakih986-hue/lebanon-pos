-- Phase 0: Add PurchaseOrderItem table + unique constraint on StaffUser.mobile

-- PurchaseOrderItem: stores PO line items that were previously stripped during sync
CREATE TABLE "PurchaseOrderItem" (
    "id"              TEXT NOT NULL,
    "tenantId"        TEXT NOT NULL,
    "purchaseOrderId" TEXT NOT NULL,
    "productName"     TEXT NOT NULL,
    "barcode"         TEXT NOT NULL DEFAULT '',
    "quantity"        DOUBLE PRECISION NOT NULL,
    "unitCost"        DOUBLE PRECISION NOT NULL DEFAULT 0,
    "unitPrice"       DOUBLE PRECISION NOT NULL DEFAULT 0,
    "total"           DOUBLE PRECISION NOT NULL,

    CONSTRAINT "PurchaseOrderItem_pkey" PRIMARY KEY ("id")
);

-- Foreign keys
ALTER TABLE "PurchaseOrderItem"
    ADD CONSTRAINT "PurchaseOrderItem_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PurchaseOrderItem"
    ADD CONSTRAINT "PurchaseOrderItem_purchaseOrderId_fkey"
    FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Index for lookup by PO
CREATE INDEX "PurchaseOrderItem_tenantId_purchaseOrderId_idx"
    ON "PurchaseOrderItem"("tenantId", "purchaseOrderId");

-- Unique mobile per tenant (prevents login ambiguity)
-- NOTE: Will fail if duplicate mobiles already exist — clean those up first if needed
CREATE UNIQUE INDEX "StaffUser_tenantId_mobile_key"
    ON "StaffUser"("tenantId", "mobile");

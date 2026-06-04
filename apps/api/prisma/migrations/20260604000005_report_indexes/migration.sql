-- Add compound indexes for common report queries

CREATE INDEX IF NOT EXISTS "Sale_tenantId_status_createdAt_idx"
    ON "Sale"("tenantId", "status", "createdAt");

CREATE INDEX IF NOT EXISTS "Shift_tenantId_status_idx"
    ON "Shift"("tenantId", "status");

CREATE INDEX IF NOT EXISTS "Expense_tenantId_createdAt_idx"
    ON "Expense"("tenantId", "createdAt");

CREATE INDEX IF NOT EXISTS "DebtSale_tenantId_createdAt_idx"
    ON "DebtSale"("tenantId", "createdAt");

CREATE INDEX IF NOT EXISTS "DebtPayment_tenantId_createdAt_idx"
    ON "DebtPayment"("tenantId", "createdAt");

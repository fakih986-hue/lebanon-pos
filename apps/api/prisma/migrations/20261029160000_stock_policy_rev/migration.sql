-- SPRINT-1: stock-policy revisions. A policy is identified by a revision id minted once by whoever
-- changes it (till, hub or cloud) and copied everywhere, so one id cannot mean different policies on
-- a hub and the cloud. "initial" = the policy a product was created with (all existing products).
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "stockPolicyRev" TEXT NOT NULL DEFAULT 'initial';
-- The revision a sale line was sold under (NULL for lines recorded before revisions existed; their
-- stockPolicy column already holds the policy that was applied).
ALTER TABLE "SaleItem" ADD COLUMN IF NOT EXISTS "stockPolicyRev" TEXT;

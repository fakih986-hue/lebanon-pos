-- SPRINT-1: server-owned history of each product's stock policy, one entry per version:
-- [{"version":1,"policy":"tracked","from":null},{"version":2,"policy":"untracked","from":"<ISO time>"}]
-- Sale lines name the version they were sold under; the server reads that version's policy from here.
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "stockPolicyHistory" JSONB NOT NULL DEFAULT '[]';

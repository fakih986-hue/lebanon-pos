-- SPRINT-2: per-store staff identity enforcement. Every existing store stays in observe mode.
ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "staffSessionMode" TEXT NOT NULL DEFAULT 'observe';

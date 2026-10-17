-- SYNC-DEDUPE-2: "applied on this server" is recorded separately from onward delivery.
-- status keeps its meaning for the cloud sync bridge (Pending = to forward, Synced = forwarded).
ALTER TABLE "SyncOperation" ADD COLUMN "appliedAt" TIMESTAMP(3);

-- Backfill: rows that reached Pending or Synced were applied by the push handler (it wrote
-- Pending in the transaction that applied them). Failed/Rejected rows are left NULL on purpose:
-- they mix processing failures with forwarding failures of applied operations, and marking a
-- never-applied operation as applied would make its retry be acknowledged without effect.
UPDATE "SyncOperation"
SET "appliedAt" = COALESCE("lastAttemptAt", "syncedAt", "createdAt")
WHERE "status" IN ('Pending', 'Synced');

-- SPRINT-1: store-wide upgrade gate. Every sync push records its client (a till by device id, a hub
-- bridge by "hub-bridge@<schema>") with its sync schema; stock-policy changes are refused while a
-- client older than schema 3 has traded recently and has not been retired by the owner.
CREATE TABLE IF NOT EXISTS "SyncClient" (
  "id"          TEXT NOT NULL,
  "tenantId"    TEXT NOT NULL,
  "clientKey"   TEXT NOT NULL,
  "label"       TEXT NOT NULL DEFAULT '',
  "syncSchema"  INTEGER NOT NULL DEFAULT 1,
  "lastSeenAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "retiredAt"   TIMESTAMP(3),
  "retiredBy"   TEXT,
  "retiredNote" TEXT,
  CONSTRAINT "SyncClient_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "SyncClient_tenantId_clientKey_key" ON "SyncClient"("tenantId", "clientKey");
CREATE INDEX IF NOT EXISTS "SyncClient_tenantId_syncSchema_lastSeenAt_idx" ON "SyncClient"("tenantId", "syncSchema", "lastSeenAt");

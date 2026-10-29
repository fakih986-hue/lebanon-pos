-- SPRINT-2 Phase B (observe mode): what the receiving server knows about each applied operation.
-- Written by the server only; nothing here is copied from the client unless the column says "claimed".
CREATE TABLE IF NOT EXISTS "OperationEvidence" (
  "opId"                TEXT NOT NULL,
  "tenantId"            TEXT NOT NULL,
  "entity"              TEXT NOT NULL,
  "action"              TEXT NOT NULL,
  "receivedAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "acceptedBy"          TEXT NOT NULL,           -- "cloud" | "hub": the server that applied it
  "transport"           TEXT NOT NULL,           -- "https" | "http-lan" | "localhost" | "unknown"
  "credentialKind"      TEXT NOT NULL,           -- token kind that pushed it (staff, hub-local, bridge, ...)
  "connectionAccountId" TEXT,                    -- authenticated: the account whose token pushed it
  "deviceIdClaimed"     TEXT,                    -- claimed by the client (not authenticated)
  "actorIdClaimed"      TEXT,                    -- staff id named in the payload (not authenticated)
  "actorNameClaimed"    TEXT,
  "actorMatchesAccount" BOOLEAN,                 -- claimed actor == connecting account (null: unknown)
  "evidence"            TEXT NOT NULL,           -- "verified" | "hub-attested" | "offline-claimed" | "legacy-claimed"
  "limitations"         TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "claimedAt"           TEXT,                    -- client time as sent (claimed)
  "envelopeVersion"     INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "OperationEvidence_pkey" PRIMARY KEY ("opId")
);
CREATE INDEX IF NOT EXISTS "OperationEvidence_tenantId_receivedAt_idx" ON "OperationEvidence"("tenantId", "receivedAt");
CREATE INDEX IF NOT EXISTS "OperationEvidence_tenantId_evidence_idx" ON "OperationEvidence"("tenantId", "evidence");

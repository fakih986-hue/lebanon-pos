-- Store topology (lib/topology.ts): additive; every existing store stays "unset" (no topology rule applies).
ALTER TABLE "Tenant" ADD COLUMN "storeTopology" TEXT NOT NULL DEFAULT 'unset';
ALTER TABLE "Tenant" ADD COLUMN "topologyHubId" TEXT;
ALTER TABLE "Tenant" ADD COLUMN "topologyVersion" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Tenant" ADD COLUMN "topologyChangedAt" TIMESTAMP(3);
ALTER TABLE "Tenant" ADD COLUMN "topologyChangedBy" TEXT;

ALTER TABLE "HubKey" ADD COLUMN "hubId" TEXT;
ALTER TABLE "HubKey" ADD COLUMN "hubLabel" TEXT NOT NULL DEFAULT '';
ALTER TABLE "HubKey" ADD COLUMN "lastReport" JSONB;
ALTER TABLE "HubKey" ADD COLUMN "lastReportAt" TIMESTAMP(3);

ALTER TABLE "SyncClient" ADD COLUMN "queueReport" JSONB;
ALTER TABLE "SyncClient" ADD COLUMN "queueReportedAt" TIMESTAMP(3);

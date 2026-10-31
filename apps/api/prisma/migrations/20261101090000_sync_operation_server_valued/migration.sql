-- An operation applied under server valuation (1.0.52+): a hub forwards it with ev.valued = "server".
ALTER TABLE "SyncOperation" ADD COLUMN "serverValued" BOOLEAN NOT NULL DEFAULT false;

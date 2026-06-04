-- Persist rate limit state across server restarts
CREATE TABLE "RateLimitEntry" (
    "id"      TEXT NOT NULL,
    "bucket"  TEXT NOT NULL,
    "key"     TEXT NOT NULL,
    "count"   INTEGER NOT NULL DEFAULT 1,
    "resetAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RateLimitEntry_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "RateLimitEntry_bucket_key_key"
    ON "RateLimitEntry"("bucket", "key");

CREATE INDEX "RateLimitEntry_resetAt_idx"
    ON "RateLimitEntry"("resetAt");

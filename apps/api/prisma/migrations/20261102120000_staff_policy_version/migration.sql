-- SPRINT-2 hub batch: the staff policy's version, issued at the cloud and adopted by hubs only when higher.
ALTER TABLE "Tenant" ADD COLUMN "staffPolicyVersion" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "staffPolicyIssuedAt" TIMESTAMP(3),
ADD COLUMN "staffPolicyIssuedBy" TEXT;

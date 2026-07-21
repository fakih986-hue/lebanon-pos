-- POS-PERMISSIONS-1: per-user permission set on StaffUser.
-- Additive + non-destructive. Empty array → server/client fall back to the role
-- preset, so existing users keep their access with no data change.
ALTER TABLE "StaffUser" ADD COLUMN "permissions" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

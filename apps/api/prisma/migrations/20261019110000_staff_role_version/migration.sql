-- Version of a staff member's access (role, permissions, active), bumped by the server on every
-- change. A staff update made on an older copy of the record cannot change access.
ALTER TABLE "StaffUser" ADD COLUMN IF NOT EXISTS "roleVersion" INTEGER NOT NULL DEFAULT 1;

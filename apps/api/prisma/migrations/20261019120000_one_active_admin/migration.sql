-- One active admin per store (tenant), enforced by the database so concurrent writes and every
-- write path (cloud and hub) obey it.
--
-- Heal first. A database may already hold several active admins (a hub that has not pulled the
-- cloud's change yet). This is a FALLBACK, not the owner's choice: the earliest-created admin stays
-- Admin, the others become Manager (login, PIN and history unchanged), their access version and
-- token version are bumped (old sessions and older copies of their record cannot restore the
-- privilege), and each demotion is recorded in the audit log. On a hub, the first pull after the
-- upgrade is a full one and applies the cloud's admin (cloudSync, staffRefresh 2).
DROP TABLE IF EXISTS "_auto_demoted";
CREATE TEMP TABLE "_auto_demoted" AS
SELECT s."id", s."tenantId", s."name"
FROM (
  SELECT "id", "tenantId", "name",
         row_number() OVER (PARTITION BY "tenantId" ORDER BY "createdAt", "id") AS rn
  FROM "StaffUser"
  WHERE "role" = 'Admin' AND "active" = true
) s
WHERE s.rn > 1;

UPDATE "StaffUser" u
SET "role" = 'Manager',
    "roleVersion" = u."roleVersion" + 1,
    "tokenVersion" = u."tokenVersion" + 1,
    "updatedAt" = now()
FROM "_auto_demoted" d
WHERE u."id" = d."id";

INSERT INTO "AuditEvent" ("id", "tenantId", "action", "entity", "summary", "metadata", "userId", "userName", "userRole", "createdAt")
SELECT gen_random_uuid()::text, d."tenantId", 'staff.admin_auto_demoted', 'staff',
       d."name" || ' was changed from Admin to Manager: a store may have only one active admin (automatic, earliest-created admin kept).',
       jsonb_build_object('staffUserId', d."id", 'reason', 'one_active_admin_migration'),
       '__system__', 'System', 'Admin', now()
FROM "_auto_demoted" d;

DROP TABLE "_auto_demoted";

-- Partial unique index (not expressible in schema.prisma; Prisma's schema diff does not report it).
CREATE UNIQUE INDEX IF NOT EXISTS "StaffUser_one_active_admin"
  ON "StaffUser" ("tenantId")
  WHERE "role" = 'Admin' AND "active" = true;

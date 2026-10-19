-- One active admin per store (tenant), enforced by the database so concurrent writes and every
-- write path (cloud and hub) obey it.
--
-- Heal first: a database may already hold several active admins (a hub that has not pulled the
-- cloud's change yet). The earliest-created one stays Admin; the others become Manager (login,
-- PIN and history unchanged). On a hub the next pull from the cloud then applies the cloud's
-- choice. updatedAt is bumped so devices receive the change.
WITH ranked AS (
  SELECT "id", row_number() OVER (PARTITION BY "tenantId" ORDER BY "createdAt", "id") AS rn
  FROM "StaffUser"
  WHERE "role" = 'Admin' AND "active" = true
)
UPDATE "StaffUser" s
SET "role" = 'Manager', "updatedAt" = now()
FROM ranked r
WHERE s."id" = r."id" AND r.rn > 1;

-- Partial unique index (not expressible in schema.prisma; a schema diff reports it as extra).
CREATE UNIQUE INDEX IF NOT EXISTS "StaffUser_one_active_admin"
  ON "StaffUser" ("tenantId")
  WHERE "role" = 'Admin' AND "active" = true;

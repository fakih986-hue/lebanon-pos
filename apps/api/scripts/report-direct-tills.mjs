#!/usr/bin/env node
// READ-ONLY rollout report: which tills of a store talk to the CLOUD DIRECTLY (not through a hub),
// and on which version. Required before enabling café stock policies: every direct-to-cloud till
// must be updated first (the server cannot stop an older direct till from completing a sale; see
// docs/SPRINT-1-CAFE.md "Release conditions").
//
//   DATABASE_URL=<cloud database, read access> node scripts/report-direct-tills.mjs --store <subdomain> [--days 30]
//
// Two sources, both read-only:
//  1. Before the cloud is updated (works on 1.0.50): stock movements recorded by the cloud. A hub
//     forwards as "cloud-bridge" without a device id; a direct till's movements carry its device id
//     and the signed-in staff member. Devices seen here are direct tills (any version).
//  2. After the cloud runs 1.0.51: the upgrade-gate records (SyncClient). "device:*" rows on the
//     cloud are direct tills, with the sync schema they last pushed (< 3 = must be updated).
// It never writes. It does not print credentials.
import prismaPkg from "../src/generated/prisma/index.js"
const { PrismaClient } = prismaPkg

const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, all) => (v.startsWith("--") ? [...a, [v.slice(2), all[i + 1]]] : a), []))
const url = process.env.DATABASE_URL
if (!url || !args.store) { console.error("usage: DATABASE_URL=… node scripts/report-direct-tills.mjs --store <subdomain> [--days 30]"); process.exit(2) }
const days = Math.max(1, Number(args.days ?? 30))

// one connection, switched to read-only before any query
const db = new PrismaClient({ datasourceUrl: url + (url.includes("?") ? "&" : "?") + "connection_limit=1" })
await db.$executeRawUnsafe("SET default_transaction_read_only = on")
const client = { query: async (sql, params = []) => ({ rows: await db.$queryRawUnsafe(sql, ...params) }) }
try {
  const t = (await client.query(`SELECT id, name FROM "Tenant" WHERE subdomain = $1`, [args.store])).rows[0]
  if (!t) { console.error(`no store with subdomain "${args.store}"`); process.exit(1) }
  console.log(`Store: ${t.name} (${args.store}) — last ${days} days\n`)

  const moves = (await client.query(
    `SELECT "deviceId", count(*)::int AS movements, max("createdAt") AS "lastSeen", string_agg(DISTINCT coalesce("userName", ''), ', ') AS staff
       FROM "StockMovement"
      WHERE "tenantId" = $1 AND "deviceId" IS NOT NULL AND coalesce("userId", '') <> 'cloud-bridge'
        AND "createdAt" >= now() - make_interval(days => $2::int)
      GROUP BY "deviceId" ORDER BY max("createdAt") DESC`, [t.id, days])).rows
  console.log("1. Direct-to-cloud tills seen in stock movements (any version):")
  if (moves.length === 0) console.log("   none")
  for (const m of moves) console.log(`   ${m.deviceId}  movements=${m.movements}  last=${new Date(m.lastSeen).toISOString()}  staff=${m.staff || "-"}`)

  const hasGate = (await client.query(`SELECT to_regclass('"SyncClient"') IS NOT NULL AS ok`)).rows[0].ok
  console.log("\n2. Upgrade-gate records (cloud on 1.0.51 or later):")
  if (!hasGate) console.log("   not available yet (this cloud predates 1.0.51)")
  else {
    const rows = (await client.query(
      `SELECT "clientKey", label, "syncSchema", "lastSeenAt", "retiredAt" FROM "SyncClient" WHERE "tenantId" = $1 ORDER BY "lastSeenAt" DESC`, [t.id])).rows
    if (rows.length === 0) console.log("   none recorded yet")
    for (const r of rows) {
      const kind = r.clientKey.startsWith("hub-bridge@") ? "hub" : r.clientKey.startsWith("device:") ? "DIRECT till" : "account"
      const verdict = r.syncSchema >= 3 ? "ok" : r.retiredAt ? "retired (checkout refused if it returns via a hub; direct: update it)" : "MUST BE UPDATED before café stock policies"
      console.log(`   ${kind.padEnd(11)} ${r.label}  sync=${r.syncSchema}  last=${new Date(r.lastSeenAt).toISOString()}  → ${verdict}`)
    }
  }
} finally {
  await db.$disconnect()
}

/**
 * SPRINT-1: store-wide upgrade gate for stock-policy changes.
 *
 * A till or hub older than sync schema 3 cannot say which stock policy it sold under: once a
 * product's policy has changed, its sales of that product can only be held. So a stock-policy
 * change of an existing product is REFUSED while any client of the store older than schema 3 has
 * traded (pushed) within the last POLICY_GATE_WINDOW_DAYS — unless the owner explicitly retires that
 * client (audited; a retired client that pushes again is active again). Every push records its
 * client: a till by its device id (an upgrade replaces its schema), a hub's bridge as
 * "hub-bridge@<schema>" (several hubs share one store key).
 */
import type { PrismaClient } from "../generated/prisma/index.js"

export const POLICY_GATE_WINDOW_DAYS = 14
export const GATE_SCHEMA = 3
/** Café batch: modifiers, recipes and ingredients (a drink made from a recipe needs every client on it). */
export const CAFE_SCHEMA = 6

export type GateBlocker = { id: string; label: string; syncSchema: number; lastSeenAt: string; source: "server" | "cloud" }

export class StockPolicyGateError extends Error {
  constructor(public blockers: GateBlocker[]) {
    super(`STOCK_POLICY_GATE: stock settings cannot change while ${blockers.length} till(s) or hub(s) on an older version can still trade (${blockers.map((b) => b.label).join(", ")}). Upgrade them, or retire the ones no longer in use, first.`)
    this.name = "StockPolicyGateError"
  }
}

type Db = Pick<PrismaClient, "syncClient">

/**
 * Records a push. Returns whether this client is RETIRED: a retired client on an older version
 * stays retired when it comes back (its checkouts are refused, see the push handler); only an
 * upgrade (schema 3+) or the owner's explicit re-admission ends a retirement.
 */
export async function recordSyncClient(db: Db, tenantId: string, clientKey: string, label: string, syncSchema: number): Promise<{ retired: boolean }> {
  const now = new Date()
  const row = await db.syncClient.upsert({
    where: { tenantId_clientKey: { tenantId, clientKey } },
    create: { tenantId, clientKey, label, syncSchema, lastSeenAt: now },
    update: syncSchema >= GATE_SCHEMA
      ? { label, syncSchema, lastSeenAt: now, retiredAt: null, retiredBy: null, retiredNote: null }
      : { label, syncSchema, lastSeenAt: now },
  })
  return { retired: !!row.retiredAt && syncSchema < GATE_SCHEMA }
}

/** The message a retired, not-upgraded till gets instead of a checkout (before payment). */
export const RETIRED_CLIENT_MESSAGE = "DEVICE_RETIRED: this till was retired by the store owner and runs an older version that cannot record this store's stock settings. The sale was not recorded and no payment should be taken. Update this till to the current version, or ask the owner to re-admit it, then try again."

export async function localGateBlockers(db: Db, tenantId: string, minSchema: number = GATE_SCHEMA): Promise<GateBlocker[]> {
  const since = new Date(Date.now() - POLICY_GATE_WINDOW_DAYS * 86_400_000)
  const rows = await db.syncClient.findMany({ where: { tenantId, syncSchema: { lt: Math.max(GATE_SCHEMA, minSchema) }, retiredAt: null, lastSeenAt: { gte: since } }, orderBy: { lastSeenAt: "desc" } })
  return rows.map((r) => ({ id: r.id, label: r.label, syncSchema: r.syncSchema, lastSeenAt: r.lastSeenAt.toISOString(), source: "server" as const }))
}

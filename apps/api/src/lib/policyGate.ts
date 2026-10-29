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

export type GateBlocker = { id: string; label: string; syncSchema: number; lastSeenAt: string; source: "server" | "cloud" }

export class StockPolicyGateError extends Error {
  constructor(public blockers: GateBlocker[]) {
    super(`STOCK_POLICY_GATE: stock settings cannot change while ${blockers.length} till(s) or hub(s) on an older version can still trade (${blockers.map((b) => b.label).join(", ")}). Upgrade them, or retire the ones no longer in use, first.`)
    this.name = "StockPolicyGateError"
  }
}

type Db = Pick<PrismaClient, "syncClient">

export async function recordSyncClient(db: Db, tenantId: string, clientKey: string, label: string, syncSchema: number) {
  const now = new Date()
  await db.syncClient.upsert({
    where: { tenantId_clientKey: { tenantId, clientKey } },
    create: { tenantId, clientKey, label, syncSchema, lastSeenAt: now },
    // pushing again (still trading) undoes a retirement
    update: { label, syncSchema, lastSeenAt: now, retiredAt: null, retiredBy: null, retiredNote: null },
  })
}

export async function localGateBlockers(db: Db, tenantId: string): Promise<GateBlocker[]> {
  const since = new Date(Date.now() - POLICY_GATE_WINDOW_DAYS * 86_400_000)
  const rows = await db.syncClient.findMany({ where: { tenantId, syncSchema: { lt: GATE_SCHEMA }, retiredAt: null, lastSeenAt: { gte: since } }, orderBy: { lastSeenAt: "desc" } })
  return rows.map((r) => ({ id: r.id, label: r.label, syncSchema: r.syncSchema, lastSeenAt: r.lastSeenAt.toISOString(), source: "server" as const }))
}

/**
 * Operational readiness: the store's topology — where its stock is decided — enforced, not only documented.
 *
 *  - "unset"  every store before this existed: no topology rule applies (behaves as before). Enforcement
 *             cannot be switched on until the owner chooses one (lib/identityGate.ts).
 *  - "direct" registers connect straight to the cloud; the cloud is the stock authority. A hub's forwards
 *             are held for review at the cloud; a hub that adopted this refuses its registers' work.
 *  - "hub"    registers connect through ONE hub (`hubId`, a hub installation, stable across key rotation);
 *             that hub is the stock authority and the cloud records what it forwards. A register that
 *             connects straight to the cloud, or another hub, cannot change stock at the cloud: its work is
 *             held (kept on the register and listed for review), never applied there and never discarded.
 *
 * Never switched automatically (no device that connects can change it). The owner changes it at the cloud,
 * with a note and the version they looked at; the change is refused while any readiness check fails:
 * open shifts, held or failed work, registers or a hub with unsent work or that cannot confirm their queue,
 * and hub and cloud stock that do not agree. Each change is the next version and is audited. A hub adopts
 * the cloud's topology from its pull only when the version is higher (like the staff policy) and keeps it.
 *
 * Read access stays: every register and hub may still pull (catalogue, reports) and see why it is held.
 */
import { randomUUID } from "node:crypto"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import jwt from "jsonwebtoken"
import prisma from "./prisma.js"
import { dataDir } from "./dataDir.js"

export type TopologyMode = "unset" | "direct" | "hub"
export type StoreTopology = { mode: TopologyMode; hubId: string | null; version: number; changedAt: string | null; changedBy: string | null }
export const asTopology = (v: unknown): TopologyMode => (v === "direct" || v === "hub" ? v : "unset")

/** A hub report older than this does not prove the hub's state for a transition. */
export const REPORT_FRESH_MS = 15 * 60_000

export async function storeTopology(tenantId: string): Promise<StoreTopology> {
  const t = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { storeTopology: true, topologyHubId: true, topologyVersion: true, topologyChangedAt: true, topologyChangedBy: true } })
  return { mode: asTopology(t?.storeTopology), hubId: t?.topologyHubId ?? null, version: t?.topologyVersion ?? 0, changedAt: t?.topologyChangedAt?.toISOString() ?? null, changedBy: t?.topologyChangedBy ?? null }
}

// ─── The hub's own identity (a hub installation; its signing key may rotate) ──────────────────────────
const IDENTITY_FILE = "hub-identity.json"
export function hubIdentity(): { hubId: string; label: string } {
  const file = path.join(dataDir(), IDENTITY_FILE)
  try {
    const saved = JSON.parse(fs.readFileSync(file, "utf-8")) as { hubId?: string }
    if (typeof saved.hubId === "string" && /^hubi-[0-9a-f-]{36}$/.test(saved.hubId)) return { hubId: saved.hubId, label: os.hostname() }
  } catch { /* first use */ }
  const hubId = `hubi-${randomUUID()}`
  fs.mkdirSync(dataDir(), { recursive: true, mode: 0o700 })
  const tmp = `${file}.${process.pid}.tmp`
  fs.writeFileSync(tmp, JSON.stringify({ hubId, createdAt: new Date().toISOString() }, null, 2), { mode: 0o600 })
  fs.renameSync(tmp, file)
  return { hubId, label: os.hostname() }
}

/** Whether this hub is the store's stock authority under the topology it holds ("unset": as before). */
export function isStoresHub(t: StoreTopology, ownHubId: string): boolean {
  return t.mode === "unset" || (t.mode === "hub" && t.hubId === ownHubId)
}

/**
 * What a register connected to this server should do (sent with every pull): "ok", or where to connect.
 * The register shows it and stops new checkouts; its queue is kept.
 */
export type ConnectionVerdict = "ok" | "use-hub" | "use-cloud" | "use-store-hub"
export function connectionVerdict(t: StoreTopology, server: { hub: boolean; ownHubId?: string | null }): ConnectionVerdict {
  if (!server.hub) return t.mode === "hub" ? "use-hub" : "ok"
  if (t.mode === "direct") return "use-cloud"
  if (t.mode === "hub" && t.hubId !== server.ownHubId) return "use-store-hub"
  return "ok"
}

export const TOPOLOGY_GUIDANCE: Record<Exclude<ConnectionVerdict, "ok">, string> = {
  "use-hub": "This store's registers connect through its hub, where stock is kept. Connect this register to the store hub (Settings, Connection: Connect to a Hub on your LAN).",
  "use-cloud": "This store's registers now connect straight to the cloud; this hub is no longer part of the store. Connect this register to the cloud (Settings, Connection).",
  "use-store-hub": "Another hub is now this store's hub. Connect this register to the store's hub (Settings, Connection).",
}

/**
 * Why an operation may not change stock or money on this server under the store's topology, or null.
 * A refusal keeps the work: the client keeps it, the server holds it for review (routes/sync.ts).
 *  - cloud, hub store: a register connected straight to the cloud (TOPOLOGY_USE_HUB); a forward from a hub
 *    that is not the store's hub, or one that cannot be attributed to a hub (TOPOLOGY_OTHER_HUB);
 *  - cloud, direct store: any hub's forward (TOPOLOGY_NOT_HUB_STORE);
 *  - a hub that is not the store's hub: its registers' work (TOPOLOGY_NOT_THIS_HUB).
 */
export function topologyDenial(t: StoreTopology, ctx: { hub: boolean; ownHubId?: string | null; bridge: boolean; forwardingHubId?: string | null }): string | null {
  if (t.mode === "unset") return null
  if (ctx.hub) {
    if (isStoresHub(t, ctx.ownHubId ?? "")) return null
    return `TOPOLOGY_NOT_THIS_HUB: ${TOPOLOGY_GUIDANCE[t.mode === "direct" ? "use-cloud" : "use-store-hub"]} Nothing was lost: this work is kept on the register and listed for review.`
  }
  if (!ctx.bridge) return t.mode === "hub" ? `TOPOLOGY_USE_HUB: ${TOPOLOGY_GUIDANCE["use-hub"]} This register's work was not recorded at the cloud; it is kept on the register and listed for review.` : null
  if (t.mode === "direct") return "TOPOLOGY_NOT_HUB_STORE: this store's registers connect straight to the cloud, so a hub's forwarded work does not change stock here. Kept for a manager's review."
  if (!ctx.forwardingHubId || ctx.forwardingHubId !== t.hubId) return `TOPOLOGY_OTHER_HUB: work forwarded by ${ctx.forwardingHubId ? "a hub that is not this store's hub" : "a hub that did not identify itself with an enrolled key"}; only the store's hub changes stock. Kept for a manager's review.`
  return null
}
/** A direct stock write on this server (REST: ledger initialization, reconciliation repair), or null when allowed. */
export async function stockWriteRefusal(tenantId: string, onHub: boolean): Promise<string | null> {
  const t = await storeTopology(tenantId)
  if (onHub) return isStoresHub(t, hubIdentity().hubId) ? null : "This hub is not the store's hub: stock is changed at the store's stock authority."
  return t.mode === "hub" ? "This store's stock is kept at its hub: change it there (the hub sends it to the cloud)." : null
}
export const isTopologyHold = (reason: string | null | undefined) => typeof reason === "string" && /^TOPOLOGY_[A-Z_]+:/.test(reason)
/** Held work that must reach the stock authority through the store's hub (never applied at the cloud). */
export const appliesOnlyAtStoresHub = (reason: string | null | undefined) => typeof reason === "string" && /^TOPOLOGY_(USE_HUB|OTHER_HUB):/.test(reason)

/** A hub adopts the cloud's topology from its pull, only when it is a newer version. */
export async function adoptTopology(tenantId: string, incoming: unknown): Promise<"adopted" | "kept"> {
  const p = incoming as Partial<StoreTopology> | null | undefined
  if (!p || typeof p !== "object" || !Number.isInteger(p.version) || (p.mode !== "unset" && p.mode !== "direct" && p.mode !== "hub")) return "kept"
  const current = await storeTopology(tenantId)
  if ((p.version as number) <= current.version) return "kept"
  await prisma.tenant.update({ where: { id: tenantId }, data: { storeTopology: p.mode, topologyHubId: p.hubId ?? null, topologyVersion: p.version as number, topologyChangedAt: p.changedAt ? new Date(p.changedAt) : new Date(), topologyChangedBy: p.changedBy ?? null } })
  await prisma.auditEvent.create({ data: {
    tenantId, action: "security.topology.adopted", entity: "settings",
    summary: `This hub adopted the store's topology version ${p.version}: ${p.mode}${p.mode === "hub" ? ` (${p.hubId === hubIdentity().hubId ? "this hub" : "another hub"})` : ""} (was version ${current.version}: ${current.mode})`,
    metadata: { before: current, after: p } as any, userId: "__system__", userName: "Sync", userRole: "Admin",
  } as any }).catch(() => undefined)
  return "adopted"
}

// ─── Stock and queue facts both sides compute the same way ─────────────────────────────────────────
export type StockLine = { s: string; q: number; l: number }
/** Every product with a sync id: its stock and the quantity left in its open lots (rounded to 1e-6). */
export async function stockSnapshot(tenantId: string): Promise<StockLine[]> {
  const products = await prisma.product.findMany({ where: { tenantId, syncId: { not: null } }, select: { id: true, syncId: true, stock: true } })
  const lots = await prisma.inventoryBatch.groupBy({ by: ["productId"], where: { tenantId, status: "Open" }, _sum: { quantityRemaining: true } })
  const lotOf = new Map(lots.map((l) => [l.productId, Number(l._sum.quantityRemaining ?? 0)]))
  const r = (n: number) => Math.round(n * 1e6) / 1e6
  return products.map((p) => ({ s: p.syncId!, q: r(Number(p.stock)), l: r(lotOf.get(p.id) ?? 0) })).sort((a, b) => a.s.localeCompare(b.s))
}
export function stockDifferences(a: StockLine[], b: StockLine[]): Array<{ syncId: string; hub: StockLine | null; cloud: StockLine | null }> {
  const ma = new Map(a.map((x) => [x.s, x])), mb = new Map(b.map((x) => [x.s, x]))
  const out: Array<{ syncId: string; hub: StockLine | null; cloud: StockLine | null }> = []
  for (const s of new Set([...ma.keys(), ...mb.keys()])) {
    const x = ma.get(s) ?? null, y = mb.get(s) ?? null
    if (!x || !y || Math.abs(x.q - y.q) > 1e-6 || Math.abs(x.l - y.l) > 1e-6) out.push({ syncId: s, hub: x, cloud: y })
  }
  return out
}

/** This server's own unsent and held work (a hub's report; the cloud's readiness). */
export async function workCounts(tenantId: string) {
  const unsent = await prisma.syncOperation.count({ where: { tenantId, appliedAt: { not: null }, status: { in: ["Pending", "Failed", "Processing"] } } })
  // held for review (a person decides); a client's failed attempts are its own queue's (reported separately)
  const held = await prisma.syncOperation.count({ where: { tenantId, appliedAt: null, status: { in: ["Refused", "Resolving"] } } })
  const openShifts = await prisma.shift.count({ where: { tenantId, status: "Open" } })
  return { unsent, held, openShifts }
}

export type QueueReport = { pending: number; held: number; failed: number; staged: number; journal: number }
export function parseQueueReport(raw: unknown): QueueReport | null {
  if (typeof raw !== "string" || raw.length > 400) return null
  try {
    const o = JSON.parse(raw) as Record<string, unknown>
    const n = (k: string) => (Number.isInteger(o[k]) && (o[k] as number) >= 0 ? (o[k] as number) : null)
    const r = { pending: n("pending"), held: n("held"), failed: n("failed"), staged: n("staged"), journal: n("journal") }
    return Object.values(r).every((v) => v !== null) ? (r as QueueReport) : null
  } catch { return null }
}
/** Why a register's queue does not confirm readiness, in words (an older register sends no report). */
function queueDetail(q: QueueReport | null, reportedAt: Date | string | null, lastSeenAt: Date | string): string {
  if (!q || !reportedAt) return "no queue report (an older register cannot send one)"
  if (new Date(reportedAt) < new Date(lastSeenAt)) return "its queue was confirmed before its latest activity: let it sync again"
  return `pending ${q.pending}, held ${q.held}, failed ${q.failed}, unfinished ${q.journal}`
}
const queueEmpty = (q: QueueReport | null | undefined) => !!q && q.pending === 0 && q.held === 0 && q.failed === 0 && q.staged === 0 && q.journal === 0

/** A register's own report about its queue, sent with its pull (header x-titan-queue). */
export async function recordQueueReport(tenantId: string, deviceId: string | null, raw: unknown): Promise<void> {
  const report = parseQueueReport(raw)
  if (!deviceId || !report) return
  await prisma.syncClient.updateMany({ where: { tenantId, clientKey: `device:${deviceId}` }, data: { queueReport: report as any, queueReportedAt: new Date() } }).catch(() => undefined)
}

// ─── The hub's signed status report (hub → cloud) ────────────────────────────────────────────────────
export type HubReport = {
  hubId: string; label: string; unsent: number; held: number; openShifts: number; policyVersion: number; topologyVersion: number
  stock: StockLine[]; registers: Array<{ deviceId: string; label: string; report: QueueReport | null; reportedAt: string | null; lastSeenAt: string }>
}
export async function buildHubReport(tenantId: string): Promise<HubReport> {
  const id = hubIdentity()
  const t = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { staffPolicyVersion: true, topologyVersion: true } })
  const regs = await prisma.syncClient.findMany({ where: { tenantId, retiredAt: null, clientKey: { startsWith: "device:" } }, select: { clientKey: true, label: true, queueReport: true, queueReportedAt: true, lastSeenAt: true } })
  return {
    hubId: id.hubId, label: id.label, ...(await workCounts(tenantId)),
    policyVersion: t?.staffPolicyVersion ?? 0, topologyVersion: t?.topologyVersion ?? 0,
    stock: await stockSnapshot(tenantId),
    registers: regs.map((r) => ({ deviceId: r.clientKey.slice("device:".length), label: r.label, report: (r.queueReport as QueueReport | null) ?? null, reportedAt: r.queueReportedAt?.toISOString() ?? null, lastSeenAt: r.lastSeenAt.toISOString() })),
  }
}

/** The cloud checks a hub's signed report with the hub's enrolled key and keeps it on that key. */
export async function acceptHubReport(tenantId: string, token: unknown): Promise<{ ok: true; hubId: string } | { ok: false; reason: string }> {
  if (typeof token !== "string" || token.length > 2_000_000) return { ok: false, reason: "absent" }
  const decoded = jwt.decode(token, { complete: true }) as { header?: { kid?: string; alg?: string } } | null
  const kid = decoded?.header?.kid
  if (!kid || decoded?.header?.alg !== "ES256") return { ok: false, reason: "invalid-signature" }
  const key = await prisma.hubKey.findUnique({ where: { kid } })
  if (!key || key.tenantId !== tenantId) return { ok: false, reason: "unknown-key" }
  if (key.status !== "ACTIVE") return { ok: false, reason: key.status === "REVOKED" ? "revoked" : "rotated" }
  let claims: { typ?: string; tid?: string; report?: HubReport }
  try { claims = jwt.verify(token, key.publicPem, { algorithms: ["ES256"], issuer: "titan-hub", audience: `titan-cloud:${tenantId}` }) as typeof claims } catch { return { ok: false, reason: "invalid-signature" } }
  if (claims.typ !== "hub-report" || claims.tid !== tenantId || !claims.report || typeof claims.report.hubId !== "string") return { ok: false, reason: "invalid-report" }
  if (key.hubId && key.hubId !== claims.report.hubId) return { ok: false, reason: "other-hub" }
  await prisma.hubKey.update({ where: { kid }, data: { lastReport: claims.report as any, lastReportAt: new Date(), ...(key.hubId ? {} : { hubId: claims.report.hubId }) } })
  return { ok: true, hubId: claims.report.hubId }
}

// ─── Readiness and the owner's decision (cloud) ──────────────────────────────────────────────────────
export type TopologyBlocker = { code: string; message: string; items?: Array<{ id: string; label: string; detail?: string }> }

type HubRow = { kid: string; hubId: string | null; hubLabel: string; status: string; enrolledAt: Date; lastReport: unknown; lastReportAt: Date | null }
export async function storeHubs(tenantId: string): Promise<HubRow[]> {
  return prisma.hubKey.findMany({ where: { tenantId }, orderBy: { enrolledAt: "desc" }, select: { kid: true, hubId: true, hubLabel: true, status: true, enrolledAt: true, lastReport: true, lastReportAt: true } })
}

/** One hub's report as proof of its state for a transition: fresh, nothing unsent or held, stock agrees. */
async function hubProof(tenantId: string, label: string, key: HubRow | undefined, cloudStock: StockLine[], now: number): Promise<TopologyBlocker[]> {
  if (!key) return [{ code: "hub-not-enrolled", message: `${label}: no enrolled key. Enroll the hub (owner PIN on the hub) first.` }]
  const r = key.lastReport as HubReport | null
  if (!r || !key.lastReportAt || now - key.lastReportAt.getTime() > REPORT_FRESH_MS) return [{ code: "hub-not-reporting", message: `${label} has not reported in the last ${REPORT_FRESH_MS / 60_000} minutes. Make sure it is running and online, then check again.` }]
  const out: TopologyBlocker[] = []
  if (r.unsent > 0) out.push({ code: "hub-unsent", message: `${label} still has ${r.unsent} operation(s) to send to the cloud. Wait for it to sync.` })
  if (r.held > 0) out.push({ code: "hub-held", message: `${label} holds ${r.held} operation(s) for review. Apply or decline them at the hub first.` })
  if (r.openShifts > 0) out.push({ code: "hub-open-shifts", message: `${label} has ${r.openShifts} open shift(s). Close them first.` })
  const regs = (r.registers ?? []).filter((g) => !queueEmpty(g.report) || !g.reportedAt || new Date(g.reportedAt) < new Date(g.lastSeenAt))
  if (regs.length) out.push({ code: "hub-register-queue", message: `${regs.length} register(s) behind ${label} have unsent work or have not confirmed their queue. Let each one sync (an older register cannot confirm: upgrade it, or retire it at the hub).`, items: regs.map((g) => ({ id: g.deviceId, label: g.label, detail: queueDetail(g.report, g.reportedAt, g.lastSeenAt) })) })
  const diff = stockDifferences(r.stock ?? [], cloudStock)
  if (diff.length) {
    const names = new Map((await prisma.product.findMany({ where: { tenantId, syncId: { in: diff.slice(0, 20).map((d) => d.syncId) } }, select: { syncId: true, name: true } })).map((p) => [p.syncId!, p.name]))
    out.push({ code: "stock-unreconciled", message: `Stock at ${label} and at the cloud differ for ${diff.length} product(s). Reconcile them (a count at the hub, then let it sync) before changing the store's setup.`, items: diff.slice(0, 20).map((d) => ({ id: d.syncId, label: names.get(d.syncId) ?? d.syncId, detail: `hub ${d.hub ? `${d.hub.q} (lots ${d.hub.l})` : "missing"}, cloud ${d.cloud ? `${d.cloud.q} (lots ${d.cloud.l})` : "missing"}` })) })
  }
  return out
}

export async function topologyReadiness(tenantId: string, to: TopologyMode, toHubId: string | null): Promise<TopologyBlocker[]> {
  const now = Date.now()
  const current = await storeTopology(tenantId)
  const out: TopologyBlocker[] = []
  if (to === "unset") return [{ code: "invalid", message: "A store cannot go back to an unset topology; choose direct or hub." }]
  if (to === current.mode && (to !== "hub" || toHubId === current.hubId)) return [{ code: "unchanged", message: "The store already has this setup." }]
  if (to === "hub" && !toHubId) return [{ code: "invalid", message: "Choose which hub becomes the store's hub." }]
  const work = await workCounts(tenantId)
  if (work.openShifts > 0) {
    const shifts = await prisma.shift.findMany({ where: { tenantId, status: "Open" }, select: { id: true, shiftNumber: true, openedByName: true }, take: 20 })
    out.push({ code: "open-shifts", message: `${work.openShifts} shift(s) are open. Close every shift before changing the store's setup.`, items: shifts.map((s) => ({ id: s.id, label: s.shiftNumber, detail: `opened by ${s.openedByName}` })) })
  }
  if (work.held > 0) out.push({ code: "held-work", message: `${work.held} operation(s) are held for review at the cloud. Apply or decline them in Held work first.` })
  // registers connected to the cloud: an empty queue they reported after their latest operation
  const regs = await prisma.syncClient.findMany({ where: { tenantId, retiredAt: null, clientKey: { startsWith: "device:" } }, select: { id: true, clientKey: true, label: true, lastSeenAt: true, queueReport: true, queueReportedAt: true } })
  const unconfirmed = regs.filter((r) => !queueEmpty(r.queueReport as QueueReport | null) || !r.queueReportedAt || r.queueReportedAt < r.lastSeenAt)
  if (unconfirmed.length) out.push({ code: "register-queue", message: `${unconfirmed.length} register(s) connected to the cloud have unsent work or have not confirmed their queue. Let each one sync; retire the ones no longer in use (an older register cannot confirm: upgrade or retire it).`, items: unconfirmed.map((r) => ({ id: r.id, label: r.label, detail: queueDetail(r.queueReport as QueueReport | null, r.queueReportedAt, r.lastSeenAt) })) })

  const hubs = await storeHubs(tenantId)
  const active = hubs.filter((h) => h.status === "ACTIVE")
  const cloudStock = await stockSnapshot(tenantId)
  // the hub that is the stock authority now (hub store), or any hub still active (an unset store)
  const outgoing = current.mode === "hub" ? hubs.find((h) => h.hubId === current.hubId && h.status !== "ROTATED") : current.mode === "unset" ? active[0] : undefined
  if (outgoing && !(to === "hub" && outgoing.hubId === toHubId)) {
    // its work must have reached the cloud, unless the owner retired it (its late forwards are then held for review)
    if (outgoing.status !== "REVOKED") out.push(...await hubProof(tenantId, `The current hub (${outgoing.hubLabel || outgoing.hubId})`, outgoing, cloudStock, now))
  }
  if (current.mode === "unset" && !outgoing) {
    const links = await prisma.syncClient.count({ where: { tenantId, retiredAt: null, clientKey: { startsWith: "hub-bridge@" } } })
    if (links > 0) out.push({ code: "hub-unconfirmed", message: "A hub without an enrolled key has synced with this store; its state cannot be confirmed. Upgrade and enroll it, or retire its link." })
  }
  if (to === "hub") {
    const target = active.find((h) => h.hubId === toHubId)
    out.push(...await hubProof(tenantId, `The new hub (${target?.hubLabel || toHubId})`, target, cloudStock, now))
    // another active hub would compete with it
    const others = active.filter((h) => h.hubId !== toHubId && h.hubId !== (outgoing?.hubId ?? null))
    if (others.length) out.push({ code: "other-hub-active", message: "Another hub has an active key for this store. Retire it (revoke its key) first.", items: others.map((h) => ({ id: h.kid, label: h.hubLabel || h.hubId || h.kid })) })
  }
  return out
}

export class TopologyStaleError extends Error { constructor(public current: StoreTopology) { super("TOPOLOGY_STALE"); this.name = "TopologyStaleError" } }

/** The owner's decision: the next version, only if the store is still at the version they looked at. */
export async function changeTopology(tenantId: string, to: "direct" | "hub", hubId: string | null, expectedVersion: number, by: { id: string; name: string }, note: string): Promise<StoreTopology> {
  const before = await storeTopology(tenantId)
  const n = await prisma.tenant.updateMany({ where: { id: tenantId, topologyVersion: expectedVersion }, data: { storeTopology: to, topologyHubId: to === "hub" ? hubId : null, topologyVersion: { increment: 1 }, topologyChangedAt: new Date(), topologyChangedBy: by.id } })
  if (n.count !== 1) throw new TopologyStaleError(await storeTopology(tenantId))
  const after = await storeTopology(tenantId)
  await prisma.auditEvent.create({ data: {
    tenantId, action: "security.topology.changed", entity: "settings",
    summary: `${by.name} changed the store's setup from ${before.mode} (version ${before.version}) to ${after.mode}${after.mode === "hub" ? ` (hub ${after.hubId})` : ""} (version ${after.version}): ${note}`,
    metadata: { before, after, note } as any, userId: by.id, userName: by.name, userRole: "Admin",
  } as any })
  return after
}

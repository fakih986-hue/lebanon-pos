# POS-SYNC-AUTHORITY-1 — Hub-Authoritative Inventory Safety Patch

**Date:** 2026-07-13
**Scope:** stop inventory resurrection + stale batch propagation in single-hub multi-device mode. No stock-mutation ledger (that is AUTHORITY-2).

---

## 1. Verdict

**Done at the code + server/DB layer.** All six confirmed problems are closed with regression tests. Additive migration only; verified it applies cleanly on a populated database. On-screen two-device confirmation still requires installing the new build (this environment can't observe the Electron/browser UI) — see §7.

## 2. What was fixed

| # | Confirmed problem | Fix |
|---|-------------------|-----|
| 1 | `InventoryBatch` had no `updatedAt` | Added `updatedAt @updatedAt` + `@@index([tenantId, updatedAt])`. Additive migration `20260713120000_add_inventory_batch_updated_at`. |
| 2 | Incremental pull filtered batches by `receivedAt` only → sale-driven quantity/status changes missed by other devices | `GET /api/sync/pull?since=` now filters batches by `receivedAt` **OR** `updatedAt`, ordered by `updatedAt desc`. A consumed batch now propagates to every device on the next incremental pull (was: only on a full pull). |
| 3 | `cloudSync.ts` applied whole Product rows incl. `stock` | On a normal cloud pull, `stock` is stripped from the update patch for an **existing** product (metadata still flows). |
| 4 | `cloudSync.ts` applied whole `InventoryBatch` rows incl. `quantityRemaining`/`status` | On a normal cloud pull, an **existing** batch is **not** updated from cloud. New batches are still created (bootstrap / new item). |
| 5 | No ownership/revision guard → stale cloud inventory could overwrite hub | Hub is now authoritative for inventory quantities on normal pull. Explicit restore is the only overwrite path, gated on no pending local stock ops. Ownership table written: [inventory-ownership.md](../sync/inventory-ownership.md). |
| 6 | `Product.stock` and batch totals are separate truths that drift | **Not structurally resolved this sprint** (that needs the AUTHORITY-2 projection model). No new drift is *introduced*; existing drift is unchanged. Documented as deferred. |

### Bootstrap / restore carve-out (requirement 4 & 5)
- **Normal background pull:** never overwrites existing hub inventory; creates genuinely new rows only.
- **First bootstrap** (empty hub DB): every row is a create → full snapshot imported naturally.
- **Explicit restore** (`triggerFullPull` via `/api/setup/pull-from-cloud`): the only path allowed to overwrite existing inventory from cloud — **and only when there are no pending/failed local stock `SyncOperation`s** (entity in `sale | refund | inventory | product`). Otherwise it is downgraded to metadata-only and logged, so un-pushed local stock truth is never discarded.
- Skips are logged: `Hub-authoritative inventory: ignored cloud stock on N existing product(s) and skipped M existing batch update(s)`.

## 3. Single-hub assumption (explicit)

All in-store stock changes originate at the one hub; Railway is a mirror/backup/dashboard. **Known limitation:** a stock change made elsewhere (a second hub, or an owner editing stock in the Railway dashboard) will **not** flow into this hub on normal sync — that is the deliberate cost of making stock un-resurrectable from a stale snapshot. Removing this limitation requires the revision model in AUTHORITY-2. Documented in the ownership doc.

## 4. Tests (all green)

- **API: 176 passed** (was 170; +6 new):
  - incremental pull filters batches by `receivedAt` OR `updatedAt`, ordered by `updatedAt`.
  - normal pull does NOT apply cloud `stock` to an existing product (matched by syncId); metadata still applies.
  - normal pull skips updating an existing batch.
  - normal pull still creates a new (missing) batch.
  - explicit restore DOES apply cloud stock/batch when no local stock ops pending.
  - explicit restore is BLOCKED from overwriting inventory while local stock ops are pending (and queries the correct entity filter).
- **Desktop: 118 passed** (no regression to write-through sale commit).
- Typecheck clean: **api / desktop / electron**.
- Migration applied cleanly to the populated local Postgres (real rows backfilled to `now()`), and the real-DB stress suite passes against the migrated schema.

## 5. Files changed

- `apps/api/prisma/schema.prisma` — `InventoryBatch.updatedAt` + index.
- `apps/api/prisma/migrations/20260713120000_add_inventory_batch_updated_at/migration.sql` — additive.
- `apps/api/src/routes/sync.ts` — batch incremental filter (receivedAt OR updatedAt).
- `apps/api/src/services/cloudSync.ts` — hub-authoritative inventory: `pullFromCloud({isRestore})`, pending-stock-op guard, product `stock` stripping, existing-batch skip, summary log.
- `apps/api/__tests__/sync.test.ts`, `apps/api/__tests__/cloudSync.test.ts` — 6 new tests.
- `stages/sync/inventory-ownership.md` — ownership table + single-hub assumption.

## 6. What remains for POS-SYNC-AUTHORITY-2

- `StockMutation` ledger (sale/refund/void/receive/damage/adjustment/count as append-only, idempotent, source-tagged events) + stock revision counters.
- `Product.stock` / batch totals become a maintained **projection** of accepted events — removes the aggregate-vs-batch drift class (problem #6) structurally.
- Revision-based conflict resolution to safely accept legitimate cloud-originated stock edits (removes the single-hub limitation).
- Full real two-device torture matrix (server-level already covered; genuine on-screen device pairing is the outstanding piece).

## 7. Installer rebuild required?

**Yes — 1.0.31.** The hub only gets the new pull filter, the hub-authoritative cloud-pull logic, **and the bundled `updatedAt` migration** (applied by the electron migration runner on startup) via a new installer. Not yet built — awaiting go-ahead (per the per-build authorization pattern).

## 8. Railway deploy required?

**Not required to fix the reported problem; optional/deferred.**
- The reported symptoms (cross-device batch staleness; cloud stock resurrecting on the hub) are fixed entirely by the **hub** build — the hub owns inventory and connected clients pull from the hub, not Railway.
- Railway on the current build (`b58bb06`) stays **self-consistent**: pushed batch payloads carry no `updatedAt`, so nothing is rejected, and its own pull route keeps using `receivedAt`.
- Deploying later is **safe and additive** (Railway auto-runs `migrate deploy` on boot) and would extend the batch-propagation fix to any DIRECT_RAILWAY tills + the cloud dashboard. Recommended only if/when DIRECT_RAILWAY is in use. Held for now per the "no unnecessary redeploys" standing preference.

No manifest, no GitHub release.

# REFUND-INTEGRITY-1 — refund and void rules

Status: implemented and tested locally (2026-10-16). Not yet deployed. See "Rollout".

## What was wrong

| # | Defect | Effect |
|---|---|---|
| 1 | Each partial refund walked the sale's lots from the start | Lot A could be restored twice and lot B never; lot balances drifted from stock |
| 2 | The server restored whatever lots the client named; `SaleItem` stored no lots | Lots could not be validated against the original sale |
| 3 | Nothing on the server capped a refund at sold − already refunded | Two offline devices could each refund the full sale, restoring stock and paying money twice |
| 4 | Refunds stored no exchange rate | "Refund at the original sale's rate" was unenforceable |
| 5 | Desktop refunds and voids pushed the device's **entire lot table** as absolute quantities | One device's stale lots overwrote other devices' sales |
| 6 | Server void restored the full sold quantity, even after partial refunds; it restored no lots | Sell 10, refund 4, void → stock +14 |
| 7 | Refund quantities were tracked per product, not per sale line | Two lines of the same product shared one counter |
| 8 | Sales pulled from the server were stored raw (item `id` = SaleItem UUID, Decimals as strings) | Refunding another device's sale restored the wrong product |
| 9 | A full pull replaced the local refunds list; "Clear stuck" deleted rejected operations | A refund rejected by the server silently vanished from the device |
| 10 | Local refund = three separate writes with no recovery | A crash mid-refund left partial stock/lot effects |

## The rules (identical on the till and the server)

Implemented once in `refundAllocation.ts`, byte-identical in `apps/api/src/lib/` and `apps/desktop/src/features/pos/lib/`.
Both test suites run the shared vectors in `packages/shared/test-vectors/refund-allocation.json`, and fail if the two copies differ.

1. **Line identity.** Every sale line created from this release on carries a client-generated `lineId` (stamped in `buildSale`). The server stores it (`SaleItem.lineId`, unique per sale).
2. **Recorded lots.** The server records the lots it **actually** consumed per line (`SaleItem.batchAllocations`). This includes lots chosen by its FEFO fallback; any untracked remainder is recorded as `batchId: null`. On the hub, the hub's record wins over the cloud's when items are re-created from a pull.
3. **Cumulative limit.** A refund may not exceed `sold − already refunded`, per line, and in money it may not exceed `sale total − refunds so far` (±0.005).
4. **Lot restoration.** Lots come back from the sale's recorded lots, in original consumption order, net of what earlier refunds of that line already restored. Client-sent allocations are ignored by the server.
5. **Rate.** A refund records the original sale's tender rate (`SaleRefund.exchangeRate`, `rateSource: "sale_tender"`).
6. **Voids.** A sale with any refund cannot be voided — refund the rest instead. A void restores every recorded lot in full.
7. **Concurrency.** Every refund/void transaction first bumps `Sale.refundVersion`. This row lock serializes concurrent refunds of one sale, and the prior-refund read happens after it. Proven against real Postgres: two simultaneous full refunds → exactly one accepted. With the lock removed, the same test fails.
8. **Idempotency.** A retried refund (same id) is a no-op. Concurrent retries are stopped by the refund primary key inside the transaction.

## Legacy fallback (sales made before this release)

No historical line identity, lot or rate is invented.

- **Lines without a `lineId`** are pooled per product within the sale under the key `legacy-product:<productId>`. The cumulative limit applies to the pool.
- **They restore product stock only — never a lot.** The previous code guessed "the newest batch"; that guess is removed. The stock-ledger reconciliation report will show such stock as product stock not covered by lots, which is accurate.
- **Untracked slices** (`legacy-stock`, or allocations covering less than the sold quantity) also restore product stock only.
- **No rate recorded** → `exchangeRate: null`, `rateSource: "unavailable"`. The UI says the rate is unknown rather than showing today's rate as if it were the original.
- **Old clients** that send no `saleLineId` have their refund spread across that product's lines in sale order, under the same limits.

## Offline refunds the server later rejects

Server validation cannot stop two disconnected devices from each paying a refund. Once the second one syncs, the server rejects it with a stable code (`REFUND_EXCEEDS_REFUNDABLE`, `REFUND_SALE_VOIDED`, `VOID_HAS_REFUNDS`, …).

The device then handles it like this:

1. **Never silently reversed, discarded or hidden.**
   - The rejected sync operation stays in the queue as the durable record. "Clear stuck", "remove", "clear all" and full pulls all preserve it.
   - The local refund stays in history.
2. **Until it is settled, it keeps counting on this device**, because the cash really left the drawer. The server's books don't include it. The Sales page shows it under **"Refunds rejected by the server"**, with the amount, the reason, who issued it and when.
3. **Stock follows the server.** The server never applied the restore, and the next pull brings its stock and lot balances.
4. **A manager with `accounting.manage` settles it, with a required note:**
   - **"Money not recovered — record as a loss":** an expense of the same amount (category *Other*, "Refund conflict R-…") is recorded in the current shift and synced. The refund stops counting. Local and server books then agree.
   - **"Customer returned the money":** the refund stops counting; no money entry is made.

   The settlement is audited (`sale.refund.conflict_settled`) and kept locally (`lebanonpos.money-conflict-settlements.v1`). Only after settlement does the rejected operation leave the queue.

A rejected void follows the same flow. The amount at stake is what the void returned (sale total − refunds).

## Crash and restart safety (desktop)

`processRefund` keeps a journal (`lebanonpos.refund-journal.v1`):

1. Write the journal entry.
2. Restore lots locally.
3. Restore stock locally.
4. **Commit point:** write the refund record, and enqueue its sync operation.
5. Add the debt credit (debt sales only), the stock-ledger entries and the audit event.
6. Drop the journal entry.

On failure:

- **Before the commit point,** the refund is rolled back immediately. No refund was issued, so the cashier hands over nothing.
- **After the commit point,** the remaining steps are completed. `recoverRefundJournal()` runs at startup (`routes/index.tsx`):
  - an uncommitted entry is rolled back;
  - a committed one is completed;
  - every step is idempotent, so running recovery twice changes nothing.

**Limitation:** this protects against exceptions and app restarts. It cannot make separate localStorage keys atomic against OS-level power loss mid-flush. That is the pre-existing storage-layer limitation noted in `SPRINT-PLAN.md`.

## Rollout, compatibility and rollback

**Migration** `20261016120000_refund_integrity` is additive:

- nullable columns;
- one `INTEGER NOT NULL DEFAULT 0`;
- a unique `(saleId, lineId)` index that cannot collide, because every existing `lineId` is NULL.

It was verified by applying every migration from scratch to an empty database. The Electron hub applies it automatically at startup (it is in the API bundle).

**Order:**

1. **Back up the Railway database.**
2. Deploy the API + SPA to Railway (`prisma migrate deploy` runs at container start).
3. Then publish the hub release.

**Compatibility:**

- **Old hubs against the new cloud.** Pull responses omit the new columns unless the client sends `x-titan-sync-schema: 2`. This matters because old hubs re-insert pulled rows verbatim and would otherwise fail on unknown columns. Old hubs' pushes are accepted, via the legacy fallback.
- **New hub against the old cloud: don't.** Deploy the cloud first. An old cloud would re-validate the new refund payloads under the old rules.
- **Desktop web clients** load the SPA from the same deployment, so they upgrade together with the API.
- **Behavior change for everyone:** refunds above the remaining refundable amount, and voids of refunded sales, are now rejected instead of silently over-applied.

**Rollback:**

- Redeploy the previous image. The new columns are ignored by old code.
- Rolling back the schema is not required and not recommended. If ever needed, it is a manual `ALTER TABLE … DROP COLUMN` of the six new columns and the index.
- Hubs on the new release keep working against a rolled-back cloud for sales. Their refunds are then validated by the old rules again.

## Known follow-ups (not in this sprint)

- Sales in DIRECT_RAILWAY mode still enqueue an absolute `inventory/update` of the touched lots after a local sale. The server's `inventory/update` handler still writes absolute `quantityRemaining`. Refunds and voids no longer use it. The sale path should move to the same server-authoritative model.
- Server void of a sale that is not on the server yet remains a silent no-op (pre-existing).
- Switching stores clears the store's local data, including open money conflicts. A warning before switching would make this safe.
- `refundNumber` is unique per tenant but generated client-side; a collision makes a refund retry until it goes dead (pre-existing).

## Tests

| Suite | Count | What it proves |
|---|---|---|
| `apps/api/__tests__/refundAllocation.test.ts` + desktop twin | 19 + 19 | Shared vectors; the two copies are identical; mutation-checked |
| `apps/api/__tests__/sync.test.ts` | 11 new | Server contract: lock order, ignoring client lots, cumulative limits, rate, legacy, void guard |
| `apps/api/__tests__/refund-integrity.test.ts` | 7 | **Real Postgres:** persisted lots, exact repeated partial refunds, simultaneous two-device refunds (8/8 runs green with the lock, fails without it), idempotent retry, legacy fallback, void guard, old-hub field gating |
| `apps/desktop/src/__tests__/refundIntegrity.test.ts` | 12 | Line ids, exact local lots, rejection without side effects, rollback, restart recovery (applied once), legacy, server-row normalization, void guard without absolute lot push, rejected refunds surviving clear/remove/pull, manager-only settlement with note, loss vs recovered, EN/AR key parity |

The real-Postgres suites (`refund-integrity`, `sync-stress`) need `DATABASE_URL` pointing at a database with this migration applied.

# REFUND-INTEGRITY-1 — refund, void and settlement rules

**Status:** implemented and tested locally. Not deployed.

| Round | Date | What |
|---|---|---|
| 1 | 2026-10-16 | Refund integrity |
| 2 | 2026-10-16 | Pre-deployment review: points 1–8 below, plus two inventory-authority defects found while reviewing |

## 1. What was wrong

| # | Defect | Effect | Round |
|---|---|---|---|
| 1 | Each partial refund walked the sale's lots from the start | A lot restored twice, another never | 1 |
| 2 | The server restored whatever lots the client named; `SaleItem` stored no lots | Lots unverifiable | 1 |
| 3 | No server cap on sold − already refunded | Two offline devices could each refund in full | 1 |
| 4 | Refunds stored no exchange rate | Original-rate policy unenforceable | 1 |
| 5 | Refunds/voids pushed the device's whole lot table as absolute quantities | One device's stale lots overwrote others' sales | 1 |
| 6 | Server void restored the full sold quantity after partial refunds | Sell 10, refund 4, void → +14 | 1 |
| 7 | Refund quantities tracked per product, not per line | Two lines shared one counter | 1 |
| 8 | Pulled sales/refunds stored raw (UUID item id, Decimal strings) | Refund of another device's sale restored the wrong product | 1 |
| 9 | Full pull / "Clear stuck" erased rejected refunds | Issued refunds vanished | 1 |
| 10 | Local refund was three unrecovered writes | Crash left partial effects | 1 |
| 11 | **`inventory/update` applied absolute `quantityRemaining` from any client** (verified on Postgres: a lot set to 999). Old clients still send it after every sale/refund/void. | Old clients overwrite lots | 2 |
| 12 | **Stock adjustments, counts and write-offs never changed server stock or lots** (verified: accepted "ok", stock unchanged). The handler also wrote a ledger row on every retry. | The next hub-authoritative pull silently reverted every adjustment | 2 |
| 13 | Refund and void handlers **read the sale before taking the lock** | A refund could pass against a sale voided meanwhile (refund-vs-void race) | 2 |
| 14 | A debt refund's customer credit was synced as its own operation | A rejected refund still credited the customer; settling it as a "loss" would count it twice | 2 |
| 15 | Voiding a debt sale sends the debt delete **before** the void | A rejected void still erased the customer's debt | 2 |
| 16 | Settlement used random ids and had no journal, and `createCashMovement` silently returned `null` on failure | A retry or crash could double an expense; failures went unnoticed | 2 |
| 17 | Switching stores wiped the queue and refunds | Open money conflicts were lost | 2 |

## 2. The rules (identical on the till and the server)

The rules live in `refundAllocation.ts`, byte-identical in `apps/api/src/lib/` and `apps/desktop/src/features/pos/lib/`. Both suites run the shared vectors in `packages/shared/test-vectors/refund-allocation.json` and assert the two copies are identical.

1. **Line identity.** Every sale line created from this release carries a client-generated `lineId` (stamped in `buildSale`). The server stores it on `SaleItem`, unique per sale.
2. **Recorded lots.** The server records the lots it actually consumed per line (`SaleItem.batchAllocations`), including FEFO-fallback lots; any untracked remainder has `batchId: null`. On a hub, the hub's record wins over the cloud's when pulled items are re-created.
3. **Cumulative limit.** A refund cannot exceed sold − already refunded, per line. In money it cannot exceed sale total − refunds so far, with a 0.005 tolerance.
4. **Lot restoration.** Lots are restored from the sale's recorded lots, in original consumption order, net of earlier refunds. Client allocations are ignored.
5. **Rate.** Refunds record the original sale's tender rate (`SaleRefund.exchangeRate`, `rateSource`).
6. **Voids.** A sale with any refund cannot be voided. A void restores every recorded lot.
7. **Locking.** Every refund and every void first bumps `Sale.refundVersion` (`sync.ts` refund handler `const locked = await db.sale.updateMany(...)`; void handler, same statement at the top of the `void` branch), and only then reads the sale and its prior refunds. These two handlers are the only writers of refunds or voids.
8. **Idempotency.** A retried refund is a no-op; concurrent duplicates are stopped by the primary key inside the transaction.
9. **Customer credit.** A debt refund's customer credit is created by the refund handler in the same transaction (`refund-credit:<refundId>`). The till shows it locally under the same id (`localOnly`) and never pushes it as a separate operation.

## 3. Legacy fallback (sales made before this release)

No historical line identity, lot or rate is invented.

- **Pooling.** Lines without a `lineId` are pooled per product within the sale (`legacy-product:<productId>`), and the cumulative limit applies to the pool.
- **Stock only, tagged.** They restore product stock only, never a lot. That stock is tagged in the ledger: a `Refund` movement with note `UNALLOCATED_RETURN <sale>`.
- **Untracked slices** behave the same way.
- **Rate.** A sale with no recorded rate gives `exchangeRate: null`, `rateSource: "unavailable"`.
- **Old clients.** A refund from an old client without `saleLineId` is spread across the product's lines in sale order.

## 4. Pre-deployment review — findings and evidence

### 4.1 Settlement cannot double-count a refund and its settlement entry

Settled refunds drop out of `getRefunds()` (`sales.service.ts`), which is the source for every cash, profit and report figure (`shift.service.ts` `computeShiftCashBreakdown`, metrics, accounting). `getAllRefunds()` keeps them for history. So before settlement the refund counts; after settlement only the settlement entries count.

Example: a $10 cash refund issued offline and rejected by the server. The drawer opened with $100, so the expected drawer before settlement is $90. Tested in `refundIntegrity.test.ts`, "cash refund settled — …":

| Resolution | Expected drawer after | Profit effect | Customer balance | What the cloud receives |
|---|---|---|---|---|
| loss | $90 (expense replaces refund) | −$10 expense | — | 1 expense `settle-loss-<op>` |
| recovered, cash back to drawer | $100 (payout −10, recovery +10) | none | — | 2 cash movements `settle-out-<op>`, `settle-in-<op>` |
| recovered, by bank transfer | $90 (payout stays; money is in the bank) | none | — | 1 cash movement `settle-out-<op>` |
| not paid out | $100 (nothing left the drawer) | none | — | nothing |

In every row the refund itself no longer counts (`counted() === 0`) and the rejected refund operation leaves the queue. The cloud never had the refund. After settlement, its books and the till's describe the same money.

For a **debt refund**, the customer credit is the money (a test covers this case):

- **keep credit (loss).** One synced credit `settle-credit-<op>`. The local-only credit is removed, so the customer is credited once. No expense is recorded, because a credit is not also an expense.
- **reverse credit (not_paid).** The local credit is removed and nothing is sent; the customer owes again.

**Attribution limit.** Settlement entries land in the *current* shift. A shift or day already closed keeps its stored snapshot, which included the refund. The settlement day carries the correction. This is reported, not hidden: the audit event records the original shift.

### 4.2 "Recovered" records the actual recovery and is distinct from "never paid out"

- `recovered` requires a recovery method (Cash, Bank transfer, Card, Wallet) and a reference of at least 2 characters (`assertCanSettle`).
- Cash recovered into the drawer records the payout **and** the recovery as two synced cash movements. Both carry `referenceEntity: "refund-conflict"`, the refund id, and the method and reference in the note.
- A non-cash recovery keeps the evidence in the settlement record and the audit event (`recoveryMethod`, `recoveryReference`).
- `not_paid` means the money never left: no entry, note required.
- All three outcomes write the `sale.refund.conflict_settled` audit event (synced), with amount, method, code, resolution, evidence and entry ids. The refund's `conflict.resolution` keeps the true outcome (`loss | recovered | not_paid`).

### 4.3 Settlement survives retries, restart and sync rejection

`refundConflict.service.ts`:

1. **Journal first.** A settlement record (`status: "settling"`) is written before any entry.
2. **Idempotent steps.** The steps are money entries → mark refund → audit → remove the rejected op, and each records its completion.
3. **Deterministic ids.** Every entry id derives from the conflict's operation id (`settlementIds`), and is checked for existence before creation. The server upserts expenses, cash movements and debt payments by id.
4. **Retries.** A double click or retry returns the settled record. An interrupted record resumes with its *original* decision. `resumeMoneyConflictSettlements()` runs at startup (`routes/index.tsx`).
5. **Rejected entries.** If the server rejects a settlement entry, the rejected operation is itself a protected money conflict (`isSettlementEntryOperation`), listed for **retry**. It is never re-created.
6. **No silent failures.** `createCashMovement` returning `null` now aborts the step instead of being ignored. Preconditions are checked before anything is written: accounting permission, cash permission for drawer entries, an open shift, a customer for credits.

Tested: double settle → one expense; an interrupted settlement plus restart → one expense; a rejected expense → protected from "Clear stuck", retried as Pending, never duplicated.

### 4.4 Legacy refunds without lots are a visible exception, not corruption

- **Ledger.** The server tags lot-less refunded stock `UNALLOCATED_RETURN`.
- **Report.** `GET /api/inventory/reconciliation` (`routes/inventory.ts`) reports `unallocatedReturnQty` per product and the classification `unallocated_return`, with a suggested action and a summary count (`summary.unallocatedReturns`).
  - When the stock-vs-lots gap is fully explained by unallocated returns, the row is a **warn**, not an unexplained `stock_batch_mismatch` error.
  - Anything unexplained stays an error.
- **Available stock is unaffected.** Selling uses product stock. Those units are sold as untracked stock, and lots never go negative.

Real-Postgres test: legacy refund → stock 6, lot 4 → report warns `unallocated_return`, qty 2 → sell all 6 → stock 0, lot 0.

### 4.5 Old-client writes, not only pulls

| Old-client write | New server behaviour | Test |
|---|---|---|
| Absolute lot table (`inventory/update`) after sale/refund/void | Quantities and Open/Consumed statuses ignored; only "Expired" accepted (`sync.ts` `item.status !== "Expired"`) | `inventory-authority.test.ts` |
| Refund with its own lot allocations | Ignored; the server plans from the persisted sale | `refund-integrity.test.ts` |
| Over-refund | Rejected | same |
| Separate "Refund Credit" payment | Applied only if its refund exists, and only once (deduped by reference); otherwise retryable, never silently applied | same |
| Debt delete sent before a void | Ignored until the sale is actually voided (the void handler removes the debt itself) | same |
| Stock adjustment | Now applied to stock and lots exactly once (fixes defect 12 for every client) | `inventory-authority.test.ts` |

**Remaining old-client limits.** Old clients have none of the conflict UI. Their rejected refunds appear only as rejected sync items, in their existing Settings list. They still normalize nothing on pull, so defect 8 persists on old clients until they update.

### 4.6 Refund-vs-refund, refund-vs-void, void-vs-void concurrency

All three cases are verified on real Postgres in `refund-integrity.test.ts`:

- **Two simultaneous full refunds:** exactly one accepted. 8 of 8 runs green; fails without the lock.
- **Refund and void at the same moment, 5 rounds:** exactly one wins each round. Either the sale is voided and the refund is rejected (`REFUND_SALE_VOIDED`), or the refund stands and the void is rejected (`VOID_HAS_REFUNDS`). Stock and lots are restored exactly once. With the void's lock removed, it **failed 3 of 3 runs**.
- **Two simultaneous voids:** stock restored once.

The mocked contract test asserts that the lock precedes both the sale read and the prior-refund read.

### 4.7 Conflicts survive store switching, full pulls and restart

- **Full pulls.** `preserveLocalOnlyRecords` keeps local refunds that are unsynced, conflicted or settled, plus local-only refund credits.
- **Restart.** Conflicts live in the persisted queue; settlements resume at startup.
- **Store switch.** `clearStoreData` first stashes the open conflicts per store: the ops, their refunds, local credits and settlement records (`stashMoneyConflictsForStore`, keyed by the store subdomain). The connect flow restores them after the store's pull (`restoreStashedMoneyConflicts`, `LoginScreen.tsx`).
- **Tested.** Switching to another store shows nothing of the first store's conflicts; switching back restores them. The same tests cover restart and full pull.

### 4.8 Rollback limits once new refunds exist

The migration is additive, but **code rollback is not free once this release has recorded data.**

**Safe at any time, data-wise.** The old code ignores the new columns, so no data is corrupted by the presence of `lineId`, `batchAllocations`, `exchangeRate`, `rateSource`, `refundVersion` or `saleLineId`.

**Rolling the cloud back re-opens the old defects:**
- over-refunds accepted again;
- voids of refunded sales double-restore stock;
- client allocations trusted again;
- absolute lot writes applied again;
- adjustments ignored again.

Refunds recorded under the new rules stay correct as history. New activity after the rollback is not protected.

**Credits.** Credits the new server created as `refund-credit:<id>` stay correct after a rollback. But an **old cloud plus old clients** will again accept a separate credit for a refund it rejected.

**After the hub release (1.0.49+) ships, the cloud must not be rolled back alone.**
- **Refunds.** New hubs push refunds with `saleLineId`, `exchangeRate` and `rateSource`. The old cloud's refund handler spreads the payload into Prisma with a client generated *without* those fields, so it raises "Unknown argument". New hubs' refunds would then fail to sync until the cloud is rolled forward again. They would not be lost, but they would be stuck.
- **Debt-refund credits.** The till no longer pushes the credit at all. The old cloud never creates it, so debt-refund credits from new hubs would be missing on an old cloud.

**So: before the hub release, cloud rollback is the normal "redeploy previous image". After it, roll forward instead.**

**Local data.** Settlement records, the refund journal and the conflict stash are new client-side keys. An older desktop build simply ignores them. Unsettled conflicts would then be invisible to that build, and its "Clear stuck" would delete them again.

**Schema rollback.** Not recommended. It would drop the line/lot history that refunds of existing sales depend on.

## 5. Rollout order

1. Back up the Railway database.
2. Deploy the cloud: API, SPA and migration `20261016120000_refund_integrity`, applied by `prisma migrate deploy` at start.
3. Verify the existing sync.
4. Publish the hub release.

The Electron hub applies the same migration at startup. Old hubs keep working against the new cloud: new columns are sent only to `x-titan-sync-schema: 2`, and old-client writes are handled per §4.5.

## 6. Known follow-ups (not in this sprint)

- `StockAdjustment` is unique per `(tenantId, adjustmentNumber)`, and the number is generated per device (`ADJ-00001`). Two devices' first adjustments collide; the second retries until dead. This is pre-existing.
- `refundNumber` is generated on the client; a collision makes that refund retry until dead. Pre-existing.
- Server void of a sale not yet on the server is still a no-op. Pre-existing.
- `reports.test.ts` "only one of two concurrent close requests succeeds" is flaky (1 of 5 runs in isolation). It is fully mocked and untouched by this work.

## 7. Tests

| Suite | Count | Proves |
|---|---|---|
| `refundAllocation.test.ts` (api + desktop) | 19 + 19 | Shared vectors; identical copies; mutation-checked |
| `apps/api/__tests__/sync.test.ts` | 11 refund/void contract tests | Lock order, ignoring client lots, limits, rate, legacy, void guard |
| `apps/api/__tests__/refund-integrity.test.ts` (real Postgres) | 12 | Persisted lots; exact repeated refunds; refund-vs-refund, refund-vs-void, void-vs-void; idempotent retry; legacy exception; debt credit once and old-client dedupe; rejected void keeps the debt; old-hub field gating |
| `apps/api/__tests__/inventory-authority.test.ts` (real Postgres) | 2 | Adjustments applied once with retries; absolute lot writes ignored |
| `apps/desktop/src/__tests__/refundIntegrity.test.ts` | 18 | Line ids, exact lots, rollback/restart, legacy, normalization, void guard; conflicts survive clear, pull, restart and store switch; manager + note + evidence; the four cash outcomes (drawer, counted refunds, cloud entries, audit); debt keep/reverse; idempotency, resume, rejected-entry retry; EN/AR parity |

Real-Postgres suites need `DATABASE_URL` pointing at a migrated **scratch** database.

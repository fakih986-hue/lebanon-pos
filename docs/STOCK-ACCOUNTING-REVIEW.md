# Stock and accounting changes: release review

Date: 2026-10-16. This review covers the stock and money changes only. The design work (Midnight Gold v2) is reviewed separately in `docs/design/DESIGN-REVIEW.md`, and none of its files change runtime behaviour.

**Status: local only.** Nothing has been pushed, deployed or published. Pushing `master` deploys production (Railway `lebanon-pos`), so it needs explicit approval.

**Related:** `docs/REFUND-INTEGRITY.md` holds the refund rules and the first pre-deployment review (§4.1–4.8). This document adds the second review round (items R1–R6 below), the complete migration list, and the mixed-version matrix.

---

## 1. What changes, by area

| Area | Change | Files |
|---|---|---|
| Refunds and voids | Server-authoritative, line-exact refunds. Lots are restored from the server's own record, at the original rate, with concurrency locks (REFUND-INTEGRITY-1) | `lib/refundAllocation.ts` (api and desktop copies), `routes/sync.ts`, `sales.service.ts` |
| Money conflicts | Server-rejected refunds and voids stay visible. Managers settle them as loss / recovered / not paid | `refundConflict.service.ts`, `MoneyConflictsPanel.tsx` |
| Inventory authority | `inventory/update` ignores absolute lot quantities; adjustments move stock, lots and the ledger once per adjustment id | `routes/sync.ts`, `inventoryBatch.service.ts` |
| Reference numbers (R1) | Refund, adjustment and count numbers are references, not identities. The unique indexes are dropped, and new numbers carry a device tag | migration `20261016130000_reference_numbers_not_unique`, `sync.service.ts` `getDeviceTag`, `sales.service.ts`, `inventoryAdjustment.service.ts`, `stockCount.service.ts`, `routes/sync.ts` (refund-credit lookup) |
| Tenant isolation, device (R2) | The store-switch stash, the refund journal and settlement records are bound to the immutable tenant id, never the subdomain. Interrupted refunds are resolved in their own store before a switch, and unsent work is kept per tenant | `sync.service.ts`, `sales.service.ts` |
| Tenant isolation, server (R5) | `/api/reports/*` no longer accepts `?tenantId=` from any caller. `images/generate-all` uses the body tenant only for platform-admin tokens | `routes/reports.ts`, `routes/image.ts` |
| Z-report (R5) | The close claims the shift first, inside one transaction. Expected cash is CASH only, plus cash in/out, the same formula as the desktop drawer | `routes/reports.ts` |
| Mixed versions (R6) | A refund's sync payload no longer carries the client-side rate fields, which an old hub cannot store | `sales.service.ts` `refundWirePayload` |

---

## 2. Review items

### R1. Cross-device number collisions: confirmed and fixed

**The defect.**
- Three numbers are generated offline on each device:
  - `refundNumber`: clock digits plus 2 random digits;
  - `adjustmentNumber`: a per-device counter, `ADJ-00001` on every fresh device;
  - `countNumber`: likewise, `COUNT-00001`.
- The schema had `@@unique([tenantId, …])` on all three.
- When a second device pushed its own legitimate `ADJ-00001`, the push hit the unique index. It came back as `status: "error"`, which is retryable, so it retried five times and went dead.
- The adjustment's stock, lots and ledger never reached the server.
- **Reproduced** on the unmigrated scratch database: `Unique constraint failed on the fields: (tenantId, adjustmentNumber)`.

**The fix.**
- **Identity is the immutable record id.** This is the client-generated primary key and was already the idempotency anchor.
- **The number is a human reference.** Migration `20261016130000_reference_numbers_not_unique` drops the three unique indexes and adds plain indexes in their place.
- **New numbers carry a device tag** so people can tell them apart: `R-7Q2K-LZ4M1B`, `ADJ-7Q2K-00001`, `COUNT-7Q2K-00001`. Old clients keep their old formats, and those are now accepted.
- **One lookup depended on uniqueness.** An old client's separate "Refund Credit" payment finds its refund by `<refundNumber> return for <saleNumber>`. It now matches refund number, sale number and customer together.

**Proof (real Postgres).**
- `old-client-adjustments.test.ts`: a second device's `ADJ-00001` and `COUNT-00001` are accepted and applied.
- `refund-integrity.test.ts`: two refunds with the same number on different sales are both accepted, and stock and lots are restored for each.

**Not fixed: the same pattern on other numbers.** Each is still unique per tenant and generated on the client.
- **`saleNumber`:** clock digits plus 2 random digits. By the birthday bound, a tenant has about a 50% chance of one collision somewhere in roughly 10,000 sales. A colliding sale would retry until dead, and its money would not reach the server.
- **`shiftNumber`:** `SHIFT-<n>` from the local shift count.
- **`expenseNumber`, `poNumber`:** clock digits only.
- **Why not fixed here.** Unlike refunds, `saleNumber` is also used as a lookup key: void deletes, debt links and refund references. Making it non-unique needs those lookups moved to ids first.
- **Recommendation:** a release blocker for multi-device stores. Do it as its own change.

### R2. Archived conflict data is isolated by immutable tenant identity: fixed

**Before.**
- The store-switch stash was keyed by `store:<subdomain>`, falling back to the API URL.
- A different tenant reusing the subdomain, on another server or after a rename, would have received the first tenant's conflicts, refunds and local credits.
- **A second defect, found while checking:** the refund crash journal (`lebanonpos.refund-journal.v1`) was not cleared on a store switch. On the next start, `recoverRefundJournal` would have rolled store A's interrupted refund back against store B's product and lot of the same id.
- **A third defect:** a store switch while offline silently deleted every unsent operation. No warning existed.

**Now.**
- **The tenant id comes from the server-issued token.** `setAuthToken` records it in `lebanonpos.tenant-id.v1`, and `getCurrentTenantId()` reads it.
- **Stash entries are keyed `tenant:<id>`, and the entry records its tenant.** Restore requires an exact tenant match. The subdomain plays no part.
- **An unknown tenant never restores automatically.** The entry is kept under an `unbound:` key and listed by `getStashedMoneyConflictSummary()`.
- **Interrupted refunds are resolved in their own store first.** `clearStoreData` runs `recoverRefundJournal()` while store A's data is still present. Any remaining journal travels inside A's stash.
- **Journal entries carry `tenantId`.** Recovery skips entries that belong to another tenant.
- **Settlement records travel in the same tenant-keyed stash.**
- **All unsent operations are stashed per tenant** and re-sent when the device returns to that tenant.

**Tests (desktop).** Four store-switch tests:
- the same subdomain on another tenant restores nothing, and a renamed subdomain on the same tenant restores everything;
- an interrupted refund never changes the next tenant's stock;
- an unknown tenant is kept, not restored;
- pending work returns only to its own tenant.

**Mutation check.**
- Collapsing the tenant key to a constant fails 2 of these 4 tests: the same-subdomain test and the pending-work test.
- Disabling the pre-switch recovery fails none of them, because the tenant-keyed stash also carries the journal. The two layers protect independently.

**Server side.**
- Every push and pull is scoped to `req.auth.tenantId` from the token, so a restored operation can only reach the tenant whose token sends it.
- Two endpoints let a caller choose another tenant; both are fixed (R5): `/api/reports/*` (any tenant user) and `images/generate-all`.

### R3. Legacy returned stock without lots: how it becomes sellable

**How returned legacy units are recorded.**
- A refund of a legacy line (one without a recorded lot) raises **product stock only**. No lot is invented.
- The ledger records the movement with note `UNALLOCATED_RETURN`.
- Reconciliation classifies the stock-versus-lots gap as `unallocated_return` and shows it as a warning, not a mismatch.

**Why checkout can sell these units.**
- The register's stock gate is product stock (`POSPage`: `product.stock <= 0` refuses), so the returned units count as available.
- **Till:** `consumeInventoryBatches` consumes open lots first-expiry-first and allocates any remainder as `legacy-stock`. That allocation is untracked and touches no lot.
- **Server:** the sale handler re-checks open lots first-expiry-first for any `legacy-stock` slice, so a stale till cache cannot leave real lots unconsumed. Only a true remainder is recorded as untracked (`batchId: null`).
- The aggregate decrement always applies, and no lot goes negative.

**Proof.**
- **Desktop.** Test: "lot-less returned stock is sold at checkout". It runs the register's own sequence: dry-run allocation, `buildSale`, consume, `recordSale`, decrease stock.
  - 5 units returned without a lot sell as one `legacy-stock` allocation.
  - Product stock ends at 0, and every lot stays ≥ 0.
  - The queued sale carries the untracked allocation.
- **Server (real Postgres).** Test: "a legacy refund's lot-less stock is an explained reconciliation exception…".
  - 6 units sell as 4 from the lot plus 2 `legacy-stock`.
  - Stock reaches 0 and the lot reaches 0.

**Remaining limit.** Untracked units have no expiry and no lot cost. Their cost is the product's fallback cost. A manager can attach them to a lot with a positive adjustment into a chosen lot, but nothing forces that.

### R4. Old clients still adjust stock correctly after absolute lot writes are blocked: proven

New suite: `apps/api/__tests__/old-client-adjustments.test.ts` (real Postgres).

**How the payloads were built.**
- Every payload is shaped exactly as `origin/master` (43230e3) builds it. That means:
  - `stock-adjustment-…` ids and per-device numbers;
  - allocation magnitudes with the sign taken from `quantityChange`;
  - a new `ADJ-…` lot for positive adjustments without a chosen lot;
  - and the old client's absolute lot-table push after it.
- Each case asserts product stock, the lot balance and the stock ledger.

**Results (8/8).**

| Case | Result |
|---|---|
| Negative adjustment (damage), then the old absolute lot push | Stock −3, lot −3, one ledger row −3; the absolute push changes nothing |
| Positive adjustment into a chosen lot | Stock +4; lot remaining +4 and initial +4; one ledger row |
| Positive adjustment without a lot | The client's new `ADJ` lot is created on the server with the units; stock +2; one ledger row |
| Expired lot | The `Expired` mark is accepted and the units stay in stock. The write-off adjustment removes them, and the emptied lot ends `Consumed`, matching the old client |
| Completed count (variance adjustment plus count session) | The variance is applied once; the count session is a record only |
| Retries (same op ×2, plus a new op with the same adjustment id) | Applied once; one ledger row |
| A second device's own `ADJ-00001` / `COUNT-00001` | Accepted and applied (failed before R1) |
| Ledger total | Opening + Σ movements = product stock |

### R5. The flaky `reports.test.ts`: test timing, plus three real defects found next to it

**The flake is a test bug.**
- The mocked test fires two closes with `Promise.all` and asserts that request **1** gets 200 and request **2** gets 409.
- Which request reaches the compare-and-set first is not deterministic, so it failed in 1 of 12 runs.
- The handler's close was already a compare-and-set (`updateMany where status = Open`).
- New real-Postgres proof (`z-report-close.test.ts`): **of 10 concurrent closes, exactly 1 succeeds**, and the stored close is the winner's.
- The mocked test now asserts the invariant: exactly one 200 and one 409. It passed 15 of 15 runs.

**Real defects next to it (each reproduced on the old handler, then fixed).**

1. **Cross-tenant read and close (security).**
   - All six `/api/reports/*` handlers used `req.query.tenantId || req.auth.tenantId`.
   - Any signed-in user of any tenant could read another tenant's reports and **close its open shift**. Reproduced: tenant B's token closed tenant A's shift, HTTP 200.
   - No client passes `tenantId`.
   - Fixed: always the caller's own tenant. `images/generate-all` had the same pattern, letting a tenant user overwrite another tenant's product images. The body tenant is now used only when the token has no tenant (platform admin).
2. **Wrong expected cash.**
   - The server Z-report subtracted **all** refunds, expenses and supplier payments, including card, wallet and debt-credit.
   - It ignored cash in and cash out.
   - The desktop drawer counts cash only. Reproduced: expected 163 where the drawer formula gives 197.
   - Fixed to the desktop formula.
3. **Close and totals were not atomic.**
   - Totals were computed before the close claim.
   - Now the claim comes first, inside one transaction, under the row lock. A losing request computes nothing.
   - **Limit:** a sale an offline device pushes after the close is not in the stored Z totals, which are a snapshot. It is still attributed to the shift by `shiftId`, and reports recompute from the rows.

The admin web Reports page is the only caller. The response gains `cashSupplierPayments`, `cashIn` and `cashOut`; no field is removed.

### R6. Separate review, migration and mixed-version compatibility

**Migrations in this release**, applied in this order by `prisma migrate deploy` on Railway, and by the Electron hub's raw-SQL runner at hub start:

| Migration | Kind | Can it fail on existing data? | Notes |
|---|---|---|---|
| `20261016120000_refund_integrity` | Additive: new nullable columns, `Sale.refundVersion` default 0, unique `(saleId, lineId)` | No. Existing `lineId` values are NULL, and NULLs are distinct | Existing rows are legacy lines |
| `20261016130000_reference_numbers_not_unique` | Drops 3 unique indexes and adds 3 plain indexes (`IF EXISTS` / `IF NOT EXISTS`) | No. Dropping uniqueness cannot conflict | Re-runnable |

**Verified on the scratch database.**
- Both migrations applied.
- `prisma migrate diff --from-database --to-schema --exit-code` reported no drift.
- The dev database `lebanonpos` and production were not touched.

**Mixed-version matrix.** "Old" means `origin/master` (43230e3).

| Writer → server | Works? | Why |
|---|---|---|
| Old desktop → new cloud or hub | Yes | Old sale, refund, void, adjust and count payloads are handled (R4, REFUND-INTEGRITY §4.5). Absolute lot writes are ignored. Old reference numbers are accepted |
| New desktop → new cloud or hub | Yes | Full rules |
| **New desktop → old hub** (a LAN till upgraded before its hub PC) | **Yes for sales and refunds**, with reduced protection | Refunds no longer carry `exchangeRate`/`rateSource`, which the old hub would reject as unknown columns; a test pins the refund and sale payloads to the old columns. The old hub applies its old, weaker rules (client allocations trusted) until it is upgraded. **Upgrade hubs before tills** |
| Old hub → new cloud (bridge) | Yes | New pull columns are sent only with `x-titan-sync-schema: 2`; the hub's pushes are old-client payloads |
| New hub → old cloud (cloud rolled back) | Mostly | Refunds sync, because the rate fields are no longer sent. **Debt-refund credits are missing**: the new till does not push them, and the old cloud does not create them. Do not roll the cloud back alone after the hub release; roll forward |
| Mixed numbers | Yes | Old `ADJ-00001` / `R-12345678` and new device-tagged numbers coexist; nothing looks them up as unique |

**Rollout order.**
1. Back up the Railway database.
2. Deploy the cloud: API, SPA, and both migrations.
3. Verify sync from an existing till.
4. Publish the hub release.
5. Upgrade hubs before the tills that connect to them.

**Rollback.**
- **Cloud, before the hub release:** redeploy the previous image. The data is readable by old code; the new columns and plain indexes are ignored.
- **Re-adding the unique indexes:** fails if duplicate numbers were accepted in the meantime. Do not; the old code does not need them.
- **After the hub release:** roll forward. The reasons are the debt credits above, and that an old cloud re-opens the refund defects.
- **Local keys:** new client keys (`tenant-id`, the stash, the journal) are ignored by older desktop builds.

---

## 3. Tests

| Suite | Result | Kind |
|---|---|---|
| API, all | 17 files, 270 tests, pass | Real-Postgres suites ran against the scratch DB `lebanonpos_refund_it` |
| `old-client-adjustments.test.ts` | 8 / 8 | Real Postgres (new) |
| `z-report-close.test.ts` | 3 / 3 | Real Postgres (new); on the old handler, 2 of 3 failed: cash arithmetic and cross-tenant close |
| `refund-integrity.test.ts` | 13 / 13 | Real Postgres (+1: duplicate refund numbers) |
| `reports.test.ts` | 15 / 15 repeated runs | Mocked (was 11 / 12) |
| Desktop, all | 21 files, 295 tests, pass | jsdom |
| `refundIntegrity.test.ts` | 24 / 24 | +6: tenant-identity store switch ×4, legacy checkout, wire payloads ×2 |
| Typecheck | `tsc` API and desktop: clean | |

---

## 4. Open before release

1. **Sale, shift, expense and PO number uniqueness** (R1, not fixed). This is a release blocker for multi-device stores. It needs id-based lookups first.
2. **A stashed "unbound" conflict has no UI yet.** It is kept and listed by `getStashedMoneyConflictSummary()`, but only diagnostics can see it.
3. **Production credential.** Removing the plaintext PIN from the docs does not invalidate it; it must be rotated by the owner (reported earlier).
4. **Approval needed for deployment**, per the rollout order above.

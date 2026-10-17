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
| Document references (R7) | Sale, shift, expense and PO numbers are references: unique indexes dropped **after** the one lookup that assumed uniqueness (debt ↔ sale) moved to ids. Device-tagged sequential references. Tenant guard on every id-keyed write | migration `20261017090000_document_references`, `routes/sync.ts`, `services/cloudSync.ts`, desktop `sync.service.ts` `nextDocumentReference`, `customer.service.ts`, `POSPage.tsx`, `security` / `expense` / `supplier.service.ts` |
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

**Same pattern on sale, shift, expense and purchase-order numbers:** fixed separately, see **R7**.

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

### R7. Sale, shift, expense and purchase-order references (release blocker): confirmed and fixed

**Generators.** As they were before this fix, copied exactly into `docs/evidence/reference-collisions.cjs`:

| Reference | Generator | What repeats it |
|---|---|---|
| Sale | `S-` + last 6 digits of the ms clock + a random 10–99 | Clock digits cycle every 1,000,000 ms (16 min 40 s). A repeat needs the same ms phase **and** the same random number. **This happens on one device too**, not only across devices |
| Expense | `EXP-` + last 6 ms digits | Same ms phase, with no random part |
| Purchase order | `PO-` + last 6 ms digits | Same as expense |
| Shift | `SHIFT-` + (this device's local shift count + 1) | Deterministic: two registers that open shifts before syncing both issue `SHIFT-043` |

**Collision evidence.** This replaces my earlier "about 50% within 10,000 sales", which was an unchecked estimate.
- Timing model: one store, events uniform over 08:00–22:00, ms resolution.
- The script reports a Monte-Carlo simulation (2,000 trials per row) next to the birthday closed form.

| Reference | Records (tenant lifetime) | P(at least one duplicate), simulated | Closed form |
|---|---|---|---|
| Sale | 1,000 | 0.4% | 0.6% |
| Sale | 5,000 | 11.8% | 13.0% |
| Sale | 10,000 | **43.0%** | 42.6% |
| Sale | 20,000 | 89.1% | 89.2% |
| Expense | 500 | 12.0% | 11.7% |
| Expense | 1,000 | 39.4% | 39.3% |
| Purchase order | 1,000 | 39.5% | 39.3% |
| Shift | 2 registers opening before sync | certain | n/a |

A duplicate is not cosmetic. Under the tenant-wide UNIQUE index, the second record's push failed with `P2002` and was classed "error", so it retried until dead. **Reproduced on the unmigrated scratch database: 8 of 8 new tests failed.**

**Lookups that assumed a sale number identifies exactly one record.** Fixed before any uniqueness was dropped:

| Where | Before | Now |
|---|---|---|
| Server void (`sync.ts`) | Deleted **every** DebtSale with the void's sale number, even when the sale was not on the server | Deletes the debt of **this** sale (`saleId`). An unlinked older row is deleted only when it is the single match for number + customer (+ total), and never when the sale is unknown |
| Server debt delete gate | "Is the sale voided?" was checked on `findFirst` by number, which could be another sale | Checks this debt's own sale by id. An unlinked debt is kept while **any** sale with its number and customer is live |
| Server delete by number only (old clients) | `deleteMany` by number | Deletes only when exactly one unlinked debt has that number |
| Hub cloud bridge (`cloudSync.ts`) | Deleted a sale by number when the deletion had no id | Only when exactly one sale has that number |
| Desktop pulled deletions (`sync.service.ts`) | Matched id **or** number, so it deleted every local record sharing the number | Id when present; number only when no id was sent |
| Desktop void (`reverseDebtSale`) | "The first debt with that number" | This sale's debt by `saleId`; an unlinked row only as the single number + customer match |

**Display-only.** Shift, expense and PO numbers are not lookup keys anywhere: API, desktop, admin, owner, driver, ordering. Shift attribution uses `shiftId`, with a time fallback. Admin search by sale number is a substring search, unaffected.

**The link.**
- DebtSale gains `saleId`, the immutable link.
- The migration backfills it **while the unique index still exists**, so each debt resolves to at most one sale, and only when the customer matches too.
- Verified on the scratch DB before and after: a linkable debt was linked; a customer mismatch and a missing sale stayed NULL.
- Clients do not send `saleId`, because a hub on the previous release would reject the unknown column. The server derives it from number + customer, only when exactly one sale matches.
- Pull endpoints return `saleId` only to `x-titan-sync-schema: 2` clients.

**New references.**
- `nextDocumentReference` issues `S-7Q2K-000123`, `SHIFT-7Q2K-042`, `EXP-7Q2K-00012`, `PO-7Q2K-00034`.
- They are sequential per device and carry the device tag (the last 4 characters of the device id), so staff can tell registers apart.
- The counter survives store switches. If it is lost, it reseeds from local records, so a device never repeats itself.
- Historical references are untouched.

**Tenant scope (found while testing).**
- **The defect.** Every id-keyed handler upserts by `id` alone: shift, expense, debt, purchase order, and others. On the old code, tenant B's push carrying tenant A's shift id **overwrote tenant A's shift**: opening float 9,999, number "HIJACK".
  - Ids are random UUIDs, so this needs a leaked id.
  - It is still a cross-tenant write.
- **The fix.** Before any write, an id that belongs to another tenant is rejected (`TenantScopeError`, never retried).
- **Fail-closed (follow-up review).** An earlier version compared tenants only when the owning row's tenant was readable, to accommodate a mocked row. That was a fail-open. The guard now refuses any existing row whose tenant is not the caller's, including one with no readable tenant; the incomplete mocks were fixed instead (`sync.test.ts`: refund retry, duplicate sale, received lot), and a unit test pins the fail-closed rule.
- **Coverage.** The guard now also covers `staff` (a cross-tenant push could have changed a person's role) and inventory `receive` (an array payload the per-operation check did not see; its metadata update is now tenant-scoped).
- **Proof.** `apps/api/__tests__/tenant-scope.test.ts` (real Postgres, 14): for shift, expense, customer, supplier, staff, debt sale, debt payment, purchase order, supplier payment, cash movement, daily close and delivery order, a foreign push is rejected with the row unchanged, and the owner's retry is applied once. Also covered: foreign shift close, debt delete, sale void and sale re-create; foreign adjustment and received-lot rewrite; owner retries with no double stock movement. Mutation checks: disabling the guard fails all 14, the receive check 1, and the staff mapping 1.

**Proof.**

| Test | What it shows |
|---|---|
| `apps/api/__tests__/document-references.test.ts` (real Postgres, 9) | Same-number sales from two devices both accepted, both move stock, and a retry applies once. Concurrent same-number pushes both succeed. Voiding one of two same-numbered debt sales removes only its own customer's debt. An old client's debt (no `saleId`) is linked and voided correctly. An old client's debt delete is gated on its own sale. An ambiguous legacy debt is never removed by the other sale's void. Duplicate `SHIFT-001` / `EXP-…` / `PO-…` accepted, with retries applied once. Cross-tenant overwrite and void refused. `saleId` is gated in pulls |
| Mutation checks | Disabling the tenant guard fails the tenant test. Restoring number-based debt deletion fails 3 tests |
| `apps/desktop/src/__tests__/documentReferences.test.ts` (5) | Sequential, tagged and per-device references; survives a store switch and reseeds; a void reverses only its own debt; the wire payload omits `saleId`; an id deletion never removes same-number records |

**Not addressed.** The server-generated delivery `orderNumber` uses a count + 1 with a random suffix, under a unique index. It is generated on the server, so concurrent orders contend there; the random suffix makes a clash unlikely. It is not an offline-client path.

### R6. Separate review, migration and mixed-version compatibility

**Migrations in this release**, applied in this order by `prisma migrate deploy` on Railway, and by the Electron hub's raw-SQL runner at hub start:

| Migration | Kind | Can it fail on existing data? | Notes |
|---|---|---|---|
| `20261016120000_refund_integrity` | Additive: new nullable columns, `Sale.refundVersion` default 0, unique `(saleId, lineId)` | No. Existing `lineId` values are NULL, and NULLs are distinct | Existing rows are legacy lines |
| `20261016130000_reference_numbers_not_unique` | Drops 3 unique indexes and adds 3 plain indexes (`IF EXISTS` / `IF NOT EXISTS`) | No. Dropping uniqueness cannot conflict | Re-runnable |
| `20261017090000_document_references` | Adds `DebtSale.saleId` (nullable) and backfills it **before** dropping the sale/shift/expense/PO unique indexes; adds plain indexes | No. The backfill matches at most one sale while uniqueness still holds | Re-runnable (`IF NOT EXISTS` / `IS NULL` guard) |
| `20261017120000_sync_operation_applied_at` | Adds `SyncOperation.appliedAt` (nullable) and backfills it for rows in `Pending`/`Synced` (R8) | No. Additive column, one `UPDATE` | `Failed`/`Rejected` rows stay NULL on purpose (they mix processing failures with forwarding failures) |

**Verified on the scratch database.**
- All four migrations applied; `20261017120000_sync_operation_applied_at` also applied to a separate `cloud_it` schema used by the hub→cloud forwarding test.
- **Correction:** the "no drift" check reported in the previous round used a wrong flag name. The command printed its help text and exited 0, so it proved nothing.
- The check now runs correctly (`prisma migrate diff --from-url <scratch> --to-schema-datamodel prisma/schema.prisma --exit-code`): **"No difference detected", exit 0** — re-run after the R8 migration (2026-10-17): still no difference.
- The dev database `lebanonpos` and production were not touched.

**Mixed-version matrix.** "Old" means `origin/master` (43230e3).

| Writer → server | Works? | Why |
|---|---|---|
| Old desktop → new cloud or hub | Yes | Old sale, refund, void, adjust and count payloads are handled (R4, REFUND-INTEGRITY §4.5). Absolute lot writes are ignored. Old reference numbers are accepted |
| New desktop → new cloud or hub | Yes | Full rules |
| **New desktop → old hub** (a LAN till upgraded before its hub PC) | **Yes for sales and refunds**, with reduced protection | Refunds no longer carry `exchangeRate`/`rateSource`, which the old hub would reject as unknown columns; a test pins the refund and sale payloads to the old columns. The old hub applies its old, weaker rules (client allocations trusted) until it is upgraded. **Upgrade hubs before tills** |
| Old hub → new cloud (bridge) | Yes | New pull columns are sent only with `x-titan-sync-schema: 2`; the hub's pushes are old-client payloads |
| New hub → old cloud (cloud rolled back) | Mostly | Refunds sync, because the rate fields are no longer sent. **Debt-refund credits are missing**: the new till does not push them, and the old cloud does not create them. Do not roll the cloud back alone after the hub release; roll forward |
| New desktop debt sale → old hub | Yes | The debt payload omits `saleId` (pinned by a test); the old hub keeps its number-based link |
| Old hub ← new cloud pulls | Yes | `DebtSale.saleId` is sent only to schema-2 clients |
| Old client debt / void → new server | Yes | The server derives `saleId`; gates and deletions never use "some sale with this number" (R7) |
| Old and new references in one tenant | Yes | `S-48291177` / `SHIFT-001` and `S-7Q2K-000123` coexist; nothing treats them as unique |
| Mixed numbers | Yes | Old `ADJ-00001` / `R-12345678` and new device-tagged numbers coexist; nothing looks them up as unique |

**Rollout order.**
1. Back up the Railway database.
2. Deploy the cloud: API, SPA, and all migrations above.
3. Verify sync from an existing till.
4. Publish the hub release.
5. Upgrade hubs before the tills that connect to them.

**Rollback.**
- **Cloud, before the hub release:** redeploy the previous image. The data is readable by old code; the new columns and plain indexes are ignored.
- **Re-adding the unique indexes:** fails if duplicate numbers were accepted in the meantime. Do not; the old code does not need them.
- **Old server code over the new schema (R7):** the old void/debt handlers would go back to matching debts by number. That is harmless while numbers stay unique, but wrong for duplicates accepted after the migration. This is another reason to roll forward.
- **After the hub release:** roll forward. The reasons are the debt credits above, and that an old cloud re-opens the refund defects.
- **Local keys:** new client keys (`tenant-id`, the stash, the journal) are ignored by older desktop builds.

### R8. Sync durability, recovery and server deduplication (2026-10-17)

Device side (local storage, sync queue) and server side (push handler). Each item was reproduced or proven by a test that fails on the code before its fix.

| Area | Defect found | Fix |
|---|---|---|
| Sync queue persistence | A failed queue write was only logged; the operation was still pushed and reported as queued. A flush rewrote the queue from a snapshot taken before its network call, dropping operations queued meanwhile | Saved-or-not result, compaction, per-tenant acknowledgement ledger; nothing sent unless saved; flush merges onto the current queue |
| Money/stock writers | Business data could be saved with no operation on its way to the server | Operations staged before the write (sale, void, refund, adjustment, lot receive, PO, supplier payment, expense, cash movement, debt sale/payment/reversal), committed after; recovery releases exactly once |
| Partial writes | A staged operation was discarded when its final record was missing, even if lots or stock had changed | Business journal for checkout, void and stock adjustment: one commit point each; complete if recorded, compensate if not, block (shown, held) if the figures match neither |
| Store switch | An unfinished entry was settled on return against wiped data; a committed sale's operation could be discarded | Unfinished entries are blocked at the switch; never settled automatically against replaced data |
| Ledger | Random movement ids; void and positive adjustment recorded no movement; a reversal was written even when the original was not | Fixed ids per record (`mv-sale-*`, `mv-void-*`, `mv-<adjustmentId>`); completed once, reversed only if written |
| Close by hand | Inventory permission alone, a one-line summary, and release with effects unresolved | Preview of every effect (before / now / will be) and outcome; `sales.void` + `inventory.adjust` (+ `customers.manage` for debt) for a sale or void; effects resolved before release; stale or unresolvable previews refused |
| Hub write-through checkout | A sale committed on the hub with a lost answer could be rung again under a new id after "hub down" or a reload | Pending hub sale saved first: the same cart re-sends the same sale; a different cart is held until the earlier one is settled |
| Hub attempt in flight | A "not committed" answer cleared the pending sale while its original request could still land; a different cart was then charged too (reproduced: two sales) | The attempt (`wt-<saleId>`) is settled on the hub terminally: `POST /api/sync/checkout-attempt/:opId/cancel` takes the push's claim lock and answers `committed` (it waits if the original is applying) or `cancelled` (recorded; a later push of it is refused, `CHECKOUT_CANCELLED`). `GET …/checkout-attempt/:opId` answers `open` while unresolved, which settles nothing. The till keeps the pending sale per store (reload, store switch) until resolved, blocks a different cart, and shows a POS banner with "check with the hub" |
| Server dedupe | "Applied" and "forwarded" were one status; concurrent duplicates raced, one failure rewrote the applied row as Failed (never forwarded), once a wrong balance | `appliedAt` separate from forwarding status; claim (`INSERT … ON CONFLICT` + `FOR UPDATE`) in the applying transaction; the failure path never touches an applied row |
| Operation id reuse | An id already applied was acknowledged whatever it now carried | Same entity, action and payload (key-order independent) required, otherwise `OPERATION_ID_REUSED` |
| Lot receive resend | An existing lot's "metadata" update rewrote its quantities | Existing lots take metadata only |
| Debt | Random debt ids; plain enqueue | Debt id derived from the sale; payments by id; staged |

**Coverage.** `syncDurability`, `debtDurability`, `businessJournal` (desktop, real services); `sync-dedupe` (real Postgres, hub and cloud on separate databases with the real bridge); `device-durability` (the desktop's own services against this API and Postgres: lost responses, restarts, store switches, hub checkout, void).

**Not covered by R8 (still plain enqueue, honest reporting only).** Customer create/edit/delete, shifts, daily close, stock counts, held sales, product catalogue edits. They report a storage failure instead of "queued", but their change is not staged.

---

## 3. Tests

| Suite | Result | Kind |
|---|---|---|
| API, all | 22 files, 323 tests, pass (2026-10-17) | Real-Postgres suites ran against the scratch DB `lebanonpos_refund_it` |
| `sync-dedupe.test.ts` | 6 / 6 | Real Postgres, hub + cloud (R8); against the previous handler: concurrent duplicates errored, once a wrong balance; id reuse acknowledged |
| `device-durability.test.ts` | 10 / 10 | Desktop services → real API → Postgres (R8); hub checkout: 2 extra sales without the fix. Race: the original request held before / after its claim while status is queried and a replacement checkout cancels; one sale and one stock deduction either way; reload and store switch keep the attempt. With "not found = gone" the late original commits a second sale |
| `old-client-adjustments.test.ts` | 8 / 8 | Real Postgres (new) |
| `z-report-close.test.ts` | 3 / 3 | Real Postgres (new); on the old handler, 2 of 3 failed: cash arithmetic and cross-tenant close |
| `refund-integrity.test.ts` | 13 / 13 | Real Postgres (+1: duplicate refund numbers) |
| `reports.test.ts` | 15 / 15 repeated runs | Mocked (was 11 / 12) |
| `document-references.test.ts` | 9 / 9 | Real Postgres (R7); 8 of them failed on the old code |
| Desktop, all | 373 tests, pass (2026-10-17) | jsdom |
| `syncDurability` / `debtDurability` / `businessJournal` | 13 / 1 / 16 | R8; each guard removed in turn fails its test |
| `documentReferences.test.ts` | 5 / 5 | R7 |
| `refundIntegrity.test.ts` | 24 / 24 | +6: tenant-identity store switch ×4, legacy checkout, wire payloads ×2 |
| Typecheck | `tsc` API and desktop: clean | |

---

## 4. Open before release

Fixed:
1. ~~Sale, shift, expense and PO number uniqueness~~ (R7).
2. ~~Hub write-through: a lost confirmation allowed a second checkout~~ (R8).
3. ~~Journal entries across a store switch; movement integrity; close-by-hand permissions and resolution; operation id reuse; server dedupe apart from forwarding~~ (R8).
3a. ~~Hub write-through attempt still in flight when the till asked: a different cart could also be charged~~ (R8, terminal attempt resolution; real-Postgres race test).

Open:
4. **Commercial-release blocker: shift, daily-close and stock-count durability.** These writers are not staged or journaled (R8, "Not covered"): a storage failure is reported honestly, but an interrupted write is not recovered and may never reach the server. Shifts and daily close carry cash figures; a stock count changes stock. Each needs the R8 treatment (staged operation, commit point, recovery, store-switch isolation) and a restart/retry test before a commercial release.
4a. **Other writers without staging**: customers, held sales, catalogue edits. Same honest reporting, no automatic recovery; not money or stock, so not listed as blocking.
5. **A stashed "unbound" conflict has no UI yet.** It is kept and listed by `getStashedMoneyConflictSummary()`, but only diagnostics can see it.
6. **Hub write-through, local finalize not journaled.** The in-flight race is closed (3a). After the hub commits, recording the sale on the till is not journaled; if it fails, the till refreshes from the hub (the hub owns the sale). A pending attempt also blocks a different cart for as long as the hub is unreachable; the cashier sees the banner and can retry.
7. **Legacy server rows** in `Failed`/`Rejected` have no `appliedAt`; their retries still rely on record-level idempotency (all money/stock handlers are idempotent by record id).
8. **Close by hand is a minimal form in Sync status** (no screen migration in this round).
9. **Genuine storage-full test on a device**: storage failures were simulated by failing writes.
10. **Production credential.** Removing the plaintext PIN from the docs does not invalidate it; it must be rotated by the owner (reported earlier).
11. **Approval needed for deployment**, per the rollout order above. The R8 migration must reach the cloud before hubs are upgraded (it is in the same `prisma migrate deploy`).

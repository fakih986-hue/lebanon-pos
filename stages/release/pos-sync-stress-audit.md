# Titan POS — Multi-Device Hub Sync Stress Test (POS-SYNC-STRESS-1)

**Date:** 2026-07-11

---

## 1. Verdict: **PASS WITH LIMITATIONS**

The core concurrency guarantees that matter most for a multi-device store — no duplicate sales, no double stock decrements, no lost or corrupted customer debt, correct idempotent retry, correct device-approval gating — all hold up under genuine concurrent load against a real Postgres database. One real, previously-undiscovered bug was found (product archive/restore sync always failed) and fixed. One narrow, non-corrupting limitation was found in concurrent batch/FEFO selection and is documented, not fixed, per instructions (would require redesigning client-side batch retry logic, which is out of scope for a surgical sync fix). Cloud-bridge push/pull was not re-verified in this pass — it was already verified live against production earlier this session and that verification is referenced rather than repeated.

---

## 2. Exact topology tested

This investigation used a **deterministic in-process harness** rather than spinning up separate OS processes/machines, per the sprint's explicit allowance ("if true multi-process test setup is too heavy, create a deterministic test harness that simulates multiple devices..."). Critically, it does **not** mock Prisma — every other test file in this repo mocks the database, which would make a concurrency investigation meaningless (it would only prove the mock behaves as told, not that real Postgres transactions/locking behave correctly). This is the first test file in the repo to run against a real database.

- **Database:** the real local dev Postgres (same `DATABASE_URL` as `pnpm --dir apps/api dev`), scoped entirely to one disposable, uniquely-generated test tenant created in `beforeAll` and fully deleted in `afterAll`. Never touches the `fakih` tenant or any other real data.
- **Server:** the real Express `app`, spun up on an ephemeral port via `http.createServer`, with `IS_LOCAL_SERVER=true` so device-approval gating and hub-specific logic are genuinely exercised (not bypassed).
- **Simulated devices:**
  - **Hub** — registered and paired as its own `Device` row (a real, confirmed requirement: `/api/sync/push` rejects with `DEVICE_ID_REQUIRED` if `IS_LOCAL_SERVER=true` and no `deviceId` is sent, with **no exception for the hub's own local writes** — this was an incorrect assumption in the first draft of this harness, corrected once discovered).
  - **Client A**, **Client B** — separate paired `Device` rows with distinct `deviceId`s, sending real concurrent HTTP requests to `/api/sync/push`.
- **Concurrency mechanism:** `Promise.all([...])` firing multiple real HTTP requests at the same server/database simultaneously — genuine interleaved transactions, not simulated timing.

File: `apps/api/__tests__/sync-stress.test.ts` (15 tests, all passing, run twice consecutively to confirm the harness itself is stable/repeatable and leaves no residue).

---

## 3. What was automated vs manual

**Automated (this pass):** device pairing/approval/revocation, concurrent sale creation, overselling protection, idempotent retry (sale/refund/void), concurrent customer debt, refund/void stock restoration, shift attribution, batch/FEFO concurrent consumption, offline-retry simulation.

**Not automated, referenced from earlier work this session:** cloud bridge push/pull to Railway (see Section 11), daily-close unsynced-warning UI behavior (client-side, already confirmed "pass" in the 2026-07-11 full platform QA audit).

**Not attempted:** true multi-machine/multi-process topology with real network latency and partial-failure conditions. The in-process harness exercises real database transaction semantics (the actual thing that would cause corruption) but not real network conditions (which would only affect *when* a retry happens, not *whether* the end state is correct).

---

## 4. Device pairing / access control results

| Check | Result |
|---|---|
| Unpaired device rejected | **PASS** — `403 DEVICE_NOT_APPROVED` |
| Pairing code generates and pairs a device | **PASS** |
| Both devices appear in device list | **PASS** |
| Approved device can sync | **PASS** (after the product-update fix below) |
| Revoked device rejected again | **PASS** — `403 DEVICE_NOT_APPROVED` |
| Hub itself requires pairing too | **CONFIRMED (design, not a bug)** — every push needs a `deviceId` when `IS_LOCAL_SERVER=true`, including the hub's own local writes. There is no "hub omits deviceId" path. |

---

## 5. Concurrent sales results

| Check | Result |
|---|---|
| Hub + Client A + Client B create 6 sales concurrently, no collisions | **PASS** |
| All 6 sale numbers unique | **PASS** |
| All 6 sale IDs unique | **PASS** |
| Final stock = starting stock − total quantity sold | **PASS** |
| Overselling protection (two devices concurrently demand more than available) | **PASS** — exactly one sale succeeds, the other is correctly rejected with `"Insufficient stock for ..."`, classified as **`rejected`** (non-retryable business conflict, `attempts` immediately maxed to 5) rather than `error` (retryable). This is a deliberate, well-designed distinction in `sync.ts` — confirmed correct, not a bug. |
| Final stock never negative | **PASS** |
| Duplicate push of the same sale id (idempotent retry) | **PASS** — no duplicate row, stock decremented exactly once |

---

## 6. Stock / batch results

| Check | Result |
|---|---|
| Concurrent sales sharing one product, final stock exactly matches total sold | **PASS** |
| Two devices concurrently allocate from the *same* inventory batch | **PASS, with a documented limitation** — the atomic conditional decrement (`quantityRemaining >= quantity`) guarantees the batch is never over-consumed (confirmed: final `quantityRemaining` never went negative, exactly one 3-unit consumption applied). **Limitation:** batch/FEFO selection happens client-side — if two devices independently pick the same "oldest open batch" before either has pulled the other's changes, the *losing* device's entire sale is rejected outright with `"Insufficient stock in batch ..."`, even in cases where overall product stock across *other* batches would have covered it. This fails safe (no corruption, no oversell — the cashier just retries), but is a real UX gap under multi-device FEFO contention. **Not fixed** — fixing it would mean redesigning the client to retry against a different batch on this specific rejection, which is a design change, not a surgical sync fix, and out of scope per instructions. |
| Transactional safety of the whole operation | **PASS** — confirmed `processOperation()` runs inside `prisma.$transaction(...)`, so a batch-allocation failure partway through correctly rolls back the earlier product-stock decrement in the same operation, not just the batch row. |

---

## 7. Customer debt results

| Check | Result |
|---|---|
| Client A debt sale + Client B debt payment + Hub debt sale, all concurrent | **PASS** — final outstanding balance (`sum(debtSales) - sum(debtPayments)`) computed correctly across all three concurrent writes from three different devices, matching exactly what the desktop client's own ledger math expects. |

Credit-limit *enforcement* behavior itself (blocking checkout client-side) was already verified correct in the 2026-07-11 full platform QA audit and was not re-tested here — this pass focused specifically on server-side concurrent-write correctness of the underlying ledger.

---

## 8. Refund / void results

| Check | Result |
|---|---|
| Refund restores product stock | **PASS** |
| Duplicate refund retry does not double-restore stock | **PASS** — idempotency guard (`saleRefund.findUnique` by id) confirmed working under a real duplicate push |
| Void guards against re-voiding an already-voided sale | **PASS** — sale status is `Voided` after the first void; stock restored exactly once regardless of a second void attempt on the same sale |

---

## 9. Shift / cash / register / device attribution results

| Check | Result |
|---|---|
| `shiftId`/`shiftNumber` correctly stamped on a sale created by a paired client device | **PASS** |
| `registerId`/`deviceId` persisted anywhere on transactional records | **CONFIRMED ABSENT, BY DESIGN** — queried `information_schema.columns` directly: no such columns exist on `Sale` (or any other transactional model). This is the intended end-state of the `registerId`/`deviceId` stripping fix made earlier this session (commit `dd3abfb`), not a regression discovered here. Per-register/per-device attribution for reporting lives entirely client-side and degrades after a full re-pull — already documented as a known limitation in the 2026-07-11 QA audit, unchanged by this pass. |

---

## 10. Offline / recovery results

| Check | Result |
|---|---|
| A write retried with the same operation id after a simulated "client didn't get the response" | **PASS** — no duplicate sale created, exactly one row exists after both the original attempt and the retry |

This exercises the same idempotency guard proven in Sections 5/6/8 — a device coming back online and retrying its queued operation (matching the desktop client's real `sync.service.ts` retry semantics) cannot create duplicate data as long as it reuses the same entity id, which the real client does.

---

## 11. Cloud bridge results

**Not automated in this pass**, for a concrete reason: this harness's `IS_LOCAL_SERVER=true` setting makes the local test server behave *as* a hub, but there is no second live server standing in for "the cloud" within this test environment — `cloudSync.ts`'s push/pull loops talk to `CLOUD_API_URL`, which would need to point at a real second deployment to test end-to-end here.

This exact code path was already verified live, for real, against production earlier this session:
- The hub-discovery proxy fix (`41bf311`/`d1e19c0`) was confirmed working via a direct curl against `pos.titan-suite.net/api/setup/discover`.
- The `registerId`/`deviceId` sync-payload fix (`dd3abfb`) was confirmed deployed and live via Railway deployment metadata (`git log`/`railway status` commit hash match).
- The sync-schema alignment fix (`7a7535d`) was built and tested (125/125 API tests at the time), though per instructions in that sprint it was **not deployed** — it exists only in the migration file and regenerated Prisma client, pending an actual `prisma migrate deploy` against Railway.

Given that live verification already happened and is documented in prior commits/reports, re-testing the cloud bridge here would be redundant rather than additive. **Recommendation:** before treating cloud sync as fully verified end-to-end for this specific session's cumulative changes, confirm the `7a7535d` migration has actually been applied to Railway (it has not, as of this report).

---

## 12. Failed / rejected sync items encountered during this investigation

All failures encountered were either (a) confirmed-correct rejections (the overselling and same-batch scenarios, Sections 5/6 — these are meant to fail, and did, with the correct classification), or (b) the one real bug below, now fixed. No sync item failed unexpectedly after the fix, across 15 tests run twice consecutively (30 total executions).

---

## 13. Bugs found

**1. Product archive/restore sync always failed (real, previously undiscovered bug).**

`apps/desktop/src/features/pos/services/product.service.ts`'s `archiveProduct()`/`restoreProduct()` (lines ~479-483, ~504-508) send a **partial** payload — `{ id, archived: true/false }` — directly via `enqueueSyncOperation`, bypassing `updateProduct()`'s full-object merge (which is what makes `toggleProductFavorite()` and other patches safe).

Server-side, `apps/api/src/routes/sync.ts`'s `case "product"` handled both `create` and `update` identically: an `upsert()` keyed on `(tenantId, barcode)`. Prisma validates **both** the `create` and `update` argument shapes up front (even though only one branch executes), so any payload missing required NOT NULL fields (`name`, `price`, `category`) throws `"Argument name is missing"` — **regardless of whether a matching row already exists.** Confirmed via isolated reproduction: `findUnique` on the exact same key succeeds, but `upsert` with the same key and a partial payload still fails.

This meant archiving or restoring **any** product, from any device, always failed to sync — the change stayed local-only forever, silently.

---

## 14. Fixes applied

**`apps/api/src/routes/sync.ts`** — split the `"product"` case's `create` and `update` actions:
- `action === "update"`: if the payload includes an `id`, do a real partial update (`db.product.updateMany({ where: { tenantId, id }, data: patch })`) instead of a full-shape upsert. Falls back to the barcode-keyed upsert only if no `id` is present (preserving existing behavior for any update path that genuinely doesn't know the server id yet).
- `action === "create"`: unchanged — still the barcode-keyed upsert/create-without-barcode logic, appropriate for genuinely new products.

**Verification:**
- `pnpm typecheck:api` — clean
- `pnpm typecheck:desktop` — clean (no desktop changes this pass)
- `pnpm test:api` (full suite) — **140/140 passing** (125 pre-existing + 15 new stress tests), including the existing mocked `sync.test.ts` suite (35/35, confirming no regression from the product-case restructure)
- `pnpm test:desktop` (full suite) — **101/101 passing** (unaffected, no desktop code changed)
- Targeted stress tests — **15/15 passing**, run twice consecutively to confirm repeatability and clean teardown

No desktop build was needed — this fix is entirely server-side (`apps/api`), and no desktop source changed in this sprint.

---

## 15. Remaining limitations

- **Concurrent same-batch FEFO selection** (Section 6) rejects the losing sale outright rather than gracefully retrying against a different batch. Fails safe, not corrupting, but a real UX gap for busy multi-register stores with tight-margin batch stock. Not fixed — out of scope for a surgical sync fix.
- **Cloud bridge** was not independently re-verified end-to-end in this pass (Section 11) — referenced from prior live verification this session instead.
- **The `7a7535d` sync-schema-alignment migration has not been deployed to Railway** — confirmed not yet applied there as of this report. It will self-apply on Railway's next boot (`setup.ts` runs `prisma migrate deploy` automatically), but "will self-apply on next boot" is not the same as "already live."
- **True network-level failure modes** (partial requests, connection drops mid-write, real multi-machine latency) were not exercised — only application-level concurrent-transaction correctness, which is the higher-value thing to verify for data integrity, but is not a complete substitute for a real LAN test with physical devices.
- Everything already documented as a known limitation in the 2026-07-11 full platform QA audit (register/device attribution degrading after full re-pull, purchase-order status never syncing, etc.) remains unchanged — this sprint did not revisit those.

---

## 16. Release recommendation

- **Safe for single-device stores:** Yes — unaffected either way; none of this sprint's findings touch single-device code paths.
- **Safe for multi-device LAN:** Yes, for the core flows that matter most (sales, refunds, voids, debt, stock, shift attribution) — all confirmed correct under genuine concurrent load, and the one real bug found (product archive/restore) is now fixed. The batch/FEFO limitation (Section 6) is a real gap worth fixing in a follow-up but does not block release — it fails safe.
- **Safe for cloud sync:** Contingent on deploying `7a7535d` to Railway first (not yet done, per Section 11/15) — the fix itself was already verified correct (125/125 tests) earlier this session, it just isn't live yet.

**No money/tax/tender/rounding logic was touched.** The one fix applied (`sync.ts`'s product-update handling) is unrelated to financial calculations — confirmed via `git diff` showing only the product upsert/update branching logic changed.

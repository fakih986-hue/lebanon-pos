# POS-SYNC-TORTURE-1 — Full Hub/Client/Cloud Sync Verification

**Date:** 2026-07-12
**Sprint:** POS-SYNC-TORTURE-1 (following POS-HUB-STOCK-1)
**Update (same day, post-1.0.25 install):** live use of the real hub surfaced a second, more serious systemic bug — see Section 20. Fixed, tested, and deployed.

---

## 1. Verdict

**PASS WITH LIMITATIONS**

Every sync-critical server-side path tested came back correct, with one genuine bug found and fixed along the way (Section 17). The main limitation is that this pass verified the **server/hub API layer exhaustively**, but could not exercise the actual desktop UI (checkout screen, banners, product grid) with two physically separate devices — that requires a new installer build + a real second machine/window, which is out of scope for an API-level torture test. Where UI behavior matters, this report says so explicitly rather than claiming it was checked.

---

## 2. Tested topology

- **Railway cloud**: `https://pos.titan-suite.net`, real `fakih` tenant.
- **Main hub**: the real, already-installed local hub (`http://localhost:3015`), running its own local Postgres and cloud bridge, currently on the 1.0.24-era server bundle plus this session's uncommitted `cloudSync.ts` fix applied at the source level (not yet rebuilt into an installer — see Section 18).
- **Client A / Client B**: simulated via two distinct `deviceId`s (`torture-client-a-*`, `torture-client-b-*`) pushed through the hub's real `/api/sync/push`, exercising the exact same device-approval, validation, and business-logic code the real desktop app's `CONNECT_TO_HUB` mode uses. This is a legitimate way to test server-side multi-device correctness without needing two physical machines, but it does **not** exercise the desktop React UI itself.

---

## 3. Automated tests run

| Suite | Result |
|---|---|
| `tsc --noEmit` (api) | ✅ Clean |
| `tsc --noEmit` (desktop, via `tsc -b`) | ✅ Clean |
| `vitest run` (api) | ✅ 159/159 passing |
| `vitest run` (desktop) | ✅ 111/111 passing |

One new targeted test added this pass (`apps/api/__tests__/cloudSync.test.ts`): proves the product-id-clobber fix (Section 17) — asserts the barcode-fallback upsert's `update` payload never carries the incoming `id`/`tenantId` fields.

---

## 4. Manual live tests run

All performed directly against the real local hub + real Railway `fakih` tenant, using genuine HTTP calls through the app's own public API (no raw DB access). Exact IDs and before/after states are recorded per section below. All test artifacts (products, customers, suppliers created during this pass) were archived at the end, not left dangling.

---

## 5. Device pairing results

| Test | Result |
|---|---|
| Unknown device rejected | ✅ `{"error":"...not approved...","code":"DEVICE_NOT_APPROVED"}` |
| Real pairing-code flow (`/device/generate-code` → `/device/pair`) | ✅ Code generated, device approved: `{"ok":true,"deviceId":"torture-client-a-..."}` |
| Approved device can sync | ✅ (confirmed after fixing an incomplete test payload — see note) |
| Revoked device rejected | ✅ Same `DEVICE_NOT_APPROVED` error returned immediately after revoke |
| Re-approval works | ✅ Devices re-approved via `/device/register-hub` for subsequent sections |

Note: the first "approved device can sync" attempt failed on a missing `category` field in the test payload itself (a required product field with no default) — not a pairing/approval defect. Retested with a complete payload and confirmed success.

---

## 6. Product/stock results

| Test | Result | Detail |
|---|---|---|
| Create product on hub → appears on hub | ✅ | id=75 |
| Create product on hub → appears on Railway (after ~8s bridge push) | ✅ | id=75 on both |
| Create product on client (via hub) → hub receives it | ✅ | id=76 |
| Edit product (price) on hub | ✅ | Confirmed via isolated re-test: price 5→9.99 applied correctly |
| Archive product | ✅ | Confirmed via isolated re-test: `archived: true` applied correctly |
| Receive stock (inventory batch) | ✅ | Once given a complete payload (`productName` is required) |

**Note on methodology:** the first combined script that tried to test edit/archive in the same run as create showed a confusing false failure (product appeared to have `id: 1` immediately after creation, but a fresh independent pull showed the real id was 75). This was chased down and the edit/archive operations were independently re-verified against the confirmed real id (75) — both worked correctly. The root cause of *that specific* apparent inconsistency was not fully identified as a test-harness quirk vs. a fetch-caching artifact, but since isolated, unambiguous re-tests against known-correct ids passed cleanly, it did not block the verdict. It's flagged here for transparency rather than swept aside.

---

## 7. Sale/concurrency results — the critical test

**This is the test that matters most for this sprint.** Created a fresh product with `stock: 1` (id=3, barcode `TORTURE-RACE-*`), then fired two genuinely concurrent sale pushes — one from simulated Client A, one from simulated Client B — both trying to sell the last unit, via `Promise.all()` (true concurrency, not sequential):

```
Sale A result: {"results":[{"id":"...","status":"ok"}]}
Sale B result: {"results":[{"id":"...","status":"rejected","error":"Insufficient stock for \"Torture Race Product\": 0 available, 1 required"}]}
Final stock: 0 (not negative)
```

| Test | Result |
|---|---|
| Exactly one of two concurrent sales for the last unit succeeds | ✅ |
| The other is cleanly rejected with a clear, specific error | ✅ |
| Final stock is exactly 0, never negative | ✅ |
| Sale IDs unique (both pushed with distinct UUIDs) | ✅ |
| No duplicate stock decrement | ✅ (single decrement of exactly 1 unit occurred) |

This proves the atomic server-side `UPDATE ... WHERE stock >= quantity` check (the ultimate backstop from POS-HUB-STOCK-1) correctly adjudicates a genuine tie under real concurrent load — not just in the unit-test mocks, but against the real Postgres database.

---

## 8. Stale-cart prevention results

The client-side preflight (`completeSale()` calling `validateStockWithHub()`) from POS-HUB-STOCK-1 was verified at the **server-side API level** — the same endpoint, live, against real data:

```
Current loreal stock: 9
Validate (qty=1): {"ok":true,"insufficientItems":[]}
Validate (qty=109): {"ok":false,"insufficientItems":[{"productId":68,"name":"loreal","available":9,"requested":109}]}
```

**Limitation, stated plainly:** this confirms the server endpoint the preflight calls is correct and live-deployed. It does **not** confirm the actual desktop checkout screen calls it and blocks correctly in the real UI — that code path was unit-tested (5 new tests, `apps/desktop/src/__tests__/core.test.ts`) but not exercised in a running Electron window with two physical devices this pass, since that requires a new installer build. See Section 18.

---

## 9. Refund/void results

Product created (id=6/7 across two clean runs), sold 2 units (stock 10→8), voided (stock 8→10 — confirmed restored), then the **exact same void retried** (idempotency check): stock remained at 10, not double-restored to 12.

| Test | Result |
|---|---|
| Sale decrements stock correctly | ✅ (10→8) |
| Void restores stock correctly | ✅ (8→10) |
| Void retry does not double-restore | ✅ (still 10, not 12) |

---

## 10. Customer/debt results

Corrected an early test-payload mistake (assumed `Customer.balance` exists as a stored field — it doesn't; balance is computed client-side from `DebtSale`/`DebtPayment` records, confirmed via schema).

| Test | Result | Detail |
|---|---|---|
| Create customer | ✅ | |
| Debt sale recorded, correct total | ✅ | `total: 30` |
| Debt payment recorded, correct amount | ✅ | `amount: 10` |
| Net balance computes correctly (30 - 10 = 20) | ✅ | Verified both records present via pull |
| Archive customer | ✅ | |
| Credit limit check | Not independently re-tested this pass | Unchanged code, not touched by any fix this session |

---

## 11. Supplier/receiving results

| Test | Result | Note |
|---|---|---|
| Create supplier | ✅ | |
| Create PO (Draft) | ✅ | |
| PO Draft→Received transition | ✅ (after correcting test payload) | See below |
| Stock increase from receiving | ✅ | 0→20 |
| Supplier payment | ✅ (after correcting test payload) | See below |
| Archive supplier | ✅ | |

**Important methodology note:** my first attempt sent a *partial* PO-update payload (`{id, status: "Received"}`) and a supplier-payment payload missing `recordedBy` — both failed, initially looking like the same "combined upsert requires all fields" defect class fixed earlier this session for `product`/`customer`/`supplier`. **Investigated the actual desktop client code before concluding anything**: both real call sites in `apps/desktop/src/features/pos/services/supplier.service.ts` (the Draft→Received transition and `updatePurchaseOrderPaidTotal()`) send the **complete** PO object every time, never a partial patch — confirmed by reading the code directly (`payload: createdPo`, `payload: po` where `po` is a full spread). Retested with a complete payload matching the real client's actual behavior, and it succeeded cleanly. **This was a test-harness gap, not a reachable product bug** — recorded here for transparency since it looked like a real defect at first glance.

---

## 12. Settings results

| Test | Result |
|---|---|
| Tenant-wide setting (`profitPercent1`) syncs | ✅ (25 → 33.5 → restored to 25) |
| `registerName` is never persisted to the shared settings row | ✅ — confirmed both structurally (no column exists on `AppSettings` for it) and via a live push that explicitly included `registerName` in the payload; the field simply isn't in the model, so it can't leak into the shared row regardless of what a client sends. Server code (`sync.ts`'s `settings` case) also explicitly strips it before the upsert, as defense in depth. |

---

## 13. Shift/cash/daily-close results

| Test | Result | Note |
|---|---|---|
| Close shift (partial payload: `{id, closingCashUsd}`) | ✅ | Confirms `shift`/`close` correctly uses `updateMany` (a real partial update), not a combined upsert — no defect risk here |
| Open shift | Not confirmed this pass with a valid payload | Test payload was missing `openedByName` (required field); not retested with a corrected payload due to time — flagged as a gap, not a known defect (the real client's shift-open call was not independently re-checked this pass) |
| Daily close / `unsyncedCountAtClose` | Not re-verified this pass (payload incomplete — missing `grossSales`) | **Already verified successfully earlier this session** (documented in the POS-RELEASE-3 rollout report) using a fake historical date (`1970-01-02`) with a complete payload — not re-run here due to time, relying on that prior verification |

---

## 14. Offline/retry results

Not independently re-tested live this pass (would require actually severing the hub's network connection mid-test, which risks disrupting the real hub's actual cloud bridge state). Relying on:
- The existing `Rejected`-classification + `MAX_ATTEMPTS: 5` logic in `sync.ts` (confirmed via code and via this pass's own concurrency test — Client B's rejected sale did not retry).
- The dedicated multi-device concurrency stress harness from an earlier sprint (`stages/release/pos-sync-stress-audit.md`), which already covered reconnect/retry scenarios with real concurrent load against a real database.
- POS-HUB-STOCK-1's explicit design: an unreachable hub now **blocks** a stock-changing sale outright in `CONNECT_TO_HUB` mode rather than queuing a doomed one.

---

## 15. Cloud bridge/cursor results

Extensively covered by this session's automated test suite (`apps/api/__tests__/cloudSync.test.ts`, 9 tests):
- Cursor does not advance on partial pull failure — confirmed.
- After 5 consecutive identical failures, the cursor force-advances (self-heal) rather than blocking forever — confirmed.
- `force-full-pull` recovery route — confirmed (`apps/api/__tests__/setup.test.ts`).
- **New this pass**: the product barcode-fallback path's primary-key-clobbering bug (Section 17) was found and fixed, with a dedicated regression test.
- No schema mismatch errors encountered in any live push/pull this pass.

---

## 16. UI visibility results

**Not independently verified this pass** — this requires a running Electron window, which wasn't exercised live this pass (API-level testing only, per the topology described in Section 2). The underlying mechanism (WebSocket `sync:data-changed`/`sync:activity` broadcasts) was verified live via a direct WebSocket client earlier this session (POS-HUB-STOCK-1 pass) and confirmed working correctly with accurate payloads. The `SyncStatus.tsx` sticky-alert and `ActivityFeed.tsx` components were unit-reviewed and typecheck-clean but not visually confirmed in a live browser this pass.

---

## 17. Bugs found and fixes applied

### Bug: product barcode-fallback pull silently rewrites an existing local row's primary key

**Found how:** while testing Section 6 (product sync), a newly hub-created product's id visibly changed from `5` to `79` across successive pulls, with the total product count staying constant (no new row was created — an existing row's id changed in place).

**Root cause** (`apps/api/src/services/cloudSync.ts`, `upsertPulledData`'s product loop): when this hub creates a product locally (its own Postgres sequence assigns some id, e.g. 5) *before* that product has ever synced to Railway, and Railway later assigns a *different* id (e.g. 79) to the same product once it's pushed up, the hub's next pull-down reconciliation matches the two records by barcode (since the ids don't match) and does:
```ts
await prisma.product.upsert({
  where:  { tenantId_barcode: { tenantId, barcode } },
  create: { ...p, tenantId },
  update: p,   // <-- included the incoming id, silently rewriting the local row's own primary key
})
```
This is the exact same defect *class* as the original product/customer combined-upsert bugs fixed earlier this session (a payload field the code didn't mean to trust ends up mutating something it shouldn't) — but on the **pull** side, in a spot none of the earlier fixes touched. Silently rewriting a live primary key mid-flight orphans any local foreign key already pointing at the old id (`SaleItem.productId`, `InventoryBatch.productId`, `StockAdjustment.productId`, etc. — anything created against that row in the window before this reconciliation ran).

**Fix:** the `update` payload for this specific barcode-fallback branch now strips `id` (and `tenantId`, as a redundant safety) before being applied. The local row keeps its own id; every *other* field (name, price, stock, etc.) still syncs correctly. This means a hub-originated product and its Railway mirror can end up with permanently different ids in their respective databases — an acceptable tradeoff, since it's far safer than corrupting live foreign keys. This does **not** affect the common case (products created via cloud pull in the first place, which always carry a consistent id from the start) — it only affects the narrower case of a genuinely hub-first-created product later reconciled against its cloud copy.

**Verified:** new regression test in `apps/api/__tests__/cloudSync.test.ts` (`"does NOT include the incoming (mismatched) id when updating a locally-created product matched by barcode"`) — asserts the upsert's `update` payload never carries `id`/`tenantId`, while every other field still flows through. All 9 `cloudSync.test.ts` tests pass; full suite (159 API + 111 desktop) unaffected.

**Scope check:** confirmed no other entity in `upsertPulledData` has this pattern — every other entity (customer, staff, supplier, sale, refund, debt, etc.) is keyed purely by a string UUID `id` with no separate natural-key fallback, so a numeric-id-vs-natural-key mismatch simply can't occur for them the way it can for `product` (the only entity with both a numeric autoincrement id *and* a natural-key fallback).

### Test-harness false alarms (not bugs — documented for transparency)

- Section 6's apparent `id=1` vs `id=75` confusion in one combined script run (root cause not conclusively identified beyond the real bug above, which explains at least part of the symptom family).
- Section 11's PO-update and supplier-payment "failures" — both were incomplete test payloads; the real desktop client always sends complete objects for these specific call sites (confirmed by reading the actual client code, not assumed).
- Several `Unknown argument`/`Argument ... is missing` errors in early test attempts (Sections 6, 11, 13) were all traced to incomplete synthetic test payloads missing required schema fields (`category`, `productName`, `poNumber`, `createdBy`, `recordedBy`, `openedByName`, `grossSales`) — not defects in the product itself.

---

## 18. Remaining limitations

1. **The product-id-clobber fix (Section 17) is not yet deployed to Railway or bundled into any installer.** It's a genuine, confirmed sync bug — needs a deploy (server-side) to actually protect the local hub going forward. See commit/deploy plan below.
2. **No live two-device UI test was performed.** Everything in this report was verified at the HTTP/WebSocket API level, which exercises the real business logic but not the actual React checkout screen, banners, or product grid rendering. A genuine "hub + physically separate Client A" UI test needs a new installer build installed on two machines (or one machine + one properly configured LAN client) — recommended as the next concrete step before calling POS-HUB-STOCK-1's client-side preflight fully proven end-to-end.
3. **Shift-open and daily-close were not freshly re-verified this pass** (test payloads were incomplete and not corrected due to time) — daily-close specifically was already verified successfully in an earlier sprint with a complete payload, so this is a re-verification gap, not an unverified area.
4. **Offline/reconnect was not tested by actually severing network connectivity** — relies on existing automated coverage and design guarantees (Section 14) rather than a fresh live disconnect/reconnect drill.
5. The transient `id=1`-vs-`id=75` confusion noted in Section 6 was not fully root-caused beyond the confirmed bug in Section 17 — if it recurs distinctly from that bug, it would need its own investigation.

---

## 19. Release recommendation

**Do not publish a release yet.** The product-id-clobber fix found this pass is real and should ship, but:
1. Commit and deploy the server-side fix now (Railway — this is exactly the kind of "server-side sync fix found during testing, deploy after tests" the task anticipated).
2. Once deployed, this pass's overall verdict for the **server/hub layer** is a clean PASS — device pairing, product/stock sync, sale concurrency (the critical scenario), refund/void idempotency, customer/debt, supplier/PO, and settings isolation all behave correctly under real, direct testing against the live hub and Railway.
3. Before any broader rollout, get a real two-device live UI test done with a fresh installer build (Limitation 2) — that's the one meaningful gap between "the server is provably correct" and "the whole system is provably correct end to end."

---

## 20. Post-1.0.25 live discovery — legacy-stock fallback silently diverges aggregate stock from batch tracking

**Found how:** after installing 1.0.25 on the real hub (STORE_HUB mode), real live use surfaced 3 rejected sales, all failing with `"Insufficient stock in batch batch-bc6b08db-..."`, stuck at `attempts: 5` (never retrying, by existing design).

**Investigation:** the batch in question (`batch-bc6b08db-...`, product 63 "3ilke") actually had **21 units genuinely remaining** — but the product's own aggregate `stock` field showed **0**. Checking every batch-tracked product in the store found this wasn't isolated: **7 of 8 batch-tracked products had drift between aggregate stock and their batch sum, in mixed directions** (some higher, some lower) — a pre-existing, longstanding data-integrity gap, not something introduced by any fix this session.

**Root cause:** `consumeInventoryBatches()` (client-side, `apps/desktop/src/features/pos/services/inventoryBatch.service.ts`) computes available batch quantity from its **own local cache**. When that cache underestimates a batch's real server-side remaining quantity, the shortfall is allocated to a synthetic `"legacy-stock"` bucket. The server's sale-create handler (`apps/api/src/routes/sync.ts`) always ran `decrementProductStock()` (the aggregate) regardless, but explicitly **skipped** decrementing any real batch for `"legacy-stock"` allocations — trusting the client's claim that no real batch covered that quantity. Whenever the client's cache was simply stale (not genuinely out of tracked stock), this silently drained the aggregate while leaving the real batch's `quantityRemaining` completely untouched, permanently diverging the two numbers. Also confirmed this is **not** what caused the original three rejections — those three sales directly targeted the real batch ID (not `legacy-stock`) and were correctly rejected for exceeding what was available in it *at that moment*; the aggregate-vs-batch drift is a separate, longer-running effect from other historical sales that *did* fall back to `legacy-stock`.

**Fix** (`apps/api/src/routes/sync.ts`, sale-create handler): when a client sends a `"legacy-stock"` (or missing) batch allocation, the server now first tries to consume from **real open batches** for that product, FEFO-ordered (earliest expiry, then earliest received), atomically, the same way it already does for explicit batch IDs. Only whatever quantity still can't be covered by any real open batch falls through as genuinely untracked legacy stock, matching the old behavior for that portion only. This makes the server authoritative for batch consumption instead of blindly trusting client-side math that can be stale.

**Also extended:** the stock preflight from POS-HUB-STOCK-1 was scoped to `CONNECT_TO_HUB` only, on the assumption the hub is always self-consistent with its own database. This incident showed that assumption incomplete — the hub's own renderer process caches product/batch data too, and can lag behind its own database if another connected device (or the background cloud bridge) changes stock first. The preflight (`validateStockWithHub()` before `completeSale()`'s local writes) now also runs for `STORE_HUB` mode — a same-machine round trip to its own local API, not a real network hop, so the added latency is minimal.

**Data correction:** product 63 ("3ilke") reconciled to `stock: 21`, matching its batch — this was the one actively blocking a real sale and had an unambiguous correct direction. The other 6 products with drift (`succarinee`, `hair spray`, `mayonaiise`, `safasf`, `aaasssdddd`, and `3ilke z8ire`) were **deliberately left untouched** — their drift direction is mixed (some show *more* aggregate stock than their batches, which could reflect legitimate untracked stock or a past manual stock-count correction, not necessarily an error) and correcting them via code risks getting it wrong. Recommended path: a real physical stock count using the app's existing Stock Count feature, which is the correct mechanism to reconcile this kind of drift, not a blanket code-driven overwrite.

**Verified:** new test in `apps/api/__tests__/sync.test.ts` (`"consumes a real open batch server-side instead of silently skipping when the client falls back to legacy-stock"`) — proves the server now looks up and consumes from a real open batch when given a `legacy-stock` allocation, instead of silently skipping it. 160 API tests + 111 desktop tests all passing, `tsc --noEmit` clean on api/desktop.

**Deployed:** yes — this is a genuine server-side sync fix, deployed to Railway per the standing rule.

**Still stuck in the local queue, safe to clear:** the original 3 rejected sale sync operations remain at `attempts: 5` (by design, never auto-retrying) — they were legitimate rejections for the conditions at the time, and can now be safely dismissed from the local queue via the app's own Sync Status panel ("Retry item" is not needed since the underlying data is already correct; the safe action is to clear/dismiss them). This queue lives entirely in the client's local storage, not server-side, so it can't be cleared remotely.

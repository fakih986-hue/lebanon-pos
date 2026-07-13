# POS-SYNC-A2Z-1 — Hub/Client/Inventory Sync Audit & Fix

**Date:** 2026-07-12
**Commit:** `fix: harden hub client inventory sync end to end`

---

## 1. Verdict

**PASS WITH LIMITATIONS.** Two real, code-confirmed bugs behind the reported live symptoms were found and fixed (with regression tests). The server/DB/sync-queue layer was verified directly and is correct (and was exhaustively covered by prior sprints: POS-SYNC-TORTURE-1 53/53, POS-SYNC-IDENTITY-1, POS-HUB-STOCK-1). **The definitive on-screen UI verification requires installing the new build (1.0.29) — the fixes are entirely in the desktop bundle, and this environment cannot observe the Electron/browser UI. All fixes are client-side; no Railway deploy was required.**

## 2. Current live bug diagnosis

**Symptom 1 — hub shows "si no barcode item" 4 left but blocks the sale.**
`SI No Barcode` (id 92) and `SI Live Dup Attempt` (id 91) are leftover **archived** test products from the sync-identity sprint. In the hub DB they are `archived=true` with stock 4, no barcode, no batches. `validate-stock` correctly returns unavailable **because they are archived**. Root causes:
1. **The POS sellable grid never filtered out archived products.** `usePosData`/`POSPage.filteredProducts` showed every product regardless of `archived`. Most archived items are also stock-0, so they slip by unnoticed (blocked by the stock check); but an archived item with *leftover stock* (like id 92, stock 4) passes the stock check and appears sellable — then correctly fails at the hub. **This is the direct cause.**
2. **The hub SPA never learned the products were archived** (a reload didn't fix it) — because the incremental pull can strand an update whose server timestamp lands just before the stored cursor, and nothing re-fetches it (reload resumes from the same cursor; only a full pull reconciles, which the SPA never did after initial connect).

The STORE_HUB preflight itself was **not** wrong — it correctly reported an archived product as unavailable. The block message ("Stock changed on another register") is misleading for an archived item, but with the grid fix the archived item never reaches checkout.

**Symptom 2 — receiving / remove-damaged-stock not reflecting on hub/other device.**
Same root cause as 1.2: stock/batch changes made on one device (or arriving via the cloud bridge) land in the DB correctly, but the *other* device's incremental pull can strand them past its cursor, so its on-screen stock stays stale until a full pull — which never happened automatically.

## 3. Hub sale false-block result

Not a false block on valid stock — the item was genuinely archived. Fixed the real defect: archived products are now excluded from the POS grid/scan/tabs, so a discontinued item can't be rung up. (Verified in the DB: id 91/92 are `archived=true`, stock 4, no batches; `validate-stock` returns unavailable for them.)

## 4. Receiving/damage propagation result

Server-side, receive and stock-adjustment operations correctly update `product.stock`, `InventoryBatch.quantityRemaining`, and record movements/adjustments, and enqueue the product-stock change (verified across prior sprints and by reading the receive/adjust handlers). The failure was **cross-device UI propagation** — the stranded-incremental-pull bug — now fixed by the reliable-pull changes below.

## 5. Full sync matrix results

Server/API layer (products incl. syncId & no-barcode, inventory/batches/FEFO/drift, checkout incl. write-through & concurrency, refund/void idempotency, customer/debt, supplier/PO, staff/shift/cash/daily-close, settings/registerName isolation) was verified directly in prior sprints (see POS-SYNC-TORTURE-1 §5–19, POS-SYNC-IDENTITY-1 §5, POS-SERVER-AUTHORITATIVE-CHECKOUT §5b) and re-confirmed healthy here (170 API tests). **The UI-refresh dimension across every domain is what this sprint fixed** — the fix is generic (all pulled entities benefit from reliable reconcile), so receive/damage/archive/price/etc. all now converge on every screen. Live per-domain UI confirmation is pending the 1.0.29 install (§9).

## 6. Bugs found

1. **Archived products shown as sellable in POS** (`usePosData` / grid had no `archived` filter). Direct cause of Symptom 1.
2. **Incremental pull strands updates** whose server timestamp is at/just-before the stored cursor; never re-fetched (reload doesn't help; only a full pull does, which the SPA never ran after connect). Cause of Symptoms 1.2 and 2.

## 7. Fixes applied (all client-side)

1. `product.service.ts` — new `getSellableProducts()` (excludes archived); `usePosData` uses it so the POS grid/scan/tabs never show archived products. Management/inventory views keep the unfiltered accessor (still see archived, e.g. to restore).
2. `sync.service.ts`:
   - **Startup/login now does a one-time authoritative FULL pull** (after flushing pending work) so a relaunch always reconciles local cache to the server and clears any stranded stale row.
   - **Incremental pull re-fetches a 3-minute overlap window** (`since = cursor − 3min`), so a change near the cursor / minor clock skew can't strand it; the by-id merge is idempotent.
3. `SyncStatus.tsx` — **"Sync now" is now a full authoritative pull** (was incremental): a one-tap force-correct for any stale stock/archived state.
4. `SyncBanner.tsx` (prior commit) — connected-offline shows a clear "Not connected to hub — stock sales are paused."

Data cleanup (not code): archived leftover test-artifact products (SI No Barcode/Dup, Seq Check, Vanish Check) so they stop cluttering the store; reconciled understated aggregate stock earlier (3ilke→5, 3ilke z8ire→6, mayonaiise→42).

## 8. Tests added

- `getSellableProducts` excludes archived products, **including an archived item with leftover stock** (the exact bug case). (desktop)
- Full suite green: **170 API + 118 desktop**; `tsc --noEmit` clean on api/desktop/electron.

## 9. Live verification evidence

- DB/API-level: confirmed id 91/92 archived with leftover stock; `validate-stock` returns unavailable; store now has only real active products.
- **On-screen UI verification is pending the 1.0.29 install** (this environment cannot see the Electron/browser rendering). After install, the expected results to confirm on the actual hub + client:
  - Archived items (SI No Barcode etc.) no longer appear in the grid.
  - Receiving stock / removing damaged stock on one device reflects on the other within the pull cycle (or immediately via WebSocket).
  - "Sync now" force-corrects any stale display.

## 10. Remaining limitations

- On-screen behavior not yet observed by me (build not installed); requires the pilot install to confirm end-to-end.
- Aggregate-vs-batch drift persists for several products where aggregate > batch (over-stated) — needs a physical Stock Count (deliberately not code-reconciled).
- DIRECT_RAILWAY tills remain on the optimistic checkout path (write-through scoped to CONNECT_TO_HUB).

## 11. New installer required?

**Yes — 1.0.29.** All fixes are in the desktop bundle (grid filter + pull reconciliation + Sync-now). Hubs/clients only get the fix after installing it. Build follows in POS-RELEASE-9.

## 12. Railway deploy?

**No.** No server-side code changed this sprint — every fix is client-side. Railway stays on `b58bb06`.

---

## 13. Follow-up incident — "sold stock reappears" (succarinee)

**Symptom:** hub sold succarinee "fully" → showed 0 → then reverted to 20; sold units reappeared.

**Diagnosis (from live data):** succarinee's aggregate was 20 but **all its batches were `Consumed` (0 remaining)** — over-stated drift. There was **no sale record** for the attempt and stock was unchanged at 20 on both hub and cloud → the sale had been **rejected server-side** (the batch behind the drifted aggregate was empty, so batch consumption failed and the transaction rolled back), while the hub had already shown optimistic "success / 0 left." So nothing was lost or double-counted — the DB stayed internally consistent; the confusing part was the optimistic-then-reverted UX. This is the deferred over-stated drift finally biting.

**Fixes:**
1. **Data (done, live):** with the user confirming batches are the truth, reconciled every **batch-tracked** product's aggregate down to its open-batch total — succarinee/cerave/loreal/hostage → 0, evian 41→31, safasf 40→39, aaasssdddd 24→23. Non-batch-tracked products (asfafasfa, Sakkooo — no batch records at all) were **left untouched** (their aggregate is the only stock record; zeroing would wipe real untracked stock). Bridges to cloud + pulls to clients automatically.
2. **Code (hardening):** extended server-authoritative write-through to **STORE_HUB** (commits to its own localhost API — instant, same-machine, always reachable — before finalizing). This eliminates the "optimistic success then silent revert" class: if a commit can't succeed (empty batch behind a drifted aggregate, genuinely out of stock), the sale is **not recorded** and the cashier sees a clear failure instead of a false success that later reverts. Uses the identical already-working push/deviceId path as existing hub sync (verified), so it adds no risk to the primary till. Requires a new installer (1.0.30). Still no Railway change.

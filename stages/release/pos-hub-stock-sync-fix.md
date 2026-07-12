# POS-HUB-STOCK-1 — Multi-Device Stock Sync & Stale-Sale Rejection Fix

**Date:** 2026-07-12
**Sprint:** POS-HUB-STOCK-1 — Fix multi-device stock sync and stale-sale rejection

---

## 1. Problem, as observed live

1. Hub sold an item to full depletion.
2. A second device connected to the hub (CONNECT_TO_HUB mode) did not see the sale/stock change immediately.
3. That device then sold the same (already-unavailable) item.
4. Its sync push failed server-side with `"Insufficient stock in batch ..."`.
5. The failed sync item remained — a real multi-device correctness gap, not a cosmetic bug.

---

## 2. Investigation — sale flow by connection mode

All three modes (`STORE_HUB`, `CONNECT_TO_HUB`, `DIRECT_RAILWAY`) share the exact same client-side checkout code path in `apps/desktop/src/features/pos/pages/POSPage.tsx`'s `completeSale()`:

1. `consumeInventoryBatches(...)` — **local-only**. Reads the device's own cached batch list (`getInventoryBatches()`), consumes FEFO-first, and — critically — **never blocks**: if requested quantity exceeds all local batches, it silently falls back to a `"legacy-stock"` allocation for the remainder and keeps going. There is no rejection path in this function at all.
2. `recordSale(...)` — writes the sale to local storage immediately (optimistic, offline-first).
3. `decreaseProductStock(...)` — decrements the device's own local product cache immediately, unconditionally.
4. `enqueueSyncOperation({ entity: "sale", action: "create", ... })` — queues the push to the server (hub or Railway depending on mode). This is async and can happen seconds later.

**Confirmed: local checkout ALWAYS "succeeds," regardless of real stock.** The only place stock is actually, authoritatively checked is server-side, at push time — in `apps/api/src/routes/sync.ts`'s `sale`/`create` handler:
- `decrementProductStock()` — atomic `UPDATE ... WHERE stock >= quantity` on the aggregate `Product.stock` field.
- A second, separate atomic check on `InventoryBatch.quantityRemaining` for whatever specific batch(es) the *client* chose to allocate against (based on its own, possibly-stale local batch list).

**This is the exact bug**: the aggregate stock check can pass (enough total units exist) while the *specific batch* the stale client chose is already exhausted by another device's sale — producing the batch-level rejection, well after the cashier has already completed the transaction on their screen.

### How clients learn of changes today
WebSocket (`ws://<hub-or-railway>/ws`), confirmed working (verified live earlier this session): the server broadcasts `sync:data-changed` after any successful push, and connected clients call `pullFromServer()` (incremental) in response — near-instant in practice. The gap isn't propagation speed; it's that a **stale window always exists** (even milliseconds), and the client never re-checks before completing a stock-changing sale.

### Where batch stock is checked
- Client: never (see above).
- Hub API / Railway API: yes, atomically, at push time — but only *after* the local sale is already recorded and the receipt already printed from the cashier's point of view.

### Why the second device allowed checkout after hub stock reached zero
Because nothing in the client-side checkout path ever asks anyone whether the sale is still fulfillable. It's a pure local write, always "succeeds," and only the async background sync discovers the truth — too late to stop the transaction.

---

## 3. Fix implemented

### Server: new preflight validation endpoint
`POST /api/sync/validate-stock` (`apps/api/src/routes/sync.ts`) — authenticated (JWT or cloud key, same as `/push`/`/pull`). Takes `{ items: [{productId, quantity}] }`, checks each against **live** `Product.stock` (and archived status) for the authenticated tenant, and returns:
```json
{ "ok": false, "insufficientItems": [{ "productId": 68, "name": "loreal", "available": 0, "requested": 1 }] }
```
Read-only — does not reserve or lock stock. The existing atomic server-side decrement at actual push time remains the ultimate backstop for the residual race between this check and the real sale.

### Client: preflight before checkout completes
`apps/desktop/src/features/pos/services/sync.service.ts` — new `validateStockWithHub(items)`, calling the endpoint above. Returns a typed result: `{ok: true}` or `{ok: false, reason: "unreachable" | "insufficient", insufficientItems?}`.

`apps/desktop/src/features/pos/pages/POSPage.tsx`'s `completeSale()` — now `async`. **For `CONNECT_TO_HUB` mode specifically** (per the requested scope), before any local write (`consumeInventoryBatches`, `recordSale`, `decreaseProductStock`, `enqueueSyncOperation`):
1. Calls `validateStockWithHub(cartItems)`.
2. If the hub is unreachable → **blocks the sale**, shows *"Cannot verify stock — hub unreachable. Sale blocked to prevent stock conflicts."* This is the explicit "offline risk mode not implemented yet, so block" behavior requested — an offline connected device cannot complete a stock-changing sale it can't verify.
3. If the hub confirms insufficient stock → **blocks the sale**, shows *"Stock changed on another register. Refresh cart. (loreal)"*, names the affected item(s), and triggers an immediate `pullFromServer()` so the product grid/cart reflect real numbers.
4. If confirmed available → proceeds with the existing checkout flow unchanged.

A new `isValidatingStock` state disables the checkout button for the brief validation window (typically well under a second on a healthy LAN) and shows "Verifying stock with hub…" — this is the only new latency introduced, and only for `CONNECT_TO_HUB` mode.

### Existing failed-sync-item handling (already correct, made clearer)
The classifier in `sync.ts` already treats both `"Insufficient stock for..."` (aggregate) and `"Insufficient stock in batch..."` (batch-level) messages as `Rejected` — these get `attempts: 5` immediately and are never retried, so there was never an infinite retry loop. What *was* wrong: the client-side toast (`apps/desktop/src/components/layout/SyncStatus.tsx`) said "Sale recorded" — misleading, since the server transaction fully rolled back. Fixed (this session, prior commit) to accurately say the sale went through locally but couldn't be saved server-side, flagging it for manager reconciliation, and to trigger an automatic re-pull so the local stock number self-corrects. This session's change additionally broadens detection to catch the batch-level message shape too (not just the aggregate one), so this now covers both rejection paths — the residual race window after the preflight, not just the pre-preflight scenario.

---

## 4. Tests added

**Server (`apps/api/__tests__/sync.test.ts`)** — `POST /api/sync/validate-stock`:
- Returns `ok:true` when every item has enough stock.
- Returns `ok:false` with per-item detail when a product ran out.
- Treats a product missing locally (deleted) as unavailable.
- Treats an archived product as unavailable even with nonzero stock.
- Returns 400 for a malformed request body.

**Desktop (`apps/desktop/src/__tests__/core.test.ts`)** — `validateStockWithHub`:
- Returns `ok:true` when the hub confirms stock.
- Returns `ok:false` with `insufficientItems` when the hub reports a shortfall.
- Treats a network failure as `unreachable`, never as a silent pass.
- Treats a non-OK HTTP response as `unreachable`, never as a silent pass.
- Returns `unreachable` immediately (without even calling `fetch`) when no API URL/token is configured.

All green: **158 API tests**, **111 desktop tests**, `tsc --noEmit` clean on api/desktop/electron.

---

## 5. Manual live verification

Performed directly against the real `fakih` tenant on Railway (server-side pieces, post-deploy):
- Confirmed `/api/sync/validate-stock` returns `ok:true`/`ok:false` correctly against live product stock.
- Confirmed the existing WebSocket `sync:data-changed`/`sync:activity` mechanism still fires correctly for sale/stock operations (verified earlier this session with a real WebSocket client).

**Full end-to-end client-side blocking behavior (the `completeSale()` preflight in the actual desktop UI) requires a new installer build** — this fix touches `apps/desktop`, which is bundled into the Electron app, not just the server. The server-side half is deployed and independently verified; the client-side half needs 1.0.25 built and installed on both the hub and a genuinely separate connected device to observe the full "sell on hub → other device blocked from stale sale" scenario in the real UI. Recommended as the immediate next step.

---

## 6. What was explicitly NOT touched

- Price, tax, tender, or LBP rounding logic — untouched; `cashChange.test.ts` (part of the 111 passing desktop tests) confirms no regression.
- Batch stock checks were not weakened — the atomic server-side batch decrement remains exactly as strict as before; the new preflight is an *additional* earlier check, not a replacement.
- No negative stock is permitted anywhere as a "solution" — the preflight and the existing atomic checks both still reject on insufficient stock.
- No error is hidden — rejected sync items keep their real error message; the toast now states it more accurately, not less.
- CASHOPS/HUB setup work from prior sprints (bootstrap verification, cursor self-heal, activity feed) — untouched, tests confirm still passing.

---

## 7. Remaining scope for full closure

- Requirement 3 from the task ("two clients try to sell the same final batch quantity — one succeeds, one gets a clear rejection, no failed-sync loop") is best proven with a genuine two-device live test once 1.0.25 is built and installed — the preflight substantially narrows the race window but a true simultaneous double-checkout race is not eliminable by a read-only preflight alone (the atomic server-side decrement is what actually adjudicates a true tie, exactly as intended — the preflight's job is to catch the common case where one device is simply stale, not to serialize genuinely concurrent checkouts).
- `DIRECT_RAILWAY` and `STORE_HUB` modes were intentionally left out of scope, per the task's explicit instruction to focus on `CONNECT_TO_HUB`. `STORE_HUB` *is* the source of truth for its own local DB, so the same race doesn't apply the same way; `DIRECT_RAILWAY` has a theoretically similar gap but wasn't part of the requested scope.

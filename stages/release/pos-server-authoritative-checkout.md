# POS-SERVER-AUTHORITATIVE-CHECKOUT — Hub-Authoritative Stock Checkout

**Date:** 2026-07-12
**Commit:** `fix: make connected stock checkout hub-authoritative`

---

## 1. Problem

A connected (CONNECT_TO_HUB) till completed sales **optimistically** — recorded locally first, synced to the hub afterward. The earlier stock "preflight" only *read* stock; it didn't reserve it and wasn't atomic. So between the read and the async push, another till (or a momentary disconnect) could invalidate the sale — it had already "completed" locally, and only the later push failed, surfacing as the "sale went through here but could not be saved… flag for a manager" toast. In short: a satellite till could sell against stale stock.

## 2. Architecture decision (approved)

Split consistency by need:
- **Stock-decrementing sales → strong consistency** (hub-authoritative, atomic).
- **Everything else → eventual consistency** (fast local + sync): non-stock/service items, pure debt payments, customer/product metadata, settings.

Per-mode:
- **STORE_HUB** — always sells locally; it *is* the authority and commits stock+sale atomically in its own Postgres. (Keeps a preflight against its own live stock so its UI doesn't attempt a doomed sale.)
- **CONNECT_TO_HUB** — stock-decrementing checkout is **server-authoritative write-through**: client → hub commits sale + stock atomically → client finalizes only after the hub confirms. Hub rejects → no sale. Hub unreachable after transient retry → no sale. **No offline stock sales from satellite tills.**

Rationale (from first principles): correctness for a shared mutable counter (stock) fundamentally requires a single authority doing an atomic decrement — no faster-and-equally-correct option exists. On a healthy wired LAN the round-trip is sub-perceptual, so "fast" is not the axis being traded; the only real cost is satellite availability during a *sustained* hub outage, which is the correct place to put the unavoidable CAP tradeoff.

## 3. Implementation

**Server (`apps/api/src/routes/sync.ts`):**
- The existing `/api/sync/push` sale-create handler already commits atomically (`UPDATE … WHERE stock >= qty`) and is idempotent by sale id — this is the authoritative commit.
- **New:** `GET /api/sync/sale-committed/:saleId` — returns whether a non-voided sale with that id exists. Used for the lost-ACK idempotency check (below).

**Client (`apps/desktop`):**
- `sync.service.ts` → `commitSaleToHub(sale)`: write-through commit with a **transient-retry window** (short timeout + one retry, ~2×1.2s) so a network blip is invisible; returns `committed | rejected | unreachable`. On exhausted retries it **confirms via `sale-committed` whether the sale actually committed before conceding** — so a committed-but-unacked sale is reported committed (finalized), never duplicated.
- `sales.service.ts` → split `recordSale` into pure `buildSale` + persist; added `finalizeCommittedSale` (persist a hub-committed sale locally without re-enqueuing); `recordSale` gained `{ id?, skipSync? }`.
- `inventoryBatch.service.ts` → `consumeInventoryBatches(items, { dryRun?, skipSync? })`: dry-run computes the allocation plan without touching local state (used to build the payload before commit); skipSync consumes locally for display without enqueuing.
- `POSPage.tsx` `completeSale` restructured: build the sale payload via dry-run → gate (STORE_HUB preflight *or* CONNECT_TO_HUB write-through commit) → finalize locally with enqueues suppressed when the hub already committed → `pullFromServer()` to reconcile authoritative stock. Rejected/unreachable → clear message, **nothing recorded locally, no doomed sync item.**
- `SyncBanner.tsx` → connected-but-offline now shows an **error**: "Not connected to hub — stock sales are paused until it reconnects" (was a misleading "saved locally").

**Idempotency / no double-sell:** the sale UUID is generated client-side up front; the hub commit is idempotent by that id (repeat = no re-decrement); on lost ACK the client checks `sale-committed` before allowing any re-ring.

**Real-time:** unchanged and still essential — a successful sale/refund/void/receive/adjust broadcasts `sync:data-changed` over WebSocket; other tills auto-reconnect and pull on reconnect, keeping their stock fresh so conflicts are rare.

## 4. Tests

**Server (`sync.test.ts`, +2):** `sale-committed` returns true for an existing non-voided sale (tenant-scoped, excludes Voided); false when none.

**Client (`core.test.ts`, +6):**
- `commitSaleToHub` → committed on hub ok
- rejected (no retry) on insufficient-stock
- unreachable after retries when network fails AND sale did not commit
- **LOST-ACK: committed (never double-sells)** when the push times out but `sale-committed` confirms it committed
- unreachable without calling fetch when no api url/token
- `consumeInventoryBatches` dry-run computes the plan without mutating batches or enqueuing

Totals: **170 API + 117 desktop tests passing**; `tsc --noEmit` clean on api + desktop + electron. Tender/tax/LBP math untouched; stock/batch validation not weakened; no negative-stock path.

## 5. Deploy / rebuild

- **Railway deploy:** required — the new `sale-committed` server endpoint is real server-side code. Reported in §5b.
- **Hub installer rebuild:** required to complete the rollout — the entire write-through client *and* the endpoint ship in the hub bundle, so CONNECT_TO_HUB tills only get the new behavior after the hub runs the new build. Recommended as the immediate follow-up (a 1.0.28 build), which also enables the live two-device verification.

## 5b. Live verification

Deployed to Railway as `b58bb06` (confirmed via `commitHash`); health `{"status":"ok"}`.

- **New endpoint live:** `GET /api/sync/sale-committed/definitely-not-a-real-sale-id` → `200 {"committed":false}`. The idempotency confirm-before-re-ring path is available server-side.
- **Underlying atomic + idempotent sale commit** (the authoritative decrement the write-through relies on) was already live-verified in POS-HUB-STOCK-1 and POS-SYNC-TORTURE-1 (two concurrent last-unit sales → exactly one commits, the other rejects, stock never negative).

**Server pieces are verified live.** The full client write-through behavior (block-on-reject, block-on-unreachable, finalize-on-confirm, lost-ACK no-double-sell) is exercised by the 8 automated tests and requires the hub installer rebuild (1.0.28) to observe end-to-end on the actual CONNECT_TO_HUB device UI — recommended as the immediate next step, together with a live two-device drill (two clients race the final unit; one commits, one is blocked *before* any local sale).

## 6. Scope notes / follow-ups

- **DIRECT_RAILWAY** devices were intentionally left on the existing path (this sprint scoped CONNECT_TO_HUB). They have the same optimistic characteristic against the cloud; the identical write-through (the code targets `getApiUrl()`, which for that mode is Railway) is a recommended follow-up if direct-cloud tills are used for stock sales.
- **Transient-retry window** is tuned to ~1.2s timeout × 2 attempts. Tunable via `COMMIT_TIMEOUT_MS` / `COMMIT_MAX_ATTEMPTS`.
- Rules honored: no tender/tax/LBP changes, no weakened stock/batch validation, no negative-stock workaround, no offline stock sales from satellites, no manifest, no GitHub release.

# Titan POS v1.0.35 Release Notes

**Date:** 2026-07-14
**Type:** Internal build — server-authoritative receiving, unsigned
**Bundles:** POS-SYNC-RECEIVE-1
**Deploy:** hub installer **and** Railway together (server behaviour change; no migration)

## Why this build exists
Makes the server `inventory/receive` handler authoritative for aggregate `Product.stock` and removes the trust-based `_stockUpdate` marker. The hub and Railway must move together: the new client no longer sends stock through `product.update`, so the server must supply the received quantity via the receive handler on both sides.

## What's new (since 1.0.34)
**Server:**
- `inventory/receive` now **increments `Product.stock` by the received quantity on the first creation of a batch** and records the Receive movement then. The stable client batch id is the idempotency anchor — a retry (batch already exists) does a metadata-only update and **never re-increments**.
- `product.update` **strips `stock` unconditionally** (the `_stockUpdate` exception is gone; the defunct marker is discarded, never trusted or persisted).

**Client (receiving):**
- New product → `product.create` sends `stock: 0`; the receive op supplies the quantity (local cache still shows the real stock immediately).
- Existing product → **metadata-only** `product.update` (price/cost/reorder/supplier/expiry) — no stock, no marker.

**Preserved:** setup/manual product creation (opening stock + Opening movement, no receive); sale/refund/void/adjustment/stock-count/reconciliation-repair; AUTHORITY-1 hub-authoritative protections; the reconciliation tool; the IA-1A/1B changes (Manager Shift tab, confirmations, Danger zone, labels). No new migration.

## Verification
| Check | Result |
|-------|--------|
| API / desktop / electron typecheck | PASS |
| API tests | 206/206 |
| Desktop tests | 118/118 |
| Real-Postgres smoke | PASS — existing restock +7 once; retry unchanged; new-via-receive = qty (no double); product.update stock ignored |
| Packaged API | server-authoritative receive (`stock:{increment}` + `recordStockMovementOnce("Receive")`), unconditional stock strip, AUTHORITY-1 (×8), 3 inventory routes |
| Packaged SPA (loaded asset) | RECEIVE-1 client ("details updated", no `_stockUpdate`), Manager Shift tab, Delivery/Driver confirms, Danger zone, "Apply adjustment" |

## Artifacts
| File | SHA-256 |
|------|---------|
| `Titan POS Setup 1.0.35.exe` | `9fd790acb8979b1c9e51d1c78c3d9b352674c26b87b1b004c31e7f5e37795d54` |
| `Titan POS 1.0.35.exe` (portable) | `beea540f2c2408f11a73072ca3c4a09beb26cc72e8ad3dd7f67f2aed025809f7` |

**Not published.** No GitHub release, no update manifest. Railway deployed from `origin/master` (server code; no migration).

_Known build-hygiene note:_ `copy-desktop-spa` accumulates orphaned old hashed SPA assets in `public/assets` (never loaded — `index.html` references only the current one). Harmless; a cleanup is a possible small follow-up.

## Install & acceptance test (hub + cloud)
1. Quit 1.0.34 (tray) → install `Titan POS Setup 1.0.35.exe` → relaunch. No new migrations, so startup is clean.
2. **Receive into an existing product** → hub `Product.stock` **increases by the received qty**; a batch is created; a Receive `StockMovement` exists.
3. **After sync**, the **cloud (Railway) `Product.stock` also increases** for that product.
4. **Retry / re-sync** does **not** double-increment.
5. **Receive a brand-new product** → its stock equals the received qty (not doubled).
6. **Edit a product's name/price** (generic metadata) → its **stock does not change**.
7. **Normal sale / refund** still adjust stock correctly.

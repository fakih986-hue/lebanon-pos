# Titan POS v1.0.31 Release Notes

**Date:** 2026-07-13
**Type:** Internal build — hub-authoritative inventory safety patch, unsigned
**Sprint:** POS-SYNC-AUTHORITY-1

## Why this build exists
Closes the remaining latent risk that stale cloud / cross-device data could resurrect or fail to update in-store stock. The store hub is now authoritative for live inventory; a normal cloud pull can no longer overwrite hub stock/batch quantities, and batch consumption now propagates to other devices via incremental sync.

## What's new (since 1.0.30)
- **Hub owns inventory quantities.** Normal cloud pull no longer applies `Product.stock` to existing products or `quantityRemaining`/`status` to existing batches. New products/batches still bootstrap from cloud.
- **Batch changes propagate across devices.** Added `InventoryBatch.updatedAt`; incremental pull now filters batches by `receivedAt` OR `updatedAt`, so a batch consumed by a sale is seen by other devices on the next pull (previously only on a full pull).
- **Explicit restore is the only overwrite path**, and it's blocked while local stock ops are pending/failed so un-pushed hub truth is never discarded.
- **Race-safe batch create** on pull (P2002 fallback) — replaces the previous atomic upsert without reintroducing a duplicate-key failure.
- Bundled migration `20260713120000_add_inventory_batch_updated_at` (additive) — applied automatically by the hub on first launch.

## Verification
| Check | Result |
|-------|--------|
| API / desktop / electron typecheck | PASS |
| API tests | 177/177 (+7 this sprint) |
| Desktop tests | 118/118 |
| Migration on populated DB | applied clean; `migrate status` up to date |
| Bundle contains fixes | PASS — migration dir, updated schema, `applyInventoryToExisting`, `skippedBatchCount`, P2002 fallback, `batchUpdatedFilter` all present in `bundle/index.cjs` |

## Artifacts
| File | SHA-256 |
|------|---------|
| `Titan POS Setup 1.0.31.exe` | `8b77e0df5a8e4168dcf55bd8209858ab562804fd16423874b3ee8019590fe5d7` |
| `Titan POS 1.0.31.exe` (portable) | `1210e7454da60fdc0da78806b9522923a50e37614cad0134d8eab2c3629a5103` |

**Not published.** No GitHub release, `latest.yml` is a local-only electron-builder artifact (not uploaded). **No Railway deploy** — the fix lives entirely in the hub build; Railway stays on `b58bb06`.

## Install & verify (hub first)
1. Quit 1.0.30 (tray) → install `Titan POS Setup 1.0.31.exe` → relaunch. Confirm the migration runs (hub startup log: `[migrations] applying 20260713120000_add_inventory_batch_updated_at`).
2. Sell the last unit on the hub → confirm the browser/client shows zero.
3. Receive stock on the hub → confirm the client sees the updated stock.
4. Damage/remove stock on the hub → confirm the client sees the reduction.
5. Refresh/reopen both → confirm stock never resurrects.

If all pass, we can then decide on a Railway deploy.

# Titan POS v1.0.29 Release Notes

**Date:** 2026-07-12
**Type:** Internal build — hub/client inventory sync hardening, unsigned
**Sprint:** POS-RELEASE-9 (ships POS-SYNC-A2Z-1 fixes)

---

## Why this build exists

Two live bugs (archived item showing as sellable on the hub; receiving/damage not reflecting across devices) were fixed in POS-SYNC-A2Z-1. All fixes are in the desktop bundle, so hubs/clients need this build.

## What's New (since 1.0.28)

- **Archived products excluded from POS** — `getSellableProducts()`; the sellable grid/scan/tabs no longer show archived (discontinued) items, even if they still carry leftover stock. (Direct fix for the "si no barcode item" false-block.)
- **Reliable pull reconciliation** — startup/login now does a one-time authoritative full pull; incremental pulls re-fetch a 3-minute overlap window so a change near the cursor / clock skew can't be stranded; **"Sync now" is now a full authoritative pull** (manual force-correct). Fixes stale stock/archived state that persisted even across a reload, and receiving/damage not reflecting on other devices.
- **Clearer offline banner** — "Not connected to hub — stock sales are paused until it reconnects."

## Verification

| Check | Result |
|-------|--------|
| API/desktop/electron typecheck | PASS |
| API tests | 170/170 |
| Desktop tests | 118/118 (incl. archived-with-stock excluded from sellable) |
| Bundle contains fixes | PASS — `getSellableProducts`, pull-overlap/startup-reconcile, and offline banner all present in packaged assets |

## Artifacts

| File | SHA-256 |
|------|---------|
| `Titan POS Setup 1.0.29.exe` | `ee70d72e61551a3d371e07e903cd450650273231b1ecbd7aab5defdfe1d5b640` |
| `Titan POS 1.0.29.exe` (portable) | `e342e225e186afc8de7176b092044fb4e0d73f205903a28ca7c6e46eeeae9079` |

**Not published.** No GitHub release, no manifest, **no Railway deploy** (no server code changed — Railway stays on `b58bb06`). Artifacts local only.

## Install & verify (both hub + connected client)

1. Quit 1.0.28 (tray) → install `Titan POS Setup 1.0.29.exe` → relaunch.
2. Confirm: `SI No Barcode` and other archived items no longer appear in the product grid.
3. Receive stock / remove damaged stock on one device → confirm it reflects on the other (and via "Sync now").

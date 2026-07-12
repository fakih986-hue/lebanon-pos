# Titan POS v1.0.26 Release Notes

**Date:** 2026-07-12
**Type:** Internal build — batch-drift fix + STORE_HUB preflight, unsigned
**Sprint:** POS-RELEASE-6 — Build installer with batch-drift and STORE_HUB preflight fix

---

## Why this rebuild exists

Real live use of the 1.0.25 hub install surfaced a systemic data-integrity bug: 3 sales rejected with `"Insufficient stock in batch X"`, and checking every batch-tracked product in the store found 7 of 8 had drift between aggregate `Product.stock` and their real batch data (mixed direction). Root cause: `consumeInventoryBatches()` falls back to a synthetic `"legacy-stock"` allocation when its local cache underestimates real batch availability — the server always decremented aggregate stock regardless, but silently skipped decrementing any real batch for that portion, permanently diverging the two numbers whenever the client's cache was simply stale.

Fixed and deployed to Railway as commit `27fba4e`. Part of the fix touches **desktop checkout behavior** (extending the stock preflight to `STORE_HUB` mode, not just `CONNECT_TO_HUB`) — this installer is what carries that half of the fix to where it matters.

## What's New (since v1.0.25)

- **Version bumped** 1.0.25 → 1.0.26.
- **Server-side fix** (`sync.ts`): when a sale's batch allocation is `"legacy-stock"` (or missing), the server now first tries to consume from real open batches for that product, FEFO-ordered, atomically — the same way it already handles explicit batch IDs. Only a genuinely uncoverable remainder falls through as untracked legacy stock. The server is now authoritative for batch consumption instead of trusting client-side math that can be stale.
- **Client-side fix** (`POSPage.tsx`): the stock preflight from POS-HUB-STOCK-1 (verify stock with the hub before completing a sale) now runs for `STORE_HUB` mode too, not just `CONNECT_TO_HUB`. The hub's own renderer caches product/batch data and can lag its own database if another connected device (or the background cloud bridge) changes stock first — this closes that gap. Same-machine round trip for STORE_HUB, minimal added latency.
- **Data correction:** product 63 ("3ilke") was reconciled to `stock: 21` server-side (matching its real batch) — the one case with unambiguous drift direction. The other 6 drifted products were deliberately left untouched; a real physical stock count (the app's existing Stock Count feature) is the correct way to reconcile those, not a code-driven guess.

## Verification Summary

| Check | Result |
|-------|--------|
| API typecheck (`tsc --noEmit`) | PASS |
| Desktop typecheck (`tsc -b`) | PASS |
| Electron typecheck (`tsc -p tsconfig.json --noEmit`) | PASS |
| API tests | 160/160 PASS |
| Desktop tests | 111/111 PASS |
| API bundle | PASS (2,301,806 bytes) |
| Electron package (NSIS + portable) | PASS |
| Bundled server fix confirmed | PASS — `touchedBatchIds` found in `apps/api/bundle/index.cjs` |
| Bundled client fix confirmed | PASS — `"Verifying stock with hub…"` found in the packaged app's SPA bundle (`resources/api/public/assets/*.js`) |

## Artifacts

| File | SHA-256 |
|------|---------|
| `Titan POS Setup 1.0.26.exe` | `07722064eb67fcf5b3eff393dab566116b12172134f1c9c5bed861070627ea5e` |
| `Titan POS 1.0.26.exe` (portable) | `383a871b9bfa970ccc0141780dcd8c9fbcdc463f123730ebc4a7690fd2f7eee3` |

**Not published.** No GitHub release, no update manifest (`latest.yml`), no new Railway deploy this pass (server-side fix already deployed as part of the prior sprint). Artifacts exist locally in `apps/electron/dist-v8/` only.

## Code Signing

Unsigned, same as all prior builds this cycle. SmartScreen warning expected — not a blocker for this internal rebuild.

## Known Issues (carried over, unaddressed this pass)

1. Unsigned installer → SmartScreen warning.
2. **6 products still have unreconciled aggregate-vs-batch drift** (`succarinee`, `hair spray`, `mayonaiise`, `safasf`, `aaasssdddd`, `3ilke z8ire`) — deliberately left untouched since the drift direction is mixed and a code-driven correction risks being wrong. Needs a real physical stock count to resolve properly.
3. A hub-originated product and its Railway mirror can still end up with permanently different ids in their respective databases (from POS-RELEASE-5) — a display/consistency quirk, not a data-loss risk.
4. No live two-device UI test has been performed for the STORE_HUB preflight extension specifically — verified via unit test and live single-hub API testing, not a full physical two-terminal drill.

## Release Decision Status

- GitHub release: **not published** (pending)
- Update manifest (`latest.yml`): **not published** (pending)
- Code signing: **not applied** (pending, non-blocking)
- Pilot install: recommended as the immediate next step — this build should replace 1.0.25 on the real hub

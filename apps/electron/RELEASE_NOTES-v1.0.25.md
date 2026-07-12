# Titan POS v1.0.25 Release Notes

**Date:** 2026-07-12
**Type:** Internal build — hub reconciliation fix, unsigned
**Sprint:** POS-RELEASE-5 — Rebuild Hub Installer With Sync Torture Fix

---

## Why this rebuild exists

`POS-SYNC-TORTURE-1` (a full live sync torture test across device pairing, product/stock sync, sale concurrency, refund/void, customer/debt, and supplier/PO paths) found a real hub-side reconciliation bug: `cloudSync.ts`'s barcode-fallback pull path was silently overwriting a locally-created product's own `id` with whatever id Railway had assigned to the same product — discovered live when a product's id visibly changed (5 → 79) across successive pulls with no new row created. This could orphan local foreign keys (`SaleItem.productId`, `InventoryBatch.productId`, `StockAdjustment.productId`) already pointing at the product's original local id.

Fixed and deployed to Railway as commit `e19992d` (inert there — this logic only runs on a hub's own cloud bridge, not on Railway itself, which doesn't run a bridge pointed at itself). **This installer is what actually carries the fix to where it matters: local hub installs.**

## What's New (since v1.0.24)

- **Version bumped** 1.0.24 → 1.0.25.
- **No other code changes.** This build re-bundles the server with the already-committed, already-deployed-to-Railway fix:
  - `e19992d` — the product barcode-fallback branch in `cloudSync.ts`'s pull reconciliation now strips `id`/`tenantId` from the update payload, so an incoming (mismatched) id from Railway can never silently rewrite a local row's own primary key. A hub-originated product and its Railway mirror may end up with permanently different ids in their respective databases — safer than corrupting live foreign keys.

## Verification Summary

| Check | Result |
|-------|--------|
| API typecheck (`tsc --noEmit`) | PASS |
| Desktop typecheck (`tsc -b`) | PASS |
| Electron typecheck (`tsc -p tsconfig.json --noEmit`) | PASS |
| API tests | 159/159 PASS |
| Desktop tests | 111/111 PASS |
| API bundle | PASS (2,300,679 bytes) |
| Electron package (NSIS + portable) | PASS |
| Bundled fix confirmed present | PASS — `_incomingId` destructuring found in `apps/api/bundle/index.cjs` |
| Smoke test — install/launch/version/health/setup-login/product sync | See Section below |

## Artifacts

| File | SHA-256 |
|------|---------|
| `Titan POS Setup 1.0.25.exe` | `fbc391a692771bf1ff88ede8ac874e18847a35dc31bcd7533883dedb56166a02` |
| `Titan POS 1.0.25.exe` (portable) | `b33201841a1042701c64b6cff8c618a840bf9e69e46efc14cab5bc4e8e0dd1fa` |

**Not published.** No GitHub release, no update manifest (`latest.yml`), no new Railway deploy this pass (the server-side fix was already deployed as part of POS-SYNC-TORTURE-1, prior to this rebuild). Artifacts exist locally in `apps/electron/dist-v8/` only.

## Code Signing

Unsigned, same as all prior builds this cycle. SmartScreen warning expected on install — not a blocker for this internal rebuild.

## Known Issues (carried over, unaddressed this pass)

1. Unsigned installer → SmartScreen warning.
2. A hub-originated product and its Railway mirror can end up with different ids in their respective databases (the safe tradeoff described above) — a display/consistency quirk, not a data-loss risk, and expected to be rare (only affects products created directly on a hub before ever syncing, not products that arrive via cloud pull in the first place).
3. `/api/sync/pull/full/staff` inconsistency (noted in earlier sprints) — not investigated further.
4. No live two-device UI test has been performed for this fix specifically (POS-SYNC-TORTURE-1 verified it via a unit-level regression test and live single-hub testing, not two physically separate installed clients) — recommended as the next step after this build is installed.

## Release Decision Status

- GitHub release: **not published** (pending)
- Update manifest (`latest.yml`): **not published** (pending)
- Code signing: **not applied** (pending, non-blocking)
- Pilot install: recommended as the immediate next step — this build should replace 1.0.24 on the real hub before any further multi-device pilot testing

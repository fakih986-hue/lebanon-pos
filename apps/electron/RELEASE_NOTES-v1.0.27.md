# Titan POS v1.0.27 Release Notes

**Date:** 2026-07-12
**Type:** Internal build — Product sync identity (hub client half), unsigned
**Sprint:** POS-RELEASE-7 — Build installer with Product.syncId architecture

---

## Why this build exists

POS-SYNC-IDENTITY-1 introduced `Product.syncId` — a stable cross-system identity so the same logical product is matched by a generated id (never by the fragile per-database numeric autoincrement) across hub, LAN clients, and Railway. The server half was deployed to Railway (`5677ff0`) and live-verified. This installer ships the **client/hub half**: hubs now emit `syncId` on product create, include it on update/archive, and thread `productSyncId` onto sale items and inventory batches. Until a hub runs this build it works via the backward-compatible legacy fallback but does not emit syncId.

## What's New (since v1.0.26)

- **Version bumped** 1.0.26 → 1.0.27.
- **Product sync identity (full POS-SYNC-IDENTITY-1 payload):**
  - `Product.syncId` schema column + `@@unique([tenantId, syncId])`, and the additive migration `20260712180000_add_product_sync_id` (applied on hub boot by the bundled migration runner). Numeric `id` stays the local PK + FK target.
  - Client generates `syncId` at every product-creation path; archive/restore/delete enqueues include it.
  - Sale items and inventory-batch receives carry `productSyncId`.
  - Server create/update/archive/delete match by `syncId` first (legacy id/barcode fallback); pull reconciliation adopts the incoming syncId and never overwrites the local numeric id; `resolveProductId` resolves child refs by `productSyncId` → id → barcode.
  - Cloud-authoritative backfill (runs only on Railway); hubs adopt cloud syncIds via pull.

## Verification Summary

| Check | Result |
|-------|--------|
| API typecheck | PASS |
| Desktop typecheck | PASS |
| Electron typecheck | PASS |
| API tests | 168/168 PASS |
| Desktop tests | 111/111 PASS |
| API bundle | PASS |
| Electron package (NSIS + portable) | PASS |
| Bundled API includes syncId schema/logic + migration | PASS (32 syncId refs; migration `20260712180000_add_product_sync_id` bundled; backfill + pull-adopt markers present) |
| Bundled SPA emits syncId/productSyncId | PASS (`productSyncId` present in packaged assets) |
| Local hub migration applies on boot | Verified during smoke test (see below) |
| Smoke test | See below |

## Artifacts

| File | SHA-256 |
|------|---------|
| `Titan POS Setup 1.0.27.exe` | `e7d8a53e3e557799a0e913db5ccbfec8365987f493ec4f12a4c1d3682cee2382` |
| `Titan POS 1.0.27.exe` (portable) | `f82a4b851bb5759acd1f71c5f29905a8b827c3e3e2786318e5f9aec7b2afb074` |

**Not published.** No GitHub release, no update manifest (`latest.yml`), no new Railway deploy this pass (the server-side sync-identity code was already deployed in POS-SYNC-IDENTITY-1). Artifacts exist locally in `apps/electron/dist-v8/` only.

## Code Signing

Unsigned, same as all prior builds this cycle. SmartScreen warning expected on install.

## Known Issues (carried over)

1. Unsigned installer → SmartScreen warning.
2. 6 products carry pre-existing aggregate-vs-batch stock drift (from earlier sprints) — reconcile via a physical Stock Count, not code.
3. `productSyncId` not yet threaded onto stock-count lines / delivery-order items (they resolve correctly via barcode/numeric fallback today) — optional POS-SYNC-IDENTITY-2 follow-up.

## Release Decision Status

- GitHub release: **not published** (pending)
- Update manifest (`latest.yml`): **not published** (pending)
- Code signing: **not applied** (pending, non-blocking)
- Pilot install: recommended next step — install on the hub to complete the sync-identity rollout so the hub emits syncId.

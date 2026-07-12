# Titan POS v1.0.28 Release Notes

**Date:** 2026-07-12
**Type:** Internal build — server-authoritative connected checkout, unsigned
**Sprint:** POS-RELEASE-8 — Build installer with server-authoritative connected checkout

---

## Why this build exists

POS-SERVER-AUTHORITATIVE-CHECKOUT made CONNECT_TO_HUB stock sales hub-authoritative (write-through) instead of optimistic-local. The server half is deployed to Railway (`b58bb06`, incl. the new `sale-committed` endpoint), but the entire write-through checkout lives in the desktop bundle — so installed hubs/clients on 1.0.27 still behave optimistically until they run this build. This installer ships the client half.

## What's New (since v1.0.27)

- **Version bumped** 1.0.27 → 1.0.28.
- **Server-authoritative (write-through) checkout for CONNECT_TO_HUB stock sales:**
  - Client commits the sale to the hub (atomic stock decrement) and finalizes locally **only after the hub confirms**. Hub rejects → no sale, no local record, no doomed sync item. Hub unreachable after a short transient-retry window → sale blocked with a clear message. No offline stock sales from satellite tills.
  - STORE_HUB continues to sell locally (it is the authority); non-stock / pure debt-payment sales keep the fast local path.
  - **Idempotency:** client-generated sale UUID; hub commit idempotent by id; on a lost ACK the client confirms via `GET /api/sync/sale-committed/:id` before allowing any re-ring — never double-sells.
  - Batch allocation dry-run (build the payload with no local mutation before commit); local finalize suppresses enqueues when the hub already committed, then pulls to reconcile authoritative stock.
  - Banner now clearly shows **"Not connected to hub — stock sales are paused until it reconnects."**

## Verification Summary

| Check | Result |
|-------|--------|
| API typecheck | PASS |
| Desktop typecheck | PASS |
| Electron typecheck | PASS |
| API tests | 170/170 PASS |
| Desktop tests | 117/117 PASS |
| Electron package (NSIS + portable) | PASS |
| Bundled SPA includes write-through pieces | PASS — `commitSaleToHub`/`sale-committed`, dry-run allocation, and updated "Not connected to hub" banner all present in packaged assets |
| Bundled API includes `sale-committed` endpoint | PASS |
| Smoke test | See below |

## Artifacts

| File | SHA-256 |
|------|---------|
| `Titan POS Setup 1.0.28.exe` | `977d84658aff08eb3eb8209db1cad6902fcb7a86296e7aa393f1507294dfa456` |
| `Titan POS 1.0.28.exe` (portable) | `bf3821db84cdfa4108ffe757847acaf5d2f2c73134c686e9f41476f55ec33627` |

**Not published.** No GitHub release, no update manifest (`latest.yml`), no new Railway deploy this pass (server-side already deployed as `b58bb06`). Artifacts local only.

## Code Signing

Unsigned. SmartScreen warning expected on install.

## Known Issues (carried over)

1. Unsigned installer → SmartScreen warning.
2. DIRECT_RAILWAY tills still use the optimistic path (write-through scoped to CONNECT_TO_HUB) — follow-up if direct-cloud tills sell stock.
3. 6 products carry pre-existing aggregate-vs-batch stock drift — reconcile via a physical Stock Count.

## Release Decision Status

- GitHub release: **not published** (pending)
- Update manifest: **not published** (pending)
- Code signing: **not applied** (pending, non-blocking)
- Pilot install: install on the hub AND at least one connected client to complete the rollout; then run the live two-device final-unit drill (one commits, one is blocked before any local sale).

# Titan POS v1.0.20 Release Notes

**Date:** 2026-07-11
**Type:** Internal build — bug-hunt rollup (POS-RELEASE-3), unsigned
**Sprint:** POS-RELEASE-3 — Build Installer With Latest Bugfixes

---

## What's New (since v1.0.19)

This build packages every fix made during the post-1.0.19 bug-hunting pass, so the already-tested code is actually distributable. Every fix below was found via targeted investigation (not a general audit), given its own test that was confirmed to fail without the fix and pass with it.

- **Purchase order Draft→Received transition never synced to the server** (`75a3d5d`) — `receiveAndRecord()` flipped the local PO to "Received" via a pure local-storage write with no sync side effect, so the server (and every other device) never learned the PO left Draft. Now enqueues a real sync update, matching the pattern `updatePurchaseOrderPaidTotal()` already used correctly for the Received→Closed transition.
- **`addCustomer()` skipped the license-suspension guard** (`9af8d6a`) — every sibling customer/debt mutation (archive, restore, delete, update, debt sale, debt payment) calls `assertCanWrite()` first; this one didn't, letting a suspended/read-only store keep creating customers when it shouldn't be able to write at all.
- **`detectDuplicateBarcodes()` double-counted the first product in 3+-way duplicates** (`bfaa3e8`) — inflated the "Dupes (N)" counter (display-only; the actual highlight/filter elsewhere was unaffected).
- **`stopPostgres()` referenced the wrong `pg_ctl.exe` path** (`4ad5dd4`) — built its own path under `USER_DATA` instead of reusing the already-correct `PG_BIN_DIR`/`pgExe()` helper used for `initdb`/`postgres`, so graceful shutdown always silently fell through to the SIGTERM/taskkill fallback. Verified live: closed the real packaged app via CDP and confirmed the log now shows `"stopped gracefully via pg_ctl"`.
- **Archived products still counted in "Active Products"/stock-value KPIs and reorder/dead-stock suggestions** (`f1b1b33`) — `getLowStockProducts`/`getNoBarcodeProducts` already excluded archived products; the KPI totals, `getReorderSuggestions`, and `getDeadStockItems` didn't. `getExpiryAlerts` was deliberately left alone — expiring archived stock is still useful to know about for disposal, unlike reorder/promo suggestions for something you've already decided to stop selling.
- **Cash-rounding disclosure never persisted on the Sale record** (`a11078e`) — the rounded-to-nearest-5,000-LBP cash payable amount was computed correctly live at checkout, but never saved anywhere (not on the client type, not in the sync payload, not on the server schema), so reprints and CSV exports always showed it blank. Added `Sale.payableLbp` (additive migration), wired it through checkout → sync → persistence. Also fixed a related bug found along the way: `SalesPage.tsx`'s rounding-badge check compared against a `sale.totalLbp` field that never existed, making it effectively just `Boolean(payableLbp)` regardless of whether any rounding actually happened — now computes the sale's real total using its own historical tender exchange rate.
- **Multi-device hub sync stress investigation** (`4d1846a`, `stages/release/pos-sync-stress-audit.md`) — built a real-database (non-mocked) concurrency harness simulating a hub + 2 client devices; confirmed no duplicate sales, no double stock decrements, correct idempotent retry, correct customer debt under concurrent writes, and correct device-approval gating, all under genuine concurrent load.
- **Version bumped** 1.0.19 → 1.0.20

## Verification Summary

| Check | Result |
|-------|--------|
| Desktop typecheck | PASS |
| API typecheck | PASS |
| Electron typecheck | PASS |
| Desktop tests | 106/106 PASS |
| API tests | 141/141 PASS (includes the real-database sync-stress harness) |
| Desktop build | PASS |
| API bundle | PASS (2,292,965 bytes) |
| Electron package | PASS |
| Migration additive-only | PASS — confirmed `20260711140000_add_sale_payable_lbp` is a single nullable `ADD COLUMN`, no drops/renames, no data loss |
| Migration applied (local dev DB) | PASS |
| Migration applied (fresh cold-start DB, packaged exe) | PASS — all 25 migrations, including this one, applied cleanly during a real packaged-app boot on a brand-new Postgres data directory |
| Local API startup (packaged exe, isolated profile) | PASS — `/api/health` 200 |
| Setup/activation window renders correctly | PASS — verified via CDP DOM inspection (title, password banner, form fields, correct server URL, dark `#0b0e14` background) rather than a desktop screenshot, since screen-capture on this shared machine risks capturing unrelated foreground content |
| Graceful shutdown (`pg_ctl`) | PASS — confirmed live via CDP-triggered window close: log shows `"stopped gracefully via pg_ctl"` |
| Legacy "tenantId and apiKey required" bug | Still fixed — confirmed via direct production API call (`pos.titan-suite.net/api/setup/discover`); got a legitimate "Incorrect PIN" response (PIN may have changed since earlier testing), not the old missing-key error |
| Commits | `75a3d5d`, `9af8d6a`, `bfaa3e8`, `4ad5dd4`, `f1b1b33`, `a11078e`, `4d1846a` (all local, not pushed — see below) |

## Code Signing

This build is **unsigned**. SmartScreen will show a warning on install. No change from prior builds — no code-signing certificate configured yet.

## Artifacts

| File | SHA-256 |
|------|---------|
| `Titan POS Setup 1.0.20.exe` | `f651b8b0873fec561cfefbefd8123f29146d148e667b2faeb230bdcfd93ec908` |
| `Titan POS 1.0.20.exe` (portable) | `9cccff5aaa28191c56029d0bb76e07371adf9379b9b9019f867785e42029a1e3` |

**Not published.** No GitHub release created, no update manifest (`latest.yml`) touched, no Railway deploy triggered, per this sprint's explicit instructions. Artifacts exist locally in `apps/electron/dist-v8/` only.

## Migration Status — Important

`20260711140000_add_sale_payable_lbp` has been applied to the local dev database and verified on a fresh cold-start database during this build's smoke test. It has **not** been applied to Railway — none of the 7 commits in this release have been pushed to `origin/master` yet (Railway is still running the older `768f8bb`, which predates even the previous sprint's `7a7535d` sync-schema-alignment fix).

Practical effect: the hub-side half of every fix in this release (all six bug fixes are desktop/Electron-only except `payableLbp`, which also touches the server) works correctly once this installer is installed on a hub, since the hub bundles and auto-applies its own migrations on boot. But a device connecting **directly** to Railway (`DIRECT_RAILWAY` mode) syncing a Cash sale with `payableLbp` would still hit the same "Unknown argument" class of error until Railway is deployed with this migration. No deploy was performed as part of this sprint, per instructions.

## Known Issues (carried over, not addressed this sprint)

1. `registerId`/`deviceId` still degrade to `'REG-001'`/`'unknown'` placeholders after a full re-pull for multi-register attribution — display-only limitation.
2. A residual LAN-toggle crash-handler race noted in the QA audit was actually fixed in a later sprint (`ffb8bed`) — see `RELEASE_NOTES-v1.0.18` history; no longer an open issue.
3. Concurrent same-batch FEFO selection (found during the sync-stress investigation) rejects the losing sale outright rather than gracefully retrying against a different batch. Fails safe, not corrupting, but a real UX gap for busy multi-register stores. Not fixed — would require redesigning client-side batch retry logic.
4. Unsigned installer → SmartScreen warning (unchanged from prior builds).
5. The dead Stock Movements ledger UI (recorded server-side, never displayed anywhere) remains unaddressed — a missing feature, not a bug, out of scope for a bug-fix pass.

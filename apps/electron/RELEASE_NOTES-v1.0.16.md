# Titan POS v1.0.16 Release Notes

**Date:** 2026-07-11
**Type:** Internal build — sync-schema fix (POS-RELEASE-2), unsigned
**Sprint:** POS-RELEASE-2 — Apply sync-schema fix to release build

---

## What's New (since v1.0.10)

This build rolls up every fix made across the 2026-07-11 QA audit and its follow-up passes. Requested report/sprint version references say "1.0.10" — that version was already superseded mid-session; this is the actual next release (1.0.10 → 1.0.16).

- **Cloud API key self-heal** (`31f51c3`) — legacy tenants with an empty `cloudApiKey` are backfilled automatically during authenticated PIN discovery.
- **Titan shield identity rebrand** (`41bf311`/`d1e19c0`) — replaced the old helmet/monogram/emoji identity with the real Titan shield mark across the desktop app, packaged app icon, and both Electron setup windows (loading + activation), matching the app's actual dark/gold brand palette.
- **Hub cloud-link discovery proxy** (`41bf311`/`d1e19c0`) — a hub's local Postgres is only ever a partial mirror; `/api/setup/discover` now proxies the full subdomain+PIN lookup to the authoritative cloud instead of only checking the local DB, so a hub with no local tenant data can still activate.
- **Sale sync payload fix** (`c21ab66`, then generalized in `dd3abfb`) — the desktop client attaches `registerId`/`deviceId` to sale/shift/expense/cash-movement/daily-close/purchase-order/supplier-payment sync payloads; none of those Prisma models had columns for them, so every sync of those entities threw "Unknown argument" and failed silently. Now stripped centrally in `processOperation()`.
- **LAN-toggle race condition fix** (`bbfab81`) — enabling/disabling LAN access killed the running API server and respawned it after a fixed 2s sleep; if graceful shutdown took longer, the new process hit `EADDRINUSE` and crashed ("Server crashed 3 times"). Now waits for the old process's actual exit event (10s fallback) before respawning.
- **Full A-to-Z platform QA audit** (`stages/release/pos-full-platform-qa-audit-1.0.10.md`) — 10-area audit across desktop POS, inventory, customers/suppliers, dashboard/accounting, staff/shifts, delivery/ordering, settings/setup, installer/packaging, website, and sync architecture. Found and fixed two additional bugs during the pass:
  - Driver edit login-code blanking (`apps/admin/src/pages/DriversPage.tsx`, commit `080f844`)
  - Website hero headline + em-dash mojibake (`apps/website/src/pages/HomePage.tsx`, commit `080f844`)
- **Sync-schema alignment fix** (`7a7535d`) — the same "Unknown argument" defect class recurred on three more entities:
  - `AppSettings.profitPercent1`/`profitPercent2` — added as real, persisted columns (genuine tenant-wide business settings, same category as `vatRate`/`deliveryFee`)
  - `AppSettings.registerName` — stripped before upsert (per-device label, not tenant data)
  - `DailyClose.unsyncedCountAtClose` — added as a real column (genuine audit-trail data)
  - `Customer.archived` / `Supplier.archived` — added as real columns (mirrors the existing `Product.archived` precedent)
  - Migration `20260711120000_align_sync_payload_schema` — additive-only (4 `ADD COLUMN` statements, all nullable or defaulted, no data loss).
- **Build process fix (this sprint)** — discovered that every installer build from 1.0.11 through 1.0.15 shipped a **stale, uncompiled `dist/main.js`** (last built before the rebrand/LAN-race fixes). `electron-builder --win` was being run without first running `tsc -p tsconfig.json`, so none of those Electron-side fixes actually reached any installed exe until this build. Fixed by explicitly compiling before packaging.
- **Version bumped** 1.0.15 → 1.0.16

## Verification Summary

| Check | Result |
|-------|--------|
| Desktop typecheck | PASS |
| API typecheck | PASS |
| Electron typecheck | PASS |
| Desktop tests | 101/101 PASS |
| API tests | 125/125 PASS |
| Desktop build | PASS |
| Website build | PASS |
| Admin build | PASS |
| Migration applied (local dev DB) | PASS — confirmed via direct DB query, auto-applied by `apps/api/src/setup.ts`'s `prisma migrate deploy` on API boot |
| Migration applied (fresh cold-start DB) | PASS — verified end-to-end: all 24 migrations, including `20260711120000_align_sync_payload_schema`, applied cleanly on a brand-new Postgres data directory during a real packaged-app boot |
| Local API startup (packaged exe) | PASS — confirmed via direct process launch + `/api/health` 200, on both a reused profile and an isolated fresh `--user-data-dir` profile |
| Setup/activation window branding | PASS — dark theme + Titan shield mark confirmed via window screenshot; full HTML/CSS content independently verified earlier via isolated Playwright rendering of the extracted template |
| Legacy "tenantId and apiKey required" bug | PASS — confirmed already fixed and live via direct production API test (`pos.titan-suite.net/api/setup/discover` returns a real key for the legacy `fakih` tenant) |
| Commits | `080f844`, `7a7535d` (both pushed — see repo `git log`) |

## Code Signing

This build is **unsigned**. SmartScreen will show a warning on install. No change from prior builds — no code-signing certificate configured yet.

## Artifacts

| File | SHA-256 |
|------|---------|
| `Titan POS Setup 1.0.16.exe` | `0bf76def9e435db98d517d97491a0b589db5fa481c4e78171690af26a83189b7` |
| `Titan POS 1.0.16.exe` (portable) | not separately hashed this pass — built alongside the installer in the same `electron-builder --win` run |

**Not published.** No GitHub release created, no update manifest (`latest.yml`) touched, per this sprint's explicit instructions. Artifacts exist locally in `apps/electron/dist-v8/` only.

## Migration Status — Important

The `20260711120000_align_sync_payload_schema` migration has been applied to:
- The local dev database (auto-applied via `setup.ts` on every API boot)
- A fresh, isolated test database (verified during this sprint's smoke test)

It has **not** been applied to Railway's production database. Since `apps/api/src/setup.ts` runs `prisma migrate deploy` automatically on every API boot, it will self-apply the next time the Railway service (or any hub install running this build) actually starts — no manual migration step is required, but **the fix is not live anywhere until that next deploy/install happens.** No deploy was performed as part of this sprint, per instructions.

## Known Issues (carried over, not addressed this sprint)

1. `registerId`/`deviceId` still degrade to `'REG-001'`/`'unknown'` placeholders after a full re-pull for multi-register attribution — display-only limitation.
2. Purchase order Draft→Received status transition still never syncs to the server.
3. A residual LAN-toggle crash-handler race noted in the QA audit (Section 8, Medium) — the module-level crash-restart handler can still treat a deliberate SIGTERM-triggered restart as a "crash" in rare cases. Not addressed this sprint.
4. Unsigned installer → SmartScreen warning (unchanged from prior builds).
5. Stale `1.0.8`/`1.0.10`-era build artifacts may still exist in `dist-v8/` from earlier testing — not cleaned up as part of this sprint (out of scope).

# POS-RELEASE-SYNC-1 — Align Local, Railway, and Release State

**Date:** 2026-07-14
**Goal:** make local repo, installed hub, Railway, and release docs coherent after AUTHORITY-1, 2A, and 2C.

---

## 1. Repository baseline
- Branch: `master`. HEAD before: `ab2047c` (1.0.33 build). Working tree: **clean**.
- Commit lineage present (oldest→newest):
  - `b84e25c` + `611e940` + `cdbad6d` — POS-SYNC-AUTHORITY-1 (+ 1.0.31 build)
  - `7697618` + `bce7342` — cloud-bridge loop fix + 1.0.32 build
  - `7ed08f0` — POS-SYNC-AUTHORITY-2A (record-only ledger)
  - `1e7ab42` — POS-SYNC-AUTHORITY-2C-0/2C-1 (initialize + reconciliation report)
  - `3f70dbc` — POS-SYNC-AUTHORITY-2C-2 (narrow repair)
  - `ab2047c` — 1.0.33 build
- No `.exe`/`dist-v8`/`.blockmap` artifacts tracked (only the intentional embedded Postgres binaries under `assets/pg/bin`).

## 2. Installer artifact verification (1.0.33)
- `Titan POS Setup 1.0.33.exe` and `Titan POS 1.0.33.exe` present in `apps/electron/dist-v8/`.
- `RELEASE_NOTES-v1.0.33.md` present; checksums recorded there (the tracked checksum record).
- **Recomputed SHA-256 == recorded** (match):
  - Setup: `bee2ef19bc6a40ce8aa0f91131c0c6fefeaeab285d07cf5a143b2b3fd96f7b81`
  - Portable: `836d3ea9c682ed4bb084e030642229649181c6d1955ec0ba9a3ea45de259a5e5`
- Bundled API (`apps/api/bundle`) contains: both migrations (`…_add_inventory_batch_updated_at`, `…_stock_movement_ledger_fields`), the 3 inventory routes (reconciliation / ledger-initialize / reconciliation-repair), the AUTHORITY-1 hub-authoritative guard (`applyInventoryToExisting` ×8), and the cloud-bridge loop fix.

## 3. Installed hub state
- Hub: **1.0.33 installed and accepted**.
- Ledger initialized (seeded 3 opening balances of 21 products; the rest already anchored).
- Reconciliation report: **0 error / 0 warn / 0 needs-baseline** — aggregate, batches, and ledger agree for all 21 products.
- No repair needed on the live store (0 flagged).

## 4. Railway deployment
- Before: `origin/master` = `bce7342` (1.0.32 — AUTHORITY-1 + cloud-bridge fix); Railway inventory route → **404** (behind by 2A/2C).
- Local `ab2047c` was **4 ahead / 0 behind** → clean fast-forward. New migration in this push: **exactly one**, `20260714120000_stock_movement_ledger_fields` (additive: 4 nullable columns + a non-unique index; the `updatedAt` migration already shipped with AUTHORITY-1).
- Action: **pushed `bce7342..ab2047c` to `origin/master`** → Railway auto-deploy.
- **Railway active commit: `ab2047c`** (auto-deployed from `origin/master`; confirmed live by the new routes appearing + the migration applying — Railway has no version endpoint, so state is confirmed behaviorally).
- Post-deploy verification (deploy settled ~2 min, no downtime — health stayed 200 throughout):
  - `/api/health` → **200**.
  - **Migration applied:** Railway runs `prisma migrate deploy` before serving; a failed migration aborts startup. The app serving the new routes ⇒ `20260714120000_stock_movement_ledger_fields` applied cleanly.
  - Inventory routes present: `/api/inventory/reconciliation`, `/ledger/initialize`, `/reconciliation/repair` all return **401** (route exists, auth required) — were **404** before.
  - **No sync regression:** `/api/sync/pull` (cloud bridge) → **200**, 42 products / 17 batches / 134 sales; all 17 batches carry `updatedAt` (AUTHORITY-1 intact).

## 5. Publish state (explicit)
- **No update manifest published.** **No GitHub release created.** **No installer artifacts pushed.** Version unchanged (1.0.33). No new installer built. AUTHORITY-2B not started.

## 6. Remaining limitations
- StockMovement ledger is **record-only** (not the source of truth) — 2B remains gated.
- StockMovement idempotency uses a **non-unique** index + app-level guard (unique constraint deferred to a data-verified step).
- Server-side strip of `stock` from product/update remains a separate, un-started defense-in-depth item (client already blocks direct stock edits).
- `balance` column is advisory (truth = sum of deltas).
- On-screen Electron UI verified by the operator; this environment verified at bundle/API/DB/test level + dev-API live smoke.

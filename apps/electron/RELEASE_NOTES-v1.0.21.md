# Titan POS v1.0.21 Release Notes

**Date:** 2026-07-11
**Type:** Internal build — installer rebuild after server bundle fix, unsigned
**Sprint:** POS-RELEASE-4 — Rebuild 1.0.20 Installer After Server Bundle Fix

---

## Why this rebuild exists

The previously built `Titan POS Setup 1.0.20.exe` was packaged **before** commit `cd716e4` (the product-create sync fix from the 1.0.20 rollout cleanup). That installer bundles `apps/api/bundle` directly into the app (`apps/electron/package.json` → `extraResources`), and the same `sync.ts` route also serves the **local hub's own LAN sync endpoint** — not just the Railway cloud bridge. That means any hub installed from the original 1.0.20 artifact would still carry the old, unfixed product-create handler locally, even though Railway itself was already patched.

**The previous 1.0.20 artifact was confirmed installed on a real hub during this session's rollout**, so per the "if there's any chance it was distributed, bump the version" rule, this rebuild ships as **1.0.21**, not a re-tagged 1.0.20.

## What's New (since v1.0.20)

- **Version bumped** 1.0.20 → 1.0.21 (`apps/electron/package.json`), to disambiguate from the already-installed, pre-fix 1.0.20 artifact.
- **No other code changes.** This build exists solely to re-bundle the server with the already-committed, already-deployed-to-Railway fix:
  - `cd716e4` — `sync.ts`'s `product`/`create` handler now strips the client's local, hub-scoped `id` before insert, so the database's own sequence always assigns the real id. Previously, an explicit client id could collide with an unrelated existing row (bypassing `nextval()` entirely), causing `Unique constraint failed on the fields: (id)` both on Railway and, latently, on any local hub.

## Verification Summary

| Check | Result |
|-------|--------|
| API typecheck (`tsc --noEmit`) | PASS |
| Desktop typecheck (`tsc -b`) | PASS |
| Electron typecheck (`tsc -p tsconfig.json --noEmit`) | PASS |
| API tests | 141/141 PASS |
| Desktop tests | 106/106 PASS |
| API bundle | PASS (2,293,387 bytes) |
| Electron package (NSIS + portable) | PASS |
| Bundled fix present in packaged resources | PASS — confirmed `_localId` destructuring present in both `apps/api/bundle/index.cjs` and the packaged app's `resources/api/index.cjs` |
| Isolated smoke test — local API starts | PASS — `/api/health` → `{"status":"ok"}` |
| Isolated smoke test — version | PASS — `FileVersion`/`ProductVersion` both report `1.0.21` |
| Isolated smoke test — local setup (tenant + admin creation) | PASS — `POST /api/auth/tenant/setup` |
| Isolated smoke test — local login | PASS — `POST /api/auth/login` |
| Isolated smoke test — local hub product creation | **PASS** — pushed a fake client-local `id: 999999` (reproducing the exact original bug) through the local hub's own `/api/sync/push`; the local database correctly ignored it and assigned its own real id (`1`) via its own sequence. Confirms the fix works in the packaged bundle, not just on Railway. |
| Migration | None required — this rebuild has no schema changes |
| Railway deploy | Not touched this pass — already deployed and verified separately during the 1.0.20 rollout cleanup (`cd716e4`, confirmed via `commitHash` match, live-tested) |

**Test method note:** the real hub (installed 1.0.20) was running on this machine and holds the app's hardcoded local ports (3015 API / 5434 Postgres) and Postgres data directory — both versions can't run side-by-side. The user gracefully closed the real hub via its tray icon (confirmed clean `pg_ctl` shutdown in `pg.log`: `received fast shutdown request → checkpoint complete → database system is shut down`) so the 1.0.21 portable build could be smoke-tested in full isolation (`--user-data-dir` pointed at a throwaway test folder, never touching the real hub's actual data). The real hub is to be relaunched normally afterward.

## Code Signing

This build is **unsigned**, same as 1.0.20. SmartScreen will show a warning on install. No code-signing certificate configured yet — not a blocker for this internal rebuild.

## Artifacts

| File | SHA-256 |
|------|---------|
| `Titan POS Setup 1.0.21.exe` | `710d65f051a357c6247984572a47eefb58166018f2f2b8b28ddb93000a15b216` |
| `Titan POS 1.0.21.exe` (portable) | `bb58bf059ac01a0f1c26a89c5042bd041be2dfa5eb3e996bff4cda72e233af17` |

**Not published.** No GitHub release created, no update manifest (`latest.yml`) touched, no Railway deploy triggered this pass, per this sprint's explicit instructions. Artifacts exist locally in `apps/electron/dist-v8/` only.

## Known Issues (carried over from v1.0.20, unaddressed this pass)

1. Unsigned installer → SmartScreen warning.
2. `registerId`/`deviceId` still degrade to `'REG-001'`/`'unknown'` placeholders after a full re-pull for multi-register attribution — display-only limitation.
3. Concurrent same-batch FEFO selection rejects the losing sale outright rather than gracefully retrying against a different batch.
4. `/api/sync/pull/full/staff` returns an inconsistent (empty) result compared to the regular incremental pull for the same tenant/entity — noticed during 1.0.20 rollout testing, not investigated further.
5. The dead Stock Movements ledger UI (recorded server-side, never displayed anywhere) remains unaddressed.

## Release Decision Status

- GitHub release: **not published** (pending)
- Update manifest (`latest.yml`): **not published** (pending)
- Code signing: **not applied** (pending, non-blocking)
- Pilot install: recommended as the next step before any public release, now that the installer actually contains the full fix

# Containment hotfix for the deployed API — for release approval

Branch `hotfix/containment-1.0.50`, one commit (`79a8c2b`) on top of the deployed revision `7df7c58`. **Server (API) only. Not deployed.** It does not contain Sprint 0, Sprint 1 or Sprint 2 work.

## Why
Reproduced with real handlers: an ordering-app customer (self sign-up) got a token that the till sync accepted, and the push skipped every permission check for accounts without a staff record — a customer could change product prices or push other store operations. Also: drivers could adjust stock through sync; customers received the store's live sales activity over the WebSocket; a PIN shared by two staff signed in as the higher role.

## Contents (13 files)
| Change | Files |
|---|---|
| Customer tokens refused by the staff verifier (they keep their own) | `src/middleware/auth.ts` |
| Token kinds; `/api/sync/*` only for store staff, the hub's own screen and a hub's cloud link | `src/middleware/auth.ts`, `src/routes/sync.ts` |
| Sync push fails closed: non-staff accounts → 401 `NOT_STAFF` (cloud-bridge and hub `__admin__` exempt) | `src/routes/sync.ts` |
| Setup `pull-from-cloud` / `tenant-info` only for staff and the hub's screen | `src/routes/setup.ts` |
| Permission rules: stock adjust/count, receive, debt, customers, held orders, delivery orders | `src/lib/permissions.ts`, `src/routes/sync.ts` |
| Ambiguous PIN → 409 `AMBIGUOUS_PIN` (optional `staffId`) | `src/routes/auth.ts` |
| WebSocket: customers only their own order updates; sync events staff only | `src/ws/index.ts` |
| Tests + bounded test concurrency | `__tests__/containment.test.ts`, `__tests__/sprint2-identity.test.ts`, mocked suites, `vitest.config.ts`, `__tests__/setup/db-pool.ts` |

No migration. No new dependency.

## Evidence
API suite on the deployed base + hotfix, against a schema migrated with exactly the deployed migrations: **382 tests pass**, type check clean. Negative controls, each reverting one guard: drivers allowed on sync; setup allows any token; no inventory rule; no customer rule; ambiguous PIN resolved silently; customer joins the store channel; customer token accepted again; original "skip checks without staff row" — **each fails its intended test** and the source is restored.

## Compatibility (read before approving)
- **Ordering app and driver app:** unaffected (their own endpoints; tested: driver lists orders, customer lists orders, customer still receives their own order updates live).
- **Hubs:** the hub's own screen and its cloud link are exempt from the staff-actor rule and keep working. The hotfix reaches **cloud only**; hubs run their own API from the installed EXE and keep 1.0.50 behaviour until a new EXE.
- **Tills connected to the cloud with a cashier's PIN** (the sync token is the connecting account's): stock adjustments/counts, receiving, customer edits and debt collections pushed by such a till are now refused if the *connecting* account lacks the permission, even if a manager unlocked locally (same class as refunds/voids today). They stay queued with an error, visible on the till — not lost. Tills connected with an owner/manager PIN are unaffected. **I cannot measure how many tills are cashier-connected without reading production data.**
- **Duplicate PINs:** staff who share a PIN can no longer sign in *online*; 1.0.50 tills then fall back to their offline match (which still picks the higher role locally) — the server fix does not change 1.0.50 till behaviour offline. Connect & Download with a shared PIN fails. Fix: give each person their own PIN (owner portal).
- **Not included:** Sprint 0 security fixes (tenant isolation on list endpoints, PIN-hash redaction in pulls, cost visibility) are also **not deployed** (`908f876` is after `7df7c58`). They are a separate decision; this hotfix does not depend on them.

## Release steps (when approved)
Deploying = merging this branch into the deployed line and pushing (Railway auto-deploys). Do not deploy `master` (24+ unreleased commits) for this fix.

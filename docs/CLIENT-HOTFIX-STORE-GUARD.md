# Client hotfix: a register never switches stores on its own — for release approval

Branch `hotfix/till-store-guard-1.0.50`, one fix commit (`74f94fb`, cherry-picked from master `2adcedc`) on top of the deployed revision `7df7c58` (1.0.50). **Till (desktop) code only. Not built, not published.** Separate from the server containment release (`hotfix/containment-1.0.50`) and from Sprint 2.

## Defect (confirmed, also in 1.0.50)
A register whose server address is `localhost` / `127.0.0.1` (the hub's own screen; any register pointed at a local server) asks `/api/setup/auto-login` for a fresh token when its WebSocket closes or a push gets 401 — e.g. whenever the local server restarts. It adopted **whatever token came back**. If that server is configured for a different store, the register:
1. switched to that store (token and stored store id),
2. pushed its queued work — including completed offline sales — **into the other store** (rejected there for stock, so lost from its own store's view),
3. pulled the other store's products and records.

Reproduced in the browser on a local test cloud: a cashier's offline sale went to another store on the same server and the register then showed that store's (empty) catalogue.

## Fix
`tryRefreshHubToken` adopts an auto-login token only when it is for the store the register already holds (`getCurrentTenantId()`); otherwise it keeps its own token, logs, and its queued work stays queued for its own store. A register with no store yet (first connection) is unaffected.

## Evidence
| Check | Result |
|---|---|
| `apps/desktop/src/__tests__/hubTokenRefresh.test.ts` (another store's token refused, nothing sent as that store, work kept; same-store token adopted) | 2/2 pass on the 1.0.50 code |
| Negative control (guard removed) | the cross-store test fails |
| Full desktop suite on 1.0.50 + this fix | 401 pass |
| `tsc -b`, production `vite build` | clean |
| Browser re-run on master (same code): local server restarted with another store configured | token offered once and refused; the offline sale reached its own store |

## Who needs it
- **Hubs (Electron, installed EXE):** their own screen talks to `http://localhost:3015` — the path where this happens if the hub's configured store changes or the data directory is reused for another store. Needs a new EXE.
- **LAN tills (`http://192.168.x.x:3015`) and browser tills on the cloud URL:** the auto-login path is never taken (not localhost). Not affected; the change is harmless to them.

## Decision needed before building
**Version number.** 1.0.51 is the preserved Sprint 1 candidate (`candidate/1.0.51-rc-097ed68`, not published). The updater only offers a higher version, so:
- (a) release this as **1.0.51** and re-version the Sprint 1 candidate when it ships (it is a rebuild from the same commit with a new number; the preserved candidate files are not touched), or
- (b) release this as **1.0.52**; the Sprint 1 release must then be numbered above it.
Nothing is bumped on this branch until you choose. Building follows the recorded procedure (clean short-path worktree — this one is `D:\tpcl` — guarded installer test against a local cloud, SHA-256 recorded).

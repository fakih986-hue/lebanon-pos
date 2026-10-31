# Containment release — exact contents and compatibility (for approval)

Two separate releases, both built from the deployed revision `7df7c58` (1.0.50). **Nothing is pushed, deployed or published.** No staff-identity enforcement is in either release, and no store has it switched on.

## A. Cloud release — branch `hotfix/containment-1.0.50`

Deploying = pushing this branch to `master` (a fast-forward from `7df7c58` as last fetched; Railway auto-deploys). **No database migration.** No new environment variables.

| Commit | Kind | Content |
|---|---|---|
| `79a8c2b` | code | Token kinds; till sync only for staff, the hub's own screen and a hub's cloud link; push fails closed for non-staff; permission rules for stock adjust/count/receive, debt, customers, held and delivery orders; shared PIN → 409; WebSocket channels |
| `0a292a4` | code | Sprint 0 server fixes: tenant isolation on lists/images/drivers/setup, route permissions, cost hidden without `reports.cost`, customer PIN hashes withheld; ordering app image URL carries the store id |
| `5b86e09` | code | Permission-refused work kept on the server (`Refused`, never forwarded or pruned) |
| `ecea31d` | code | Refused-work review and resolution (apply once / decline), **Refused work** page in the store admin web app |
| `d344ee8` | code | A decline carries who declined and the note, says nothing on the register was undone; money effects on the review screen |
| `a049d0f`, `fe310c8`, `39f7565` | tests | Admin app own-store lists; shared PIN on a 1.0.50 till; stale-read decision |
| `63137b9`, `fc84d57`, `09b290f`, `451153f`, this file | docs | `docs/HOTFIX-CONTAINMENT.md` (finding matrix, Option A, recovery), this file |

What a deploy changes, by app:

| App served by the cloud | Change |
|---|---|
| API | All of the above |
| Store admin web app (`/admin`) | New **Refused work** page; otherwise unchanged |
| Ordering app | Menu image URLs include the store id (needed by the image route fix) |
| Driver app | None |
| Desktop SPA for browser tills (`/`) | Rebuilt from the same 1.0.50 source; only new translation keys. **The store guard (release B) is not in it** — browser tills on the cloud address never take that code path |

Evidence: API 426 passed + 5 expected failures on a schema migrated with exactly the deployed migrations; negative controls for every guard; the 1.0.50 till services driven against this server (cashier-connected refusal, review, apply once, decline, local effect kept); admin app browser-tested in English and Arabic.

## B. Client release — 1.0.51, branch `hotfix/till-store-guard-1.0.50`

| Commit | Content |
|---|---|
| `74f94fb` | A register adopts a refreshed token from a local server only if it is for the store it already holds (+ regression test) |
| `cb31776` | `docs/CLIENT-HOTFIX-STORE-GUARD.md` |
| `3724893` | Version 1.0.51 |
| `31e1ce6` | The hub window's **startup** auto-login uses the same guard (`adoptOfferedHubToken`); on a store mismatch sending, downloading and checkout pause, pending work and journals stay, the lock screen explains the explicit store switch (en/ar) |

**Release candidate:** rebuilt 2026-10-31 from a clean checkout of `31e1ce6` (worktree `D:\tpcl2`; `pnpm install --frozen-lockfile`; `apps/electron` → `pnpm run package`), unsigned, **not published**. The served SPA contains the guard (checked in `resources/api/public/assets`).

| File (`D:\TitanPOS-candidates\1.0.51-hotfix-31e1ce6\`) | SHA-256 |
|---|---|
| `Titan-POS-Setup-1.0.51.exe` | `AAEDFD2B2DF30DFA23E5982E0B7B56457DEBE40A1ABC91E2B3A0CB45EE42A80E` |
| `Titan-POS-Portable-1.0.51.exe` | `C62B290EF8E126C5A0855FABA61C081C734CFEE6567DA5938BAA548FBE80F362` |

The first build from `3724893` (`D:\TitanPOS-candidates\1.0.51-hotfix-3724893\`, Setup `73E29650…EA940`) is **superseded** (no startup-path fix; `SUPERSEDED.txt` in the folder) and must never be published.

Evidence: desktop suite on the 1.0.50 source + fix 410 passed; `storeMismatch.test.ts` (9) + `hubTokenRefresh.test.ts`; negative controls; `tsc -b`; production build; installed-app tests §E. Master carries the same fix as `a8630eb` (447 passed).

The Sprint 1 café candidate `candidate/1.0.51-rc-097ed68` (`D:\TitanPOS-candidates\1.0.51-097ed68\`, Setup SHA-256 `09155B8D…3424DA`, unchanged) is **superseded and must never be published**; a `SUPERSEDED.txt` marks the folder. The café release will be renumbered above every published version (master is at 1.0.52).

## C. Not in either release

- Sprint 1 (café stock policies, made-to-order) and all Sprint 2 work (operation evidence, device enrollment, staff sessions, enforce-checkout and its activation gate). They are on `master`, which must not be deployed for this.
- Withholding **staff** PIN verifiers from tills (1.0.50 tills need them offline) and **cost in the till sync** (1.0.50 tills need it for offline sale cost) — still exposed until every till runs a client that does not depend on them.
- Containment on **hub-local APIs**: hubs run their own API from the installed EXE. Release B does **not** carry the server containment either (it is the 1.0.50 server + the store guard).

## D. Compatibility

| Combination | Result |
|---|---|
| Cloud A + direct 1.0.50 tills (EXE or browser), connected with an owner/manager account | Unchanged for selling. Shared PIN: online sign-in refused (409); see `HOTFIX-CONTAINMENT.md` §3 for the offline fallback and the transition |
| Cloud A + direct 1.0.50 tills connected with a **cashier's** account | Stock adjustments/counts/receiving, customer edits and debt collections done there by a manager are **refused, kept**, and appear on **Refused work** for a manager to apply once or decline (Option A). After a decline the till keeps its local effect and shows the entry as rejected with the decision |
| Cloud A + 1.0.50 hubs | Hub's cloud link exempt (store-level relay); forwarding unchanged; the hub's own LAN API keeps 1.0.50 behaviour |
| Cloud A + 1.0.51 hubs (release B) | Same as 1.0.50 hubs, plus the store guard on the hub's own screen |
| Release B against the **currently deployed** cloud | Compatible: the change is local to the register |
| Ordering / driver / store admin apps on cloud A | Tested: customers and drivers keep their own endpoints; admin lists with `?tenantId=` own store work |
| Hubs or tills older than 1.0.50 | **Not tested** |

## E. Install test of the exact 1.0.51 build (2026-10-31)

Setup SHA-256 verified (`73E29650…EA940`), installed silently into the default per-user location over the real 1.0.49 install (fingerprinted and backed up first), run **only** through the guarded launcher on disposable user-data dirs against the **cloud of this branch** (local, scratch schema `hotfix_it`, two disposable stores A and B). The register under test is the SPA served by the installed hub (the exact build), driven in the browser pane.

| Test | Result |
|---|---|
| Connect, login, checkout | Register connected to the hub as store A; cashier signed in; shift opened; sale S-IUUR-000001 committed by the hub (stock 30 → 29) and forwarded to the cloud by the hub link | pass |
| Restart | Hub stopped and started on the same data: cashier signs in again, sale 000002 committed and synced | pass |
| Offline sale, reconnect | Cloud stopped: sale 000003 recorded by the hub; cloud back: forwarded once; cloud and hub stock agree (27) | pass |
| Refresh offering another store's token | Hub re-set up for store B on new data (token from the old hub refused, 401); its auto-login offered only store B. Register: "auto-login offered a token for another store — not adopted" on every retry; token and stored store unchanged (A); pending held order kept (Failed, waiting); every push carried the old store-A token (all 401); the held order exists nowhere on the cloud; store B has no operations | pass |
| Legitimate same-tenant refresh | Hub back on store A with a different signing secret: the register adopted the store-A token offered (issued 11:48:45); the pending held order then synced and reached store A on the cloud exactly once. (Also seen unintentionally when a new hub briefly came up still activated for A: the store-A token was adopted.) | pass |
| Containment cloud compatibility | Hub link forwards shift, sales and held order (exempt store relay); hub pulls staff and products; store B untouched throughout | pass |
| Network | 5 hub runs, outbound watchdog: 0 non-loopback connections | pass |
| Restoration | 1.0.49 reinstalled: 0 differences in 1,870 program files, 0 in the real user data, uninstall registry entry identical, shortcuts identical, nothing left running | pass |

**Finding: a second, launch-time path** (fixed in `31e1ce6`, below). The hub's own window (`LoginScreen`) called auto-login whenever the lock screen mounted and adopted the token without the store check, then ran a full pull.

### E2. Startup path — real Electron hub window (2026-10-31)

Driven in the installed hub's own window (loopback-only DevTools port added to the guarded launcher; disposable user data under `%TEMP%`; same local containment cloud, stores A and B). Scenario: store A has pending work; the hub is set up again for store B (B's activation in the install dir, new signing secret, so the register's token is no longer accepted); the register is locked so the lock screen's startup auto-login runs.

| Build | Result |
|---|---|
| `3724893` (unfixed) — **defect reproduced** | Window switched token and stored store to **B**; products and staff became empty; A's pending held order `a872cd27` was applied in the hub **under store B** (earlier A orders stayed under A) |
| `31e1ce6` (fixed) | Auto-login offered B (200) on every retry — **not adopted**; token and stored store stay A; products (Olive oil 27) and staff (Owner A, Rana) kept; pending held order `af85ac30` kept; **no** `/api/sync/push` or `/api/sync/pull` request at all while paused; the lock screen shows the store-mismatch explanation; hub DB has no store-B operation. Sign-in on the lock screen is refused by the B hub for A's staff (the PIN check names A's store), so nobody from B is added to A's staff list |

Acceptance tests repeated on the `31e1ce6` installer (SHA-256 verified):

| Test | Result |
|---|---|
| Fresh activation | Activation window form (URL pre-filled `http://127.0.0.1:3999`), owner PIN → store A; the unbound window adopted A (no mismatch), downloaded products and staff | pass |
| Login, checkout | Rana unlocked; held order synced to A; sale `S-OO6T-000001` paid (stock 27 → 26), in the hub and forwarded to the cloud under A | pass |
| Startup offers another store | as above (E2) | pass |
| Legitimate same-store startup | Hub back on A with another new secret, register locked: auto-login token for A adopted, pause cleared, the kept order `af85ac30` pushed once and synced to A, full pull ran | pass |
| Restart | Hub stopped and started on the same data: same store, session continues, no mismatch | pass |
| Offline sale, reconnect | Cloud API process suspended: sale `S-OO6T-000002` recorded by the hub (stock 25); cloud resumed: forwarded at once (synced 12:31:08) | pass |
| Cross-store refresh refused | Session unlocked when the hub came up on B: refresh path refused B, mismatch recorded, nothing sent | pass |
| Same-tenant refresh | Session unlocked, hub on A with a new secret: 401 → auto-login → new A token adopted, pull resumed | pass |
| Containment cloud compatibility | All four hub operations Synced to the cloud under A; nothing under B | pass |
| Network | 5 hub runs, outbound watchdog: 0 non-loopback connections | pass |
| Restoration | 1.0.49 reinstalled: 0 differences in 1,870 program files and 2,186 real user-data files; uninstall registry entry and shortcuts identical; nothing running; test data deleted | pass |

Not changed (existing behaviour): the hub's own API answers `GET /api/sync/pull/full/cash-movements` with 400 to the 1.0.50 register code (logged, pull otherwise completes).

Also observed (existing behaviour, not a regression): after its token was refreshed by a hub, the register's sync token became the hub's store-level `__admin__` token; and a register talking to a hub that holds only a partial copy of its store replaces its product list with that copy on the next full pull.

## F. Before releasing (each needs your approval)

0. ~~Launch-path finding~~ fixed (`31e1ce6`), rebuilt and install-tested (§B, §E2).
1. Production database backup (recorded procedure).
2. Shared-PIN audit in the owner portal: give everyone sharing a PIN their own PIN (`HOTFIX-CONTAINMENT.md` §3).
3. Tell store managers about the **Refused work** page and that a decline does not undo anything on the register; tell hub owners that after setting a hub up for another store, its window pauses and asks for an explicit store switch.
4. Publish **only** the `1.0.51-hotfix-31e1ce6` files; verify Setup SHA-256 `AAEDFD2B…42A80E` before upload. Never the `3724893` or `097ed68` folders.
5. Order: cloud A first, then publish release B (GitHub release `v1.0.51` with `latest.yml` from the same folder; hubs see "Update available").

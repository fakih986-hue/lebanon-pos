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

Built 2026-10-31 from the clean worktree `D:\tpcl` (`pnpm install --frozen-lockfile`; `apps/electron` → `pnpm run package`), unsigned, **not published**. The built SPA contains the guard (checked in `resources/api/public/assets`).

| File (`D:\TitanPOS-candidates\1.0.51-hotfix-3724893\`) | SHA-256 |
|---|---|
| `Titan-POS-Setup-1.0.51.exe` | `73E296500BBC202740587801B28EB5E0953199AE718F19E3464805CCABFEA940` |
| `Titan-POS-Portable-1.0.51.exe` | `722ADF98642D86578AA9BCEED03FAED41F90BAFE0D50A4625BB4F2E1DAE2B57B` |

Evidence: desktop suite on the 1.0.50 source + fix 401 passed; regression test + negative control; `tsc -b`; production build. **Not yet install-tested** (see §E).

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

**Finding (not fixed in this build): a second, launch-time path.** The hub's own window (Electron, `LoginScreen.tsx:118`) calls auto-login **on every launch** and adopts the token without the store check, then runs a full pull. If a hub is re-set up for a different store while its own screen still has unsynced work from the old store, that work would be sent under the new store. Seen in code and implied by the activation behaviour above (a hub's activation is shared through its install directory, so a hub started on new data first runs as the previous store); **not reproduced in the hub window itself** (that needs driving the Electron window). LAN and browser registers do not take this path. Fixing it means applying the same store check there and rebuilding 1.0.51 (still unpublished, so the version can stay; the SHA-256 would change).

Also observed (existing behaviour, not a regression): after its token was refreshed by a hub, the register's sync token became the hub's store-level `__admin__` token; and a register talking to a hub that holds only a partial copy of its store replaces its product list with that copy on the next full pull.

## F. Before releasing (each needs your approval)

0. Decide on the launch-path finding: fix and rebuild 1.0.51 before publishing (recommended), or publish as tested with the limitation documented.

1. Production database backup (recorded procedure).
2. Shared-PIN audit in the owner portal: give everyone sharing a PIN their own PIN (`HOTFIX-CONTAINMENT.md` §3).
3. Tell store managers about the **Refused work** page and that a decline does not undo anything on the register.
4. ~~Install test of 1.0.51~~ done (§E); repeat it on the rebuilt installer if the launch path is fixed.
5. Order: cloud A first, then publish release B (GitHub release `v1.0.51` with `latest.yml`; hubs see "Update available").

# Sprint 2 — acceptance plan and results

Canonical record of what is tested and what passed. Real services, real API handlers, real PostgreSQL (scratch DB only), bounded concurrency (`apps/api/vitest.config.ts`). Negative controls restore the specific original behaviour and must fail for the business reason.

## Results so far (Phase A)

| Area | Evidence | Status |
|---|---|---|
| Customer token is not a staff credential; sync push fails closed for non-staff; cross-store forged token refused; refused callers leave no gate record | `apps/api/__tests__/sprint2-identity.test.ts` (4; plus 1 expected-failure probe: a driver can adjust stock — open, matrix §2) — negative control (original skip restored): 4/4 fail for the business reason | **pass** (`b21e9d8`) |
| Stock-revision ids on plain-HTTP tills | `apps/desktop/src/__tests__/randomUuid.test.ts` (2) | **pass** (`3300ae1`) |
| Crypto runtime support | measured in the browser pane: plain-HTTP LAN origin vs loopback (PLAN §1) | recorded |
| Full suites | API 473 + 1 expected fail (S4); desktop (unchanged) 415 + 2 | pass |

## Containment (Track A) — separate from Sprint 2 architecture

| Area | Evidence | Status |
|---|---|---|
| Token kinds per endpoint: /api/sync/* for staff, hub screen, hub cloud link only; setup JWT endpoints for staff and hub screen only | `apps/api/__tests__/containment.test.ts` — driver refused on push/pull/status; customer refused on sync and setup; staff still sync; driver lists orders, customer lists orders | pass (`29d0a7b`) |
| Permission rules for uncovered ops (stock adjust/count/receive, debt, customers, held orders, delivery orders) | cashier refused adjust/count/receive/customer edit/debt collection; manager allowed; cashier can still park an order | pass |
| Ambiguous PIN: 409, no highest-role pick; staffId selects | shared-PIN pair refused; each signs in when named; wrong PIN with staffId refused | pass |
| WebSocket: customers only their own order updates; sync events staff only; drivers keep order events | real WebSocket clients | pass |
| Driver stock-adjustment probe (was expected failure) | now a normal regression test | pass |
| Till: fresh PIN to switch staff; no fallback actor; ambiguous PIN refused offline and online | `apps/desktop/src/__tests__/staffIdentity.test.ts` (5) | pass (`3c48be1`); Staff-page switch verified by code and type check, **not exercised in a rendered UI** |
| Negative controls | one per guard (8 server on the hotfix tree, 6 server on master, 3 till): each fails its intended test | pass |
| Refused work kept on the server (unapplied `Refused` row with payload, reason, account, device; listed for `reports.view`; a resend by an allowed account applies once) | `containment.test.ts`; hotfix: `cashier-connected.test.ts` drives the real 1.0.50 till services | pass (`3a8941f`; hotfix `5b86e09`) |
| Containment release `hotfix/containment-1.0.50` from deployed `7df7c58`: containment + Sprint 0 server port + refused-work preservation | 420 + 5 expected fail on a schema migrated with the deployed migrations; 14 negative controls; release matrix, cashier-connected decision and shared-PIN transition in `docs/HOTFIX-CONTAINMENT.md` on that branch | **deployed 2026-10-31** as `e2fd79a` (Railway 498a850f; production backup and limited PIN audit first; 26/26 production smoke checks); merged into master as `6e0d80d` |

## Phase B — observe mode

| Area | Evidence | Status |
|---|---|---|
| OperationEvidence per applied operation, same transaction; claimed vs authenticated fields separate; transport; acceptedBy | `apps/api/__tests__/evidence-observe.test.ts` (11) | pass (`bbbdad5`) |
| Labels distinct; nothing verified/hub-attested in observe mode; offline-claimed only when the client says so | same | pass |
| Envelope outside operation identity (resend with different ev = same op, one evidence row) | same | pass |
| New tokens carry typ; contradicting typ refused; old tokens accepted | same + full suite | pass |
| Negative controls (mislabel verified, no evidence, typ contradiction accepted, connecting account as actor) | each fails its intended tests | pass |
| Full API suite | 496 + 1 expected fail (S4 attribution, Sprint 2 C) | pass |

## Phase C — device enrollment and per-staff sessions (observe mode)

| Area | Evidence | Status |
|---|---|---|
| Enrollment: manager-created one-time code, server-assigned device record, credential issued; single use (incl. concurrent and stale-read); expiry; cross-store refused with the code left unused; re-enrollment supersedes the earlier credential | `apps/api/__tests__/sessions-observe.test.ts` | pass (`ed53869`) |
| A device credential or staff session is never a connection token (codes, sync, lists all 401) | same | pass |
| Staff session needs the person's PIN every time (wrong PIN refused and audited); switching ends the previous session; connection token unchanged | same; till: `apps/desktop/src/__tests__/staffSession.test.ts` | pass |
| Evidence keeps connection account and session person apart; label `staff-session` with limitations, never `verified` | same | pass |
| Session from another device, without the device credential, forged, expired, ended before receipt; actor substitution — all recorded, audited where relevant, **applied** (observe) | same | pass |
| Revocation: PIN reset (`staff-revoked`), deactivated staff (`staff-inactive`), revoked device (sessions ended, queued work applied and labelled, not dated by client time); another store cannot revoke | same | pass |
| Hub forwarding keeps the hub's original evidence (`relayed`, unattested); a re-forward does not change it; a direct till cannot fake `relayed` | `apps/api/__tests__/sessions-relay.test.ts` (hub + cloud servers, bridge over HTTP) | pass |
| Till: lock / local-PIN unlock / switch without PIN drop the session; queued work keeps the evidence it was created under; device credential only sent to its issuing server; offline work kept with local-PIN evidence | `staffSession.test.ts` (9) | pass |
| Negative controls (14): device binding, credential key + audience, atomic code, cross-store enrollment, session counted without device, relayed from a direct till, hub forwards without evidence, switch leaves session open, PIN reset not revoking, observe labelled verified, lock keeps session, push-time evidence, credential sent anywhere, switch without PIN keeps session | each fails its intended test; source restored | pass |
| **Browser** (desktop SPA against the guarded local cloud on the scratch DB, disposable store): owner connects; manager creates a code in Settings → Devices & Sync and the register enrolls; Rana and Sami each unlock with their own PIN and sell; server evidence: both sales `staff-session`, connection Owner, session Rana / Sami; Rana's session ended at lock; Arabic RTL layout and Arabic dates; device revoked → register shows "enroll again" at next sign-in → re-enrolled → sessions resume; server stopped → Rana unlocks with the local PIN and sells → server restarted → sale applied as `offline-claimed`, device credential valid, no session | browser pane; evidence read from the scratch DB | pass |
| Found in the browser test: on a local server's restart the register adopted an auto-login token for **another store**, switched stores and pushed its queued sale there (also in 1.0.50) | fixed `2adcedc`; `hubTokenRefresh.test.ts` (negative control fails); browser re-run: token for the other store offered once and refused, the sale reached its own store | pass |
| Full suites | API 521 + 1 expected fail; desktop 433; `tsc -b` clean | pass |

Known limitations (Phase C): the session indicator is only visible to roles that can open Settings; a session ended while offline stays open on the server until the device's next session; the hub's own screen enrolls with a code like any register (no automatic enrollment); device credentials are bearer tokens in browser storage (no proof-of-possession yet); paired-device list with enrollment state is on the hub screen only.

## Refused-work recovery (containment, Option A decided 2026-10-31)

| Area | Evidence | Status |
|---|---|---|
| Review: original operation (secrets hidden), the till's claimed local effect and the server effect now, reason, sender account and device, named person, what is not proven; reviewers see what they may decide, Reports sees all | `apps/api/__tests__/containment.test.ts` (master); hotfix: `cashier-connected.test.ts` with the real 1.0.50 till services | pass (`42da8cc`; hotfix `ecea31d`, `39f7565`) |
| Resolve: staff member holding the operation's permission, note required; one decision only (concurrent 200/409, deterministic stale read 409); apply = same apply-once claim as a push, evidence `applied-on-manager-review`; decline final (resend rejected, never applied) | same | pass |
| Negative controls (4, both branches): decision not atomic, declined op not refused on resend, reviewer permission not checked, secrets shown | each fails its test | pass |
| Browser (admin app, hotfix tree): review page, decline, apply (20 → 26 once), failed apply returns to the list, Arabic | browser pane | pass |

## Client hotfix: wrong-store token adoption (separate release)

Branch `hotfix/till-store-guard-1.0.50` (`74f94fb` + doc `cb31776`) from `7df7c58`, worktree `D:\tpcl`: regression test + negative control on the 1.0.50 code, 401 desktop tests, `tsc -b`, production build. Startup-path guard added (`31e1ce6`, master `a8630eb`) after the defect was reproduced in the real Electron hub window. **Published 2026-10-31 as 1.0.51** (GitHub release `v1.0.51`, tag → `31e1ce6`, Setup SHA-256 `AAEDFD2B…42A80E`, update feed verified). It carries no server containment: hub-local APIs keep 1.0.50 permissions.

## Enforcement slice: enforce-checkout (opt-in per store)

| Area | Evidence | Status |
|---|---|---|
| Observe stays the default; switching needs settings.manage + a note, audited; mode in /api/sync/status | `apps/api/__tests__/enforce-checkout.test.ts` | pass (`4586a71`) |
| Owner connection throughout: Rana's below-price sale refused, the same sale by Sami applied and recorded as Sami's (`verified`); Kim without sales.checkout refused | same | pass |
| No device / no session / no envelope / forged / another register's session / revoked staff: refused IDENTITY_REQUIRED, kept for review, never legacy | same | pass |
| Completed offline sale applies (offline-claimed); session expired or signed out before arrival applies as that person (`staff-session`, not verified) | same | pass |
| Identity-refused sale reviewed and applied once by a manager; evidence reads contain no tokens, credentials or PINs | same | pass |
| Register: mode from status; checkout stopped before payment without a server-checked session; local-PIN sign-in sells offline, must sign in again once the server is reachable | `apps/desktop/src/__tests__/staffSession.test.ts` (12) | pass |
| Negative controls: 9 server, 2 register | each fails its intended test | pass |
| Browser (desktop SPA, guarded local cloud, scratch DB): badge on POS (red / green / amber); unenrolled register blocked before payment; enrolled + Rana's session sale `verified` as Rana; offline sale allowed and recorded offline-claimed; back online with the register PIN only → blocked before payment | browser pane; evidence from the scratch DB | pass |
| Full suites | API 533 + 1 expected fail; desktop 436 | pass |

Limits of this slice: only ordinary sales are enforced; hub-relayed operations are not re-checked at the cloud (Phase D attestation), and a hub enforces only if the mode is set on the hub's own database; manager approvals are not built (Phase E); an older register in an enforcing store cannot sell online (its sales are refused and kept for review), so enforcement should be switched on only after every register is upgraded and enrolled.

## Offline trust boundary, activation gate, decline reconciliation (2026-10-31; enforcement stays off)

| Area | Evidence | Status |
|---|---|---|
| Probe before the fix: in an enforcing store a request claiming offline applied below-price sales, a person not allowed to sell, unknown/foreign/name-only actors and a sale dated before the cashier's deactivation — all on the connecting account's authority; a signed-out session authorized a below-price sale | `enforce-checkout.test.ts` boundary cases run against `4586a71` | **defect, fixed** |
| Offline claim / stale session: applies only a routine sale (catalogue price, no discount, not at cost) by an active staff member of this store who may sell now; labelled `offline-claimed` / `staff-session`, never `verified`; everything else refused `OFFLINE_REVIEW` / `SESSION_REVIEW`, kept unapplied for review; the register's clock is not proof | same (10 cases); 4 negative controls | pass (`17d2375`) |
| Activation gate: refused (409, audited, mode stays observe) while a hub link, a register below schema 4, an unenrolled register or a pusher without a device id still trades (14-day window, retirement as in Sprint 1); never on a hub server; hub-forwarded sales in an enforcing store refused `HUB_UNSUPPORTED` and kept; registers send schema 4 | same; 6 negative controls | pass (`991fe2d`) |
| Decline reconciliation: the register is told who declined and why, and that nothing it did was undone; the register keeps its local effect (1.0.50 till: 10 → 8 kept, server 15); master register lists declined items with their local effect until someone records what was done (note, audited); review screen shows money effects; Decline dialog says it undoes nothing | `declinedWork.test.ts`; hotfix `cashier-connected.test.ts`; 3 negative controls | pass (`54ca334`; hotfix `d344ee8`) |
| Full suites | API 547 + 1 expected fail; desktop 438; hotfix API 426 + 5 expected fail | pass |

Known limit: a modified register can still name another active seller on a routine offline sale; nothing checked offline can prove who it was.

## Package: staff authentication and approval workflows (branch `dev/staff-auth-approvals`, 2026-11-01)

| Area | Evidence | Status |
|---|---|---|
| Daily-close valuation on the frozen packaged 1.0.52 hub (`d678a84`): known, zero, hidden, missing costs; cash and card; refund, expense, supplier payment, cash movement; review; forwarding; outage, restart, reconnect; older-client view; close-history screen | `installed-hub-close.test.ts` against the running packaged hub; browser pane | pass, **one defect**: closing a date again failed forever on the (tenant, date) unique index — fixed `ed4287f` (newer close replaces, earlier kept in audit) |
| Hub key enrollment (owner-authorized only), attested forwarding, tampered command, replayed attestation, unknown / revoked / rotated / other-store key, concurrent duplicate forwarding, lost acknowledgement, claim stays a claim, attested hub sales in an enforcing store | `hub-attestation.test.ts` (9, hub + cloud handlers); 5 negative controls | pass (`74feadd`) |
| Online manager approval: refusals (wrong PIN, no permission, inactive, other store, unenrolled, not approvable); approved refund (cashier actor, manager approver, no PIN anywhere); changed values, other record, other operation, other register, expiry, cancel, approver deactivated before receipt; concurrent use; void and cash payout; lockout | `approvals.test.ts` (8); 8 negative controls | pass (`c7003d1`) |
| The register's own services against the real API: refused locally without approval, approved refund delivered with the approval, staff switch / lock / restart drop unused approvals, server refuses a refund larger than approved, void and payout, offline approval impossible, expired connection keeps completed work queued | `approval-till.test.ts` (6) | pass |
| Approval dialog: focus, Enter, Escape, keypad, one request in flight, slow server, wrong PIN, shared PIN, focus back to the scanner field, Arabic | `managerApproval.test.tsx` (7, rendered; incl. opened from inside the receipt drawer) | pass |
| Review of held work: device revoked, staff deactivated, PIN reset, permission removed, session ended, hub key revoked — each held with category, held evidence, money, stock effects; stale preview, partial repair, decline without money outcome refused; concurrent decisions; recorded resolution; resend never applies | `review-queue.test.ts` (5); 3 negative controls | pass (`e33ef10`) |
| Activation gate requires observed identity evidence; a named manager is a claim in an enforcing store | `boundaries.test.ts` (2); 2 negative controls | pass (`7b0aa08`) |
| Packaged dev hub (`9b49da3`, isolated data, loopback test cloud): acceptance with the current and the released 1.0.51 till; daily close; an approved refund forwarded with the hub's attestation | `installed-hub.test.ts` 7/7 ×2, `installed-hub-close.test.ts` close 6/6, close-approve 1/1 (cloud: attestation valid, approval relayed with its approver) | pass |
| Browser review (dev SPA → packaged dev hub → test cloud, Midnight Gold): cashier on a server session opens a receipt, sees "needs a manager's approval", wrong PIN (attempts left, focus back on the PIN), Escape cancels (sale and signed-in person unchanged), approved void ("Approved by Manager Maya. Sale voided."; cloud: sale voided, attestation valid, approval valid, sales.void, Manager Maya); Arabic RTL on a 375 px phone: dialog, keypad, focus; hub unreachable → "no approval offline", cancel leaves the sale intact | built-in browser pane | pass after **three fixes** (`a4eccb4`): cashiers could not reach the receipts page (reports.view only); the dialog opened from the receipt drawer was inert (the drawer marks body children inert); Arabic void and cancel were the same word |

Not done in this package: checkout discount / price override approval on the register UI (server supports `sale:create` approvals; POS integration pending); offline manager approval (policy D2 open); hubs enforcing locally (a hub link remains an activation blocker).

## Batch: completing staff authentication (2026-11-01; final dev candidate `dev-83321d5`, never published)

| Requirement | Evidence | Status |
|---|---|---|
| Checkout approval, Full and Simple POS (discount, price below list, sale at cost): cashier stays the actor, cart, tender and focus kept, change invalidates, cancel, expiry, wrong PIN, repeated confirm, lost response, staff switch, forwarding | `checkoutApproval.test.ts` (5), `approval-till.test.ts` checkout (4, real API), `managerApproval.test.tsx` (8, incl. focus trap); packaged hub `close-batch`/`-resume`; browser on the final build (EN desktop, AR phone Simple POS, touch keypad) | pass |
| Approval binding over every business field (one builder: `materialOf`); substitutions with the same id and total; tenant, register, person, action | `approval-binding.test.ts` (6) | pass |
| A consumed approval stays valid when forwarded after its lifetime; an unused expired approval stays unusable; restart, key rotation, duplicate delivery | `hub-attestation.test.ts` (10); packaged final build: approvals forwarded 178–180 s after use, cloud check valid, hub check valid, attestation valid, after a hub restart and a cloud outage | pass |
| Daily close: exact retry, another register or shift, linked correction, stale correction held, concurrent corrections, legacy re-close, hub/cloud reconciliation, older clients | `hub-valuation.test.ts` (18), `sync.test.ts`; packaged final build: three closes of one date (two registers both labelled REG-001, told apart by device), correction revision 2, same chain in the cloud | pass |
| Review UI: apply, decline with money outcome, stale preview, insufficient permission, restart, repeated resolution; actor, approver and reviewer apart | admin app on the packaged build (AR and EN): stale preview reloads, double click applies once, decline states the outcome, a cashier is refused, decisions survive a hub restart; `review-queue.test.ts` (5); hub API run | pass |
| Watchdog | strict line reads (`it-hub.mjs selftest` exit 0; a hostile command line read intact); the old JSON read garbles non-ASCII command lines (5/5); every launch in the final runs ended with no watchdog error and 0 outbound violations | repaired |
| Final packaged build, isolated data, loopback cloud | `installed-hub.test.ts` 7/7 with the current till and 7/7 with the released 1.0.51 till; `installed-hub-close.test.ts`: close 6/6, close-approve 1/1, close-batch 1/1 (cloud down), close-batch-resume 2/2 (after hub restart and cloud return) | pass |
| Negative controls | 13, each failing on its business assertion: `D:\TitanPOS-it\sprint53\negctl-final.out` | pass |

Defects found and fixed during validation (each in a later build, then the final build revalidated): a close's scope used the register label every register shares (REG-001); the approval dialog let a closing review dialog return focus to the scanner field (the manager's PIN went there); the shipped admin bundle had never included the review of held work (stale since 41bf311); Simple POS on a phone clipped the discount controls (twice: once before, once by the first stacking fix); the close history did not name the device; the admin page told a viewer without access that nothing was waiting.

Observe-mode scope (S4): see the threat model §3a — observed in the packaged run: a cashier's held close was applied when the register re-sent it under the owner's connection.

## Batch: hub staff enforcement and controlled café pilot (2026-11-01; final dev candidate `dev-89ca7f8`, never published)

Design and limits: [STAFF-ENFORCEMENT.md](STAFF-ENFORCEMENT.md). Tested commit `89ca7f86be545be8a0054898159ebd2b4a7ff234`
(fresh worktree, clean before and after). Production stores stay in observe; enforce was enabled only on disposable
stores in scratch schemas, at a loopback test cloud.

| Requirement | Evidence | Status |
|---|---|---|
| Hub-local enforcement: session person, never the connection; REST and sync; hub screen | `staff-enforce.test.ts` (16), `staff-workflows.test.ts` (4); packaged `enforce-roles` 7/7 (owner connection carries nothing; Rana's café order, refund, void, payout on Maya's approval are Rana's at hub and cloud; Maya after a staff switch; Rana's own connection; Noor refused; hub screen needs enrollment and a session) | pass |
| Policy issued at the cloud, versioned, adopted only when newer, kept through outage and restart, lowered explicitly | `staff-enforce.test.ts`; packaged `enforce-observe` (v1 adopted in ~5 s; hub cannot issue), `enforce-outage`, `enforce-restart` (still v1, cloud down), `enforce-lower` (v2 observe adopted) | pass |
| Cloud verification of forwarded work; delayed delivery; rotation; revocation; duplicates; offline claims kept apart | `staff-enforce.test.ts`, `hub-attestation.test.ts`; packaged `enforce-resume` (LAN-only sale and approved payout reached the cloud once, attestation valid, actor Rana, approver Maya) | pass |
| Activation over every client ever seen; old, retired, unseen, long-offline and hub-only registers | gate tests (old, 90-day-quiet, never-synced, account-only, superseded hub link, hub-only register retired with a note); packaged legacy register blocked activation until retired; released 1.0.51 till refused after enforcement, sale kept on the till and held | pass |
| S4 as two expectations | `cafe-audit.test.ts` (observe = claimed); `staff-enforce.test.ts` and packaged (enforced: cashier rewritten to the session person, owner's authority not obtained) | pass |
| Legacy closes; same label; corrections; retries; hub/cloud agreement | `hub-valuation.test.ts`; packaged `close` 6/6 and `close-oldclient` (1.0.51) on the final build; a second register's close: current client sees both, a schema-2 client one combined close "2 closes combined" (2.00 + 3.50 = 5.50); hub and cloud closes and stock equal | pass |
| Review UX: titles, errors, actor/approver/reviewer, EN/AR desktop, tablet, phone, keyboard | final build's admin: translated titles, Done by / Approved by / Decided by, RTL, no overflow (phone with the sidebar collapsed), dialog fits 343 px, focus trapped, Escape returns focus to the opener, keyboard-only decline recorded with reviewer; `public-error.test.ts` | pass, with follow-ups below |
| Suites and typechecks | API 674 passed / 5 packaged-only skipped, exit 0; desktop 489, exit 0; API, desktop, admin, shared typechecks exit 0 | pass |
| Negative controls | 13, each failing on its business assertion: `D:\TitanPOS-it\batch57\negctl-final.out` | pass |

Defects found on the packages and fixed (each followed by a new build, then a full revalidation): a staff switch
ended the session before the outgoing person's queued refund/void/payout was sent, so it was held as
`SESSION_REVIEW` (dev-8748382); a reviewed operation the register had resent five times was never forwarded to
the cloud (dev-d99bb75); a resent held operation's reason was overwritten by the latest delivery (dev-d99bb75);
the review dialog lost focus on close (dev-28ba196). Also fixed: a test that read a PIN inside a random id.

Follow-ups (not fixed in the candidate): the reason/code split added to the review list has a broken pattern and
shows the reason as before; after a completed decision focus goes to the page, not the next item; Shift+Tab from
the first dialog field does not wrap; the admin sidebar starts expanded on phones; the staff-session evidence
label repeats "server-checked"; server-composed reasons stay English in Arabic; activation has no owner screen;
a store with a hub must not also have registers connected straight to the cloud (stock diverged by the 2 units
such a register sold).

## Batch: operational readiness and controlled café pilot (2026-11-01; final dev candidate `dev-38bca9b`, never published)

Design and limits: [STAFF-ENFORCEMENT.md](STAFF-ENFORCEMENT.md) §7, §11–§16. Tested commit
`38bca9b19cf2757e4270c30577d3afb727eac64a` (fresh worktree `D:\tpdc11`, clean before and after, install and package
exit 0, unsigned). Production stores stay in observe with topology `unset`; topology and enforcement were changed only
on disposable stores in scratch schemas, at a loopback test cloud.

| Requirement | Evidence | Status |
|---|---|---|
| Topology enforced: direct-cloud or one hub; direct register in a hub store held (checkout refused before payment, work kept, delivered once through the hub); other hub / unattested forwards held; hub that is not the store's refuses and stops forwarding; REST stock writes; no automatic switch | `store-topology.test.ts` (8); packaged `pilot-direct` (guidance on first download, sale held `TOPOLOGY_USE_HUB`, cloud stock unchanged, repair refused) | pass |
| Second hub, readiness (open shifts, held work, register queues, signed hub report, stock and lots), stale decisions, audit, adoption only when newer | `store-topology.test.ts`, `owner-controls.test.ts` (3); browser at the cloud: readiness listed the owner's open shift and the never-reporting old till, then "ready" | pass |
| Authoritative attribution on records (omitted, forged, renamed/deactivated, staff switch, approval, review, hub forwarding, offline/observe claims, history untouched) | `record-attribution.test.ts` (7), `staff-enforce.test.ts` (forwarded refund and reviewed payout name the same people at hub and cloud); packaged `pilot-resume` and `pilot-verify` | pass |
| Owner control in the browser (EN and AR): setup, readiness, retire with reason, full enforcement, server refusal with blockers, lower to observe | cloud admin on the final build: retired "Old front till", changed setup to the hub (v1), turned on full enforcement (v1, hub adopted), later returned to observe (v2, hub adopted); first pass in English on the first build, second pass in Arabic on the final build | pass |
| Review UX: reason/code split, support references apart, Shift+Tab wrap, focus after decisions, phone sidebar, AR | browser on the scratch cloud and on the final package's hub admin: Shift+Tab wraps, Escape returns focus, focus moves to the next item and to the heading when the list empties, stale decision reloads with a notice, phone sidebar 64 px with 311 px content, AR RTL without overflow, dialog 343 px | pass |
| Staff switch without waiting on the network | desktop `staffSession.test.ts` (18): server down, hanging response (ended within the bound), storage failure, app closed mid-switch (finished at next start), approvals not inherited | pass |
| Café pilot on the packaged hub (hub topology) | `installed-cafe-pilot.test.ts`, `D:\TitanPOS-it\batch62\evidence.txt`: every phase passed on the final package (see the matrix in the batch report) | pass |
| Suites and typechecks | API 692 passed / 6 packaged-only skipped, exit 0; desktop 493, exit 0; typechecks api/desktop/admin/shared and `tsc -b` desktop/admin exit 0 | pass |
| Negative controls | 14, each failing on its business assertion: `D:\TitanPOS-it\batch61\negctl.out` (12) and `negctl-2.out` rerun (2, patterns fixed) | pass |

Defects found by the first café pilot (build of `9fe20f6`, not kept) and fixed together in `38bca9b`, then the whole
pilot was repeated from scratch on the replacement package: the register sent a sale's and a refund's seller by name
only, so every routine offline sale was held in an enforcing store; a cashier's lot-consuming checkout left a held
"lot change" (an update the server ignores was gated as an inventory change); a register connected the wrong way was
told only at its next poll, not on its first download; the owner screen showed "no hub" for the hub's policy version
before a setup was chosen. Harness mistakes found and corrected (not product defects): an offline simulation that
changed the register's address, a probe sale built through the register without a shift, a cloud check with a hub token.

Remaining (not fixed): the `topology-unset` blocker's label ("Store setup") comes from the server in English on the
Arabic screen; server-composed sentences and blocker details stay English in Arabic (the explanation beside them is
translated); delivery orders change stock at the cloud and are not supported in a hub store (stated); NSIS
installation/upgrade and real LAN/hardware testing need a disposable Windows machine.

## Plan by phase (to be filled with evidence as implemented)
- **B — observe mode:** token kinds (`typ/iss/aud`) on new tokens with old tokens still accepted; `requireCloudKeyOrJwt` refuses non-staff tokens; envelope parsing; derived `actorId`; claimed-vs-derived mismatch audited; evidence labels; no behaviour change for legacy clients (mixed-version tests).
- **C — devices and sessions:** enrollment with single-use manager-created code; cross-tenant enrollment refused; device credential can't enroll/approve another device; staff session bound to device (use on another device refused); actor substitution refused; staff switch issues a new session and clears approvals; revocation of staff and device; storage deletion and credential recovery on the till.
- **D — envelope and hub relay:** tampered payload, replayed op, concurrent duplicate, same id changed payload, lost response after commit, lost cloud acknowledgement; hub attestation: wrong issuer, unknown key, rotated key, revoked key, wrong audience, cross-store forwarding, replay.
- **E — manager approval:** correct approval; wrong PIN; inactive manager; manager lacks permission; approval from another device/store; reuse on another op; amount/items changed after approval; expiry; repeated confirm idempotent; offline without fresh unlock refused; cashier remains actor afterwards.
- **F — revocation/review:** revoked user/device with pending cash sale, debt sale/payment, refund, supplier payment, stock adjustment → held with money/stock effects shown; resolution once, no duplicate effects; restart before/after each persistence boundary.
- **G — enforce gate:** compatibility check; returning old/retired device; device that aged out is not implicitly safe.
- **H — installed acceptance:** clean short-path checkout of the exact commit; disposable store and data dir; guarded launchers; Electron hub screen, paired browser till, direct-cloud till, offline/reconnect, staff switch and approval, PIN reset and revocation, pending recovery, hub forwarding, supported legacy versions; installer path and SHA-256 recorded; not the Sprint 1 candidate.

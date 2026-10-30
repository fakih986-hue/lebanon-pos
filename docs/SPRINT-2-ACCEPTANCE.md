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
| Containment release `hotfix/containment-1.0.50` from deployed `7df7c58`: containment + Sprint 0 server port + refused-work preservation | 420 + 5 expected fail on a schema migrated with the deployed migrations; 14 negative controls; release matrix, cashier-connected decision and shared-PIN transition in `docs/HOTFIX-CONTAINMENT.md` on that branch | ready for approval, **not deployed** |

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

## Plan by phase (to be filled with evidence as implemented)
- **B — observe mode:** token kinds (`typ/iss/aud`) on new tokens with old tokens still accepted; `requireCloudKeyOrJwt` refuses non-staff tokens; envelope parsing; derived `actorId`; claimed-vs-derived mismatch audited; evidence labels; no behaviour change for legacy clients (mixed-version tests).
- **C — devices and sessions:** enrollment with single-use manager-created code; cross-tenant enrollment refused; device credential can't enroll/approve another device; staff session bound to device (use on another device refused); actor substitution refused; staff switch issues a new session and clears approvals; revocation of staff and device; storage deletion and credential recovery on the till.
- **D — envelope and hub relay:** tampered payload, replayed op, concurrent duplicate, same id changed payload, lost response after commit, lost cloud acknowledgement; hub attestation: wrong issuer, unknown key, rotated key, revoked key, wrong audience, cross-store forwarding, replay.
- **E — manager approval:** correct approval; wrong PIN; inactive manager; manager lacks permission; approval from another device/store; reuse on another op; amount/items changed after approval; expiry; repeated confirm idempotent; offline without fresh unlock refused; cashier remains actor afterwards.
- **F — revocation/review:** revoked user/device with pending cash sale, debt sale/payment, refund, supplier payment, stock adjustment → held with money/stock effects shown; resolution once, no duplicate effects; restart before/after each persistence boundary.
- **G — enforce gate:** compatibility check; returning old/retired device; device that aged out is not implicitly safe.
- **H — installed acceptance:** clean short-path checkout of the exact commit; disposable store and data dir; guarded launchers; Electron hub screen, paired browser till, direct-cloud till, offline/reconnect, staff switch and approval, PIN reset and revocation, pending recovery, hub forwarding, supported legacy versions; installer path and SHA-256 recorded; not the Sprint 1 candidate.

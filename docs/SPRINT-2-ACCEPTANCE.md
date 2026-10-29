# Sprint 2 — acceptance plan and results

Canonical record of what is tested and what passed. Real services, real API handlers, real PostgreSQL (scratch DB only), bounded concurrency (`apps/api/vitest.config.ts`). Negative controls restore the specific original behaviour and must fail for the business reason.

## Results so far (Phase A)

| Area | Evidence | Status |
|---|---|---|
| Customer token is not a staff credential; sync push fails closed for non-staff; cross-store forged token refused; refused callers leave no gate record | `apps/api/__tests__/sprint2-identity.test.ts` (4; plus 1 expected-failure probe: a driver can adjust stock — open, matrix §2) — negative control (original skip restored): 4/4 fail for the business reason | **pass** (`b21e9d8`) |
| Stock-revision ids on plain-HTTP tills | `apps/desktop/src/__tests__/randomUuid.test.ts` (2) | **pass** (`3300ae1`) |
| Crypto runtime support | measured in the browser pane: plain-HTTP LAN origin vs loopback (PLAN §1) | recorded |
| Full suites | API 473 + 1 expected fail (S4); desktop (unchanged) 415 + 2 | pass |

## Plan by phase (to be filled with evidence as implemented)
- **B — observe mode:** token kinds (`typ/iss/aud`) on new tokens with old tokens still accepted; `requireCloudKeyOrJwt` refuses non-staff tokens; envelope parsing; derived `actorId`; claimed-vs-derived mismatch audited; evidence labels; no behaviour change for legacy clients (mixed-version tests).
- **C — devices and sessions:** enrollment with single-use manager-created code; cross-tenant enrollment refused; device credential can't enroll/approve another device; staff session bound to device (use on another device refused); actor substitution refused; staff switch issues a new session and clears approvals; revocation of staff and device; storage deletion and credential recovery on the till.
- **D — envelope and hub relay:** tampered payload, replayed op, concurrent duplicate, same id changed payload, lost response after commit, lost cloud acknowledgement; hub attestation: wrong issuer, unknown key, rotated key, revoked key, wrong audience, cross-store forwarding, replay.
- **E — manager approval:** correct approval; wrong PIN; inactive manager; manager lacks permission; approval from another device/store; reuse on another op; amount/items changed after approval; expiry; repeated confirm idempotent; offline without fresh unlock refused; cashier remains actor afterwards.
- **F — revocation/review:** revoked user/device with pending cash sale, debt sale/payment, refund, supplier payment, stock adjustment → held with money/stock effects shown; resolution once, no duplicate effects; restart before/after each persistence boundary.
- **G — enforce gate:** compatibility check; returning old/retired device; device that aged out is not implicitly safe.
- **H — installed acceptance:** clean short-path checkout of the exact commit; disposable store and data dir; guarded launchers; Electron hub screen, paired browser till, direct-cloud till, offline/reconnect, staff switch and approval, PIN reset and revocation, pending recovery, hub forwarding, supported legacy versions; installer path and SHA-256 recorded; not the Sprint 1 candidate.

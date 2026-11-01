# Sprint 2 — threat model (staff/device evidence and business authorization)

Scope: who did a business operation, on which device, under what authority, and what the server can actually know. Not a general security audit. Architecture: [SPRINT-2-PLAN.md](SPRINT-2-PLAN.md).

## 1. Properties — kept separate

| Property | Established by | Not established by |
|---|---|---|
| **Staff authentication** | A server (hub or cloud) verifying the PIN (bcrypt) — at session issue or approval time | A token on a device; a device signature; a local SHA-256 verifier match (that is a *local* check, reported as such) |
| **Device authentication** | Enrolled device credential (bearer); proof-of-possession of a non-extractable key where WebCrypto exists | A `deviceId` string in a request (today: anyone can send any id) |
| **Operation integrity** | TLS to the cloud; payload digest bound into approvals/attestations; JWS by the hub over the digest | Plain-HTTP LAN transport (none in transit); a client that is itself modified |
| **Authorization** | Server evaluation of the **derived** actor's permissions (and approver's) at receipt | Payload fields naming a manager (`recordedById`, `cashierId`) |
| **Freshness / revocation knowledge** | Server receipt time; `tokenVersion`/`active` checked at receipt; session `exp` | Client timestamps; whether a revocation happened "before" an offline event |
| **Device not compromised** | Nothing in this design | — residual risk, stated |
| **Event time** | Only server receipt time is independent. Client time is **claimed**; device sequence numbers give order per device, not time | Client clock, even with a server anchor (a compromised machine can lie) |

## 2. Credential issuance and operation forwarding

```mermaid
flowchart LR
  subgraph Store
    T1[Browser till<br/>plain-HTTP LAN] -- PIN --> H
    T2[Hub's own screen<br/>localhost] -- PIN --> H
    H[Hub API<br/>verifies PIN (bcrypt)<br/>issues staff session + device credential<br/>hub key: ES256]
  end
  T3[Direct-cloud till<br/>HTTPS] -- PIN --> C
  H -- "envelope (op + evidence) + hub JWS attestation<br/>x-cloud-key (transport only)" --> C[Cloud API<br/>verifies hub JWS against enrolled hub key<br/>authorizes the attested actor]
  O[Owner portal] -- password --> C
  O -. "enrolls hub key / approves device enrollment" .-> C
  T1 -- "op + device credential + staff session ref" --> H
  T2 -- same --> H
  T3 -- same --> C
```
What each arrow can prove is listed in §1; the cloud's verification of a hub JWS proves *the hub said so*, never that an employee typed a PIN. Implemented (Phase D): the cloud records `attestation` per relayed operation and keeps the hub's evidence label — an offline claim attested by a hub is still `offline-claimed`. A manager approval proves this server checked that manager's PIN for that record and those values; it does not prove the manager stood at the register.

## 3. Threat cases

| # | Threat | Today | After Sprint 2 (design) | Residual |
|---|---|---|---|---|
| 1 | Cashier substitutes another staff ID | Works: actor fields are client-written; push authorized as the connecting account (often owner) | Actor derived from the server-issued staff session; payload actor ignored (mismatch audited) | Cashier who knows a manager's PIN can sign in as the manager |
| 2 | Cashier copies an approved device ID | Works: device id is a plain string | Device credential required; id alone is useless; PoP key non-extractable in secure contexts | HTTP LAN: bearer credential can be copied by someone with access to the device or the network |
| 3 | Stolen device credential | 30-day token, owner-level | Device credential short-lived and revocable; carries no staff authority; business ops still need a staff session | Thief who also knows a staff PIN can act as that staff on that device until revocation |
| 4 | Replayed grant or approval | n/a (no approvals); op-id dedupe exists | Approvals single-use, bound to op id + digest; sessions bound to device; op ids idempotent | — |
| 5 | Approval applied to a different amount/operation | n/a | Approval binds tenant, device, op id, payload digest and material fields; any change invalidates | — |
| 6 | Operation edited after approval | n/a | Digest mismatch → approval invalid → op held/refused | Compromised client edits *before* asking for approval (the manager sees what the screen shows) |
| 7 | Manager signs in once, cashier reuses cached authority | Works: session switch persists; `getCurrentUser` falls back to another user | Approval is per-operation; switching user clears pending approvals; no staff session reuse across PIN unlocks | Shared PIN knowledge |
| 8 | Staff loses permission while till offline | Till keeps old permissions until next pull | Online: refused at receipt. Offline ops: evaluated at receipt against *current* permissions; failures held for review, not dropped | Offline till can still let them *ring up* the action; money effect needs review |
| 9 | PIN reset while till offline | Old local verifier works until pull (pinVersion gate) | Same locally; server sees session `av` older than staff `tokenVersion` → `held` for ops after reset knowledge | Cannot date offline ops relative to the reset |
| 10 | Device revoked with pending work | No device revocation | Revoked device's credential refused; its queued ops arrive as `held` (never discarded) | — |
| 11 | Hub compromised | Hub is a superuser at the cloud (`cloud-bridge`) | Hub can only attest for **its** tenant; cloud authorizes the attested actor's permissions; hub key revocable | A compromised hub can invent staff evidence for its own store; detectable only by audit |
| 12 | Hub submits as a different store | Store key + `x-tenant-id` must match (per-tenant key); legacy global `CLOUD_API_KEY` addresses any store | Hub key enrolled per tenant; attestation tenant must equal key's tenant; global key removed for business ops | — |
| 13 | Old hub forwards a new operation | Accepted as `cloud-bridge` | No attestation → `claimed-legacy`; in enforce mode, restricted ops from legacy hubs held | During observe mode, legacy trust continues by design |
| 14 | Client clock changes / rolls back | Client times trusted for display | Claimed time labelled; device sequence detects reordering; server receipt time authoritative | Historical execution time unprovable |
| 15 | Same operation concurrently | Handled (claim row, Sprint 0/1 tests) | Unchanged | — |
| 16 | Same ID, changed payload | Refused (`OPERATION_ID_REUSED`) | Unchanged; evidence lives outside the digest so renewal doesn't trip it | — |
| 17 | Browser storage copied to another machine | Token + PIN verifiers copied work | Secure contexts: PoP key non-extractable, copy is useless; HTTP LAN: bearer copy works until revoked | HTTP LAN residual; offline verifiers (SHA-256 of 4–6 digits) brute-forceable from a copy |
| 18 | XSS / modified local software | Full control | Same: running malicious script can use non-extractable keys and read tokens | Encryption at rest does not help against running code |

## 3a. Attribution in observe mode (S4) — what is and is not proven
The expected-failure probe S4 (`cafe-audit.test.ts`) stays red-by-design: in **observe mode** (every store's default) the server authorizes a register's operation by its **connection account** (the account the register connected to the store with) and records the cashier the command names. A register connected with a manager's account, or work a cashier queued that the register sends after a manager reconnects it, applies under the manager's permissions and is attributed to the named cashier. Observed in the packaged run of this batch: a cashier's refused daily close was applied when the register re-sent it under the owner's connection; its evidence says so (session person Rana, valid; connection account Owner; `observe-mode-not-enforced`, `connection-account-not-proven-actor`). Authenticated attribution holds only (a) in an enforcing store, for register sales (the actor is the verified session's person), and (b) for a manager approval (the approver's PIN checked by the server; the approval bound to the requesting session's person). Everywhere else the actor is a claim with the evidence recorded beside it; nothing in this batch should be read as authenticated attribution in observe mode.

## 3b. Relayed approvals
A hub's signature over a forwarded approval proves the hub said it checked the manager's PIN for that command and used it in time; the cloud verifies that the approval's digest is the digest of the command it received (a hub cannot attach an approval for one command to another), but it cannot verify the PIN check itself.

## 4. Defects found during Phase A (evidence)
- **Fixed:** customer tokens accepted by `requireAuth`; sync push skipped all permission checks without a staff row (customer could change prices) — `b21e9d8`, tests `sprint2-identity.test.ts`.
- **Fixed:** `crypto.randomUUID` used on HTTP LAN tills — `3300ae1`.
- **Open (Phase B):** `requireCloudKeyOrJwt` (`setup.ts:83`) accepts any tenant-bound JWT incl. customer tokens for `/api/setup/pull-from-cloud` and `/tenant-info`.
- **Open (Phase B):** legacy global `CLOUD_API_KEY` can address any store (`cloudAuth.ts`).
- **Open (Phase B/C):** PIN login picks the highest role when several staff share a PIN (`auth.ts:217-235`) — two staff with the same PIN makes attribution ambiguous; uniqueness is enforced on staff writes (`assertPinFree`) but legacy duplicates may exist.
- **Open (matrix):** several stock/debt operations have no server permission mapping (see authorization matrix §2).
- **Noted, outside scope:** hub `.env` holds `ADMIN_PASSWORD` and `JWT_SECRET` in plaintext (Electron `safeStorage` unused).

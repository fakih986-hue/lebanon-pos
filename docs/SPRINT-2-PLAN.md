# Sprint 2 — authenticated staff, device trust, approvals and offline safety

**Canonical architecture document.** Status: **Phase A approved in principle (credential architecture). Phases B and C implemented; D (hub keys and attested forwarding), E (online manager approval: checkout discount, price below list and sale at cost in Full and Simple POS; refund, void, cash payout) and F (review of held work) implemented on branch `dev/staff-auth-approvals` (2026-11-01, completed by the staff-auth batch); Part 5 boundary checks added; daily closes per register and shift with linked corrections (§2.7). Containment (Track A) implemented separately. Not deployed; nothing enforced; every store stays in observe mode.** Defaults set by the owner: routine offline sales unchanged; queued completed work never expires; existing stores start in observe mode; no enforcement switches on automatically; plain-HTTP LAN supported with an explicit transport limitation; restricted actions use permissions (no invented thresholds); a cached manager grant is never used without fresh manager authentication. Offline elevated-action policy and thresholds remain open decisions. Policies live in their own documents and are not repeated here:
[threat model](SPRINT-2-THREAT-MODEL.md) · [authorization matrix](SPRINT-2-AUTHORIZATION-MATRIX.md) · [offline policy](SPRINT-2-OFFLINE-POLICY.md) · [compatibility](SPRINT-2-COMPATIBILITY.md) · [acceptance](SPRINT-2-ACCEPTANCE.md).

Base: `master` after Sprint 1. The preserved candidate `candidate/1.0.51-rc-097ed68` (`D:\TitanPOS-candidates\1.0.51-097ed68\`) is **not** part of Sprint 2 and is not modified.

## 1. Current state (inspected, with evidence)

| Area | Fact (file) |
|---|---|
| Tokens | Every token — staff, driver, customer, hub `__admin__`, owner `__admin__` — is an HS256 JWT signed with the same `JWT_SECRET`, 30 days, **no `iss`/`aud`/`typ`** (`middleware/auth.ts`, `routes/delivery.ts:900`, `routes/setup.ts:506`, `routes/admin.ts:85`). |
| Till connection | The till's sync token is the token of **whoever pressed Connect** (`LoginScreen.tsx:196-248`). `adoptRefreshedToken` only replaces it with a token for the **same** user (`sync.service.ts:312`). A cashier's PIN unlock never changes the credential used for sync. |
| Hub's own screen | `POST /api/setup/auto-login` (localhost, no credentials) → store-level `__admin__` token; `accessOf()` treats `__admin__` and `cloud-bridge` as **every permission** (`middleware/permission.ts:16`). |
| Hub → cloud | `x-cloud-key` + `x-tenant-id` → `cloud-bridge`, **every permission**; original device and actor survive only as payload fields (`cloudSync.ts:1159`, `cloudAuth.ts:42`). |
| Staff actor on records | Written by the till from `getCurrentUser()`; sale/refund carry only the cashier **name**; void carries no actor; stock adjustments, counts, debt, products, settings carry none (till inventory). The server checks `openedById/closedById/recordedById` only for consistency (`lib/permissions.ts:65`, comment: "CLIENT-ASSERTED"). |
| PIN check | Online: bcrypt at `/api/auth/login`, scanning all active staff of the store; **several matches → highest role wins** (`routes/auth.ts:217-235`). Offline: unsalted SHA-256 verifier in `lebanonpos.users.v1`, gated by `pinVersion` (`security.service.ts:599-649`). |
| Switching | `lockSession` keeps `current-user`; `setCurrentUser` switches with **no PIN** (Staff page, `staff.manage`); `getCurrentUser` **falls back to the first active user** when the current one is missing/inactive (`security.service.ts:416`). |
| Devices | `deviceId` = random string the till invents (`Math.random`, `sync.service.ts:415`); pairing (hub only) issues **no credential**; any authenticated caller can claim any approved id (`routes/device.ts:55-80`). Direct-cloud tills are never paired. |
| Manager approval | None. Restricted actions are blocked or need a full session switch. |
| Crypto runtime (measured) | Plain-HTTP LAN origin: **no `crypto.subtle`, no `randomUUID`**; `getRandomValues` and IndexedDB available. Loopback/HTTPS: WebCrypto with ECDSA P-256 and Ed25519, non-extractable keys storable in IndexedDB. Hub UI loads from `http://localhost:3015` (secure context). Hub serves LAN tills over plain HTTP; no TLS. Electron 42; `safeStorage` unused. |

Fixed during Phase A (commit `b21e9d8`): customer tokens were accepted by `requireAuth` and the sync push **skipped every permission check** for accounts without a staff row — an ordering-app customer could change prices. Commit `3300ae1` fixed `crypto.randomUUID` on HTTP LAN tills (affects the preserved candidate; documented, candidate unchanged).

## 2. Chosen design

### 2.1 Principle
**Staff identity is established by the server that verifies the PIN, and recorded by that server on every operation it accepts.** Client-side cryptography is used only where it adds a real property (binding to a device that cannot be copied), never as a substitute for server verification, and never labelled stronger than it is.

### 2.2 Credentials (minimum set)

| Credential | Issued by / to | Proves | Does **not** prove |
|---|---|---|---|
| **Device credential** — `typ: device`, `iss` = issuing server, `sub` = server-assigned device id, `tid` = tenant, `ver` = device version; short-lived access token renewed by the device | Issuing server (hub for its LAN tills and its own screen; cloud for direct tills) after **approved enrollment** (pairing code created by a manager, consumed once) | That the request comes from an enrolled, unrevoked device record of this tenant (bearer) — and, where proof-of-possession is available (§2.4), that it comes from the device holding the enrolled key | Which employee is using it; that the device is uncompromised |
| **Staff session** — `typ: staff`, `iss`, `aud` = tenant, `sub` = staff id, `dev` = device id, `av` = staff authorization version (`tokenVersion`), `amr: ["pin"]`, `auth_time`, `exp` | Server that verified the PIN (bcrypt) for **that** device | That this server checked this staff member's PIN for this device at `auth_time` | That the staff member is still physically present later; anything after the device was compromised |
| **Server identity** (hub only) — an ES256 key pair generated by the hub; public key enrolled at the cloud | Enrolled by the owner during hub activation (owner credential + store key), bound to one tenant; key id + rotation + revocation at the cloud | That an envelope/attestation was produced by that enrolled hub | That the hub verified a PIN honestly — a compromised hub can attest anything for its tenant (bounded to that tenant) |

Rejected alternatives: a single long-lived connection token (today's problem); per-operation client signatures as the *primary* evidence (adds no proof of PIN freshness; impossible on HTTP LAN without a JS crypto library; a compromised client signs anything); symmetric per-device HMAC secrets shared with the cloud (secret distribution through the hub); three bespoke credential types with custom formats (use JWT/JWS via a maintained library — `jose` on the server).

### 2.3 Operation envelope (sync schema/auth capability, see compatibility)
```
{ v: 1,
  op:   { id, entity, action, payload },                 // A. immutable business command
  ev:   { device: <device token or device-session ref>,  // B. evidence (as sent)
          staff:  <staff session ref>,
          approval?: <approval id>,
          seq: <device sequence number>,                  //    replay/ordering, per device
          claimedAt: <client time, CLAIMED> },
  srv:  { receivedAt, verifiedBy: <server id>, actorId, approverId?,   // C. server-derived
          evidence: "verified-online" | "verified-session-offline" | "claimed-legacy" | "held",
          limitations: [...] },
  fwd?: { hub: <hub id>, attestation: <JWS over digest(op)+srv> } }    // D. forwarding
```
- **Immutable:** `op.id`, `op.entity`, `op.action`, `op.payload` (digest = SHA-256 over RFC 8785 canonical JSON). The existing op-id/payload mismatch protection stays as it is; Sprint 1's narrow exceptions (stock-policy decision fields, `legacy` stamp) remain the only payload fields excluded, and they move into `srv`/`ev` in v1 envelopes.
- **Can change without changing the command:** `ev` (token refresh, renewed session), `srv` (re-verification, review resolution), `fwd`.
- The actor is **never** read from `payload.cashierId / recordedById / openedById`; those become display hints compared against the derived actor (mismatch → audit).

### 2.4 Device binding by environment

| Environment | Device credential | Staff session | Evidence label |
|---|---|---|---|
| Electron hub screen (`http://localhost`, secure) | Device record for the hub's own screen; non-extractable WebCrypto key for proof-of-possession | Local hub verifies PIN | `verified-online` (hub) |
| Direct-cloud till (HTTPS) | Cloud-enrolled; non-extractable key (PoP) | Cloud verifies PIN | `verified-online` (cloud) |
| Browser till → hub on plain-HTTP LAN | Hub-enrolled; **bearer only** (no WebCrypto). Option: HTTPS on the hub (decision D3) | Hub verifies PIN | `verified-online` with limitation `transport-http-lan` (tokens visible on the LAN) |
| Fully disconnected till | Existing credentials; actions recorded locally | Staff unlocks with local verifier; session from last online PIN on this device | `verified-session-offline` with limitations (no fresh server PIN check; time claimed) — or `claimed-legacy` if no session exists |
| Legacy clients (1.0.50 / 1.0.51) | Today's connection token | none | `claimed-legacy` |

### 2.5 Hub relay
**Implemented:** the hub signs at forwarding time (ES256, jsonwebtoken) the operation's id, entity, action and command digest (valuation and policy-decision fields excluded — the same normalization as operation identity) with the evidence it recorded; `HubKey` enrolled at the cloud only with the PIN of a staff member holding settings.manage; rotation and revocation. The cloud keeps a hub's evidence as signed and its label (a claim stays a claim). Original design note:
The hub verifies its tills' evidence, applies the op, stores the v1 envelope, and forwards **the same envelope** plus `fwd.attestation` (JWS ES256 by the hub key over the op digest and the hub's `srv` fields). The cloud verifies the attestation against the enrolled hub key for that tenant, records `verifiedBy = hub`, and authorizes the business action against the **attested actor's** permissions at the cloud — `cloud-bridge` no longer implies every permission for business ops (it keeps sync duties: pull, forwarding, acks).

### 2.6 Manager approval
**Implemented (online only):** `ManagerApproval` binds a fresh server PIN check to one record (entity, action, record id) and its material values (amounts, lines, method, currency — not timestamps), one enrolled register and one permission; single use; 120 s to first use; approver re-checked on receipt. Offline approval is not implemented (D2 open). Original design note:
Separate approval record: online = manager PIN verified by the server against an **approval request** carrying the op digest and material fields → single-use approval id, short expiry, bound to tenant + device + op id + digest; offline = fresh local manager PIN entry bound to the op digest, labelled `offline-local` and limited by policy. Details and tests: authorization matrix §4 and offline policy §3.

### 2.7 Daily close (staff-auth batch)
A date is not one close (`apps/api/src/lib/dailyClose.ts`). Each close has a **scope**: the register's device (every register defaults to the label REG-001, so the label cannot tell registers apart; it is kept as `registerId`) and the shift open when it closed. Another register or shift: a separate close. The same scope again: a **correction** — a new revision linked to the close it corrects (`revisionOf`), the corrected close kept and marked `supersededById`; a register of this version names the close it corrects (`correctsId`) and is refused (`CLOSE_CONFLICT`, kept for review) when someone has corrected it since; an older register that cannot name it records a `re-close` revision. The same close again (retry, re-forward): nothing changes. Corrections of one scope are serialized (transaction-scoped advisory lock; revision unique per scope). Reports use the current revision of each scope; a hub mirrors the cloud's revisions and links; an older client is sent one close per date (the latest current one) without the new fields.

## 3. Phases
| Phase | Content | Depends on decisions |
|---|---|---|
| A | This architecture, threat model, matrix, offline policy, compatibility, acceptance plan | — |
| B | Server observe mode: token kinds (`typ`/`iss`/`aud`) for new tokens, envelope parsing and verification, evidence columns, `actorId` derived server-side, audit of claimed-vs-derived mismatch; nothing enforced beyond today | D1 |
| C | Device enrollment (server-assigned ids, single-use manager-created codes, cloud enrollment for direct tills), staff sessions bound to device, till uses staff session per unlock | D1, D3 |
| D | Envelope on the till, hub relay with attestation, hub key enrollment/rotation | D1 |
| E | Manager approval (online, offline) | D2, D4 |
| F | Reconnect/revocation review queue | D5 |
| G | Per-store observe → enforce gate | D6 |
| H | Installed and mixed-version acceptance, candidate build | — |

## 4. Decisions needed (Phase A close)
- **D1 Credential design** (§2.2–2.5): server-verified staff sessions + device credential + hub server key; client signing only for PoP in secure contexts. *Recommended.*
- **D2 Offline elevated actions:** allow with fresh local manager PIN, labelled and reviewed — or refuse offline. See offline policy.
- **D3 Plain-HTTP LAN tills:** (a) keep HTTP, bearer device credential, labelled `transport-http-lan` *(recommended for compatibility now)*; (b) HTTPS on the hub with a store-local certificate (installation/trust burden); (c) Electron-only tills.
- **D4 Restricted actions and thresholds:** matrix §3 lists candidates; values are the owner's call.
- **D5 Review routing:** which permission reviews which held operation (matrix §5 proposal).
- **D6 Enforcement default:** observe for existing stores; enforce only after the compatibility check passes and the owner switches it.
- **D8 Staff session lifetime:** 12 h is a provisional value (`apps/api/src/lib/credentials.ts`). In observe mode expiry only changes the recorded check; it matters once enforcement exists.
- **D7 Routine offline checkout:** keep unlimited (today's behaviour) with labelled evidence *(recommended)*, or a store-configured limit.

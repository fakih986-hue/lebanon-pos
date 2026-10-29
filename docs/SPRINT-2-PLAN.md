# Sprint 2 plan — authenticated staff identity and attribution

Status: **proposal for review. Nothing implemented.** Builds on candidate 1.0.51 (`097ed68`).

## 1. What exists today (inspected)

| Piece | Where | What it actually proves |
|---|---|---|
| **Connection token** | `POST /api/auth/login` → `signToken({userId, tenantId, role, tokenVersion})`, 30-day JWT (`middleware/auth.ts`) | That *someone* entered a valid staff PIN when the device connected. The till keeps that token for every push. |
| **Token refresh on PIN unlock** | `adoptRefreshedToken()` (`sync.service.ts`) | Accepts a new token **only for the same user** as the current one. A cashier's PIN unlock never replaces the owner's connection token, so **every push is authenticated as whoever connected the device** (often the owner). |
| **Hub's own UI** | `POST /api/setup/auto-login` → user `__admin__` | Store-level. `accessOf()` treats `__admin__` and `cloud-bridge` as holding every permission. |
| **PIN session on the till** | `unlockWithPin()` → `finalizeUnlock()` writes `current-user` + session to localStorage | Local only. The server never sees which staff member is at the till. |
| **Offline verifier** | Till stores SHA-256 of the PIN after an online sign-in; offline unlock checks it against the latest `pinVersion` it pulled | Who unlocked *this device's UI*. Readable by anyone controlling the device; 4–6 digit PINs are brute-forceable from it. |
| **Device identity** | `POST /api/device/pair` (hub only) stores `deviceId`; no secret is issued | Nothing: `deviceId` is a string in the request body. Any authenticated caller can claim any approved device id. Direct-to-cloud tills are not paired at all. |
| **Actor on records** | `Sale.cashierId`, `Shift.openedById/closedById`, `CashMovement.recordedById`, `Expense.recordedById`, … written by the till | **Client-asserted.** `recordedActorRule()` checks the named staff exists and holds the permission — a consistency check, not authentication (code comment + `docs/PERMISSIONS-ENFORCEMENT.md`). |
| **Server permission checks on push** | `requiredPermissionForOp()` against the **pushing account** | Checks the connection token's account (owner) or store-level (`__admin__`, `cloud-bridge` = everything), not the cashier. |
| **Hub → cloud** | Bridge pushes with the store key (`x-cloud-key`) as `cloud-bridge` | The cloud trusts the hub completely; the original actor and device are lost except as payload fields. |
| **Manager approval** | Price below list = `PRICE_OVERRIDE` rejection; Sprint 1 stock decisions = client-named manager | No authenticated approval exists. |
| **Revocation** | `tokenVersion` bump (logout, PIN reset) invalidates **all** that user's tokens; `active=false` | Online sessions only. Offline verifiers keep working until the next pull; no device revocation. |

**Consequence (the S4 probe):** the server cannot tell which staff member performed a sale, refund, void, drawer movement or approval. Permissions are effectively those of the device's connecting account.

## 2. Goals and non-goals

Goals: (a) every business operation carries the *actual* staff actor with evidence the server can verify; (b) restricted operations are authorized from that evidence; (c) manager approvals are authenticated, online and offline; (d) offline operation keeps working within explicit limits; (e) revoking a staff member or device never loses completed work; (f) old tills/hubs keep working during rollout.

Non-goals (this sprint): replacing PINs with passwords/biometrics; SSO; changing the owner portal login; encrypting local data at rest; hardware-backed key storage.

## 3. Design

### 3.1 Three separate credentials (instead of one connection token)
1. **Device key** — at pairing, the till generates a signing key pair (ECDSA P-256) and registers the **public** key. The server issues a **device token** (JWT `{deviceId, tenantId, kind:"device"}`) that replaces today's user connection token for sync. Device keys are revocable individually. Direct-to-cloud tills get the same pairing on the cloud (today only hubs pair).
2. **Staff grant** — when a staff member unlocks **online**, the server verifies the PIN and issues a short **staff grant**: a server-signed token `{grantId, staffId, deviceId, tenantId, permissions snapshot, pinVersion, tokenVersion, issuedAt, expiresAt}` bound to that device. Online grants are short (e.g. 12 h); an **offline window** (store setting, default 24 h, max 72 h) bounds how long a grant may cover operations created without contact.
3. **Server key per issuer** — grants are signed with an asymmetric key (hub key / cloud key), so a hub's grants can be verified by the cloud. The hub's public key is registered with the cloud at activation.

### 3.2 Operation evidence (every business op)
The till signs each operation with the device key over `(opId, entity, action, payloadHash, staffGrantId, createdAt)` and attaches `{ grant, signature }`. The receiving server verifies: grant signature (issuer key), grant bound to this device, device key active, signature over the exact payload, op `createdAt` within the grant's validity window (+ bounded clock skew), staff not revoked *for operations received after revocation* (§3.5). Result recorded per operation as **evidence level**:
- `verified` — valid grant + device signature, received online or within the window;
- `verified-offline` — as above, received after the grant expired but created inside its window;
- `claimed` — no evidence (older client) — today's behaviour, kept visible;
- `rejected-evidence` — evidence present but invalid (tampered, wrong device, revoked device). The op is **held for review, never applied silently and never deleted** (§3.5).

The actor written to `cashierId` / `recordedById` / `openedById` comes **from the verified grant**, not the payload. A mismatch with the payload's claimed actor is audited.

### 3.3 Permission checks from evidence
`requiredPermissionForOp()` is evaluated against the **grant's staff member** (permissions snapshot at grant time ∩ current permissions when received online). The device token alone authorizes only device-level sync (pull, non-business ops). Store-level identities (`__admin__`, `cloud-bridge`) stop implying staff permissions for business ops: the hub's own UI uses staff grants like any till; the bridge relays evidence (§3.6) instead of acting as a superuser.

### 3.4 Manager approval for restricted actions
Restricted actions (price below list / override, discount above a limit, void, refund over a limit, drawer pay-out, stock decisions from Sprint 1, any action the cashier lacks): the till asks a manager to enter their PIN **on the till**.
- **Online:** the server checks the manager's PIN and returns an **approval token** bound to `(opId, action, payloadHash, managerId, deviceId)`, short-lived (minutes). The op carries it; the server verifies it and records `approvedById` from the token.
- **Offline:** allowed only if the manager holds a still-valid staff grant on **this** device (they unlocked online here within the window). The till verifies the PIN against the local verifier and signs an approval with the device key referencing the manager's grant. The server verifies it like §3.2 and records `approval evidence = verified-offline`.
- Without either, the till refuses the action **before payment**.
This replaces Sprint 1's client-named stock-decision manager.

### 3.5 Offline authorization and its limits
- Offline unlock still uses the local verifier, but offline **operations** are only attributable within the grant's offline window; after it, the till requires an online unlock (it can still be locked/unlocked for viewing, not trading — exact UX to decide).
- Permissions offline are the grant's snapshot; a permission removed online takes effect for that device at the next online contact.
- Clock: the till cannot be trusted for time; acceptance uses `max(createdAt, grant.issuedAt)` bounded by `grant.expiresAt + window`, and the server's receipt time is recorded.
- Stated limit: someone with full control of an unlocked device during the window can act as the staff member whose grant is there (same as today's local PIN session, but now bounded and attributable to the device).

### 3.6 Revocation without losing completed work
- Revoke **staff** (deactivate, PIN reset, permission change): server stops issuing grants immediately; online grants rejected at once; operations already created under a still-valid grant and received later are accepted if created before the server-recorded revocation time within the window, otherwise **held for review**.
- Revoke **device**: device key/token invalid at once; its queued operations, when they arrive, are **held for review** (paid sales are recorded with attribution `held`, money never discarded); a manager decides with an authenticated approval (§3.4). Nothing is deleted.
- Review queue: one server-side list of held operations (reuses the Sprint 1 pattern), visible on any current till to managers, resolved with authenticated approval, fully audited.

### 3.7 Hub relay
The hub verifies evidence from its tills (it holds their public keys and issued their grants), applies the op, and forwards it to the cloud **with the original evidence** plus a hub attestation signed by the hub key. The cloud verifies the hub attestation and, where it has the device public key (forwarded with device records), the original signature. `cloud-bridge` no longer implies "every permission" for business ops.

## 4. Compatibility and migration
- **Sync schema 4.** New clients send evidence; servers record evidence level. Older clients (schema ≤ 3) keep working, recorded as `claimed` (exactly today's trust level, now visible).
- **Rollout:** cloud → hubs → tills, as in Sprint 1. The SyncClient table from Sprint 1 already shows which clients are on which schema.
- **Enforcement is a per-store switch**, off by default, available once no client older than schema 4 has traded in the window (same mechanism as the stock-policy gate). When on: restricted ops without valid evidence are refused **at the till before payment** (hub-connected) or held for review (direct/offline) — never rejected after payment.
- **Re-pairing:** existing paired devices get a device key on first sync after upgrade (an authenticated online staff unlock is required to bind it); direct-to-cloud tills pair with the cloud once.
- **Database (additive):** `DeviceKey` (deviceId, publicKey, status, revokedAt), `StaffGrant` (id, staffId, deviceId, issuer, issuedAt, expiresAt, revokedAt), `IssuerKey` (hub/cloud public keys); on business tables `actorEvidence`, `approvedById`, `approvalEvidence`; a `HeldOperation` view/table for review. No destructive changes; existing rows = `claimed`.
- **Browser tills on plain-HTTP LAN** have no WebCrypto (not a secure context). Option: a vetted pure-JS signing library (`@noble/curves`) — works everywhere, but private keys are then extractable from storage. Electron tills (secure context) can keep non-extractable keys. **Decision needed.**

## 5. Phases (bounded)
1. **Foundations, report-only (server):** device keys + device token, staff grants, issuer keys, evidence verification, evidence columns, hub relay of evidence. No enforcement; everything recorded and audited. Real hub+cloud tests incl. tampering (forged actor, altered payload, replay, wrong device, revoked device, expired grant, clock skew).
2. **Till:** key generation and op signing, online/offline grants, manager-approval prompt (online token / offline grant), Sprint 1 stock decisions moved onto it; en/ar; UI states for "approval needed", "online unlock required".
3. **Enforcement switch + review queue:** per-store enforcement, held-operation review with authenticated approval, revocation flows; acceptance on installed hub with a paired till, offline window, revocation, old-client coexistence. Flip S4 probe to a passing assertion.

## 6. Decisions needed before implementation
1. Offline window default and maximum (proposed 24 h / 72 h).
2. Whether offline manager approval is allowed at all (proposed: yes, only with the manager's grant on that device).
3. Plain-HTTP browser tills: accept extractable JS keys, or require Electron/HTTPS for attested operation.
4. Which actions are "restricted" and their limits (discount %, refund amount, pay-out amount).
5. Enforcement default for new stores (proposed: on for new stores, opt-in for existing ones after their tills upgrade).

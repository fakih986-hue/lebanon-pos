# Staff enforcement ("enforce") — hub and cloud

Sprint 2, hub batch. Status: implemented on `dev/staff-auth-approvals`, tested in process (real PostgreSQL)
and against a packaged hub. **Production stores stay in observe mode.** Enforcement is switched on only
explicitly, by the owner at the cloud, and in this batch only on disposable test stores.

Related: [SPRINT-2-AUTHORIZATION-MATRIX.md](SPRINT-2-AUTHORIZATION-MATRIX.md) (permissions and approvals),
[SPRINT-2-OFFLINE-POLICY.md](SPRINT-2-OFFLINE-POLICY.md), [SPRINT-2-COMPATIBILITY.md](SPRINT-2-COMPATIBILITY.md),
[SPRINT-2-THREAT-MODEL.md](SPRINT-2-THREAT-MODEL.md), [LEGACY-TILL-COMPAT.md](LEGACY-TILL-COMPAT.md).

## 1. Modes

| Mode | What the server authorizes | Scope |
|---|---|---|
| `observe` (default, every existing store) | The account the register connected with. The person the register names is recorded as a **claim** (`evidence: legacy-claimed` / `claimed`), with its device and session as checked. Nothing is refused for identity. | — |
| `enforce-checkout` | As observe, except an ordinary **sale** needs an enrolled register and a server-checked staff session, and is recorded as that person's. | **Sales only. Partial; not platform-wide.** |
| `enforce` | **Every register operation and every staff REST permission check** is the person of the verified staff session on an enrolled register (or a person sign-in to the admin app). The connection account carries no authority. | Hub and cloud. Deferred items in §7. |

S4 (a register naming another staff member) is two explicit expectations, both tested:
- observe: the sale is recorded as named, and the evidence says it is a claim (`cafe-audit.test.ts`);
- enforce, online: a substituted actor obtains no authority — the sale is the session person's, a discount
  needs their own permission or an approval, a payout naming someone else is refused as `IDENTITY_MISMATCH`
  (`staff-enforce.test.ts`, `installed-hub-enforce.test.ts` "Rana on her own connection").

## 2. Three identities, kept apart

| | What it is | Proves | Gives authority in `enforce` |
|---|---|---|---|
| Transport (connection) | The register's login token (`use: "transport"`, sent by register sign-ins as `client: "register"`) or the hub screen's local token | Which store and account the register is connected with | **No** |
| Device | `x-device-credential` of an enrolled register | Which enrolled register sent it | Required, not sufficient |
| Staff session | `x-staff-session` (and `ev.session` on each queued operation): opened after the server checked this person's PIN on this device | Who is at the register | **Yes** — that person's permissions |
| Person sign-in | The admin app's login (`use: "person"`, `client: "person"`) | The person signing in | **Yes** — that person's permissions |
| Manager approval | A one-time approval bound to the exact operation and its business fields | A manager allowed this operation | Adds that permission for that operation only; the actor stays the cashier |
| Reviewer | The person resolving held work | Who decided | Their own permissions authorize applying it; actor, approver and reviewer are recorded separately |

An owner connection does not give the cashier owner permissions: tested at the hub (REST and sync), at
the cloud, through the packaged hub and through the register's own services.

## 3. Operation matrix (enforce)

"Session person" = the person of a valid, unexpired, not-ended staff session on an enrolled register.

| Operation | Permission | Online, session person has it | Lacks it | Approval | Offline claim (register says it did it offline) |
|---|---|---|---|---|---|
| Sale (checkout) | `sales.checkout` (+ `sales.discount` for a discount, `sales.price_override` below list) | Applied as that person (cashier fields rewritten to them) | Refused, held for review | Manager approval for discount / price | **Routine sale accepted** as offline-claimed; a discounted or overridden one is held (`OFFLINE_REVIEW`) |
| Refund | `sales.refund` | Applied | Held | Yes | Held (`OFFLINE_REVIEW`) |
| Void | `sales.void` | Applied | Held | Yes | Held |
| Payout / cash movement | `cash.manage` | Applied, recorded as that person | Held | Yes | Held |
| Stock adjustment / count | `inventory.adjust` | Applied | Held | — | Held |
| Receiving | `inventory.receive` | Applied | Held | — | Held |
| Customer / debt | `customers.manage` (debt at checkout: `sales.checkout`) | Applied | Held | — | Held |
| Supplier payment / purchase order | `suppliers.manage` | Applied | Held | — | Held |
| Expense, daily close | `accounting.manage` | Applied | Held | — | Held |
| Staff changes | `staff.manage` | Applied | Held | — | Held |
| Settings | `settings.manage` | Applied | Held | — | Held |
| Recovery decisions (resolve held work) | Reports or a manager permission to see; the **reviewer's** permissions to apply | Applied once (`409` for a second decision) | `403` | — | Online only |
| Manager approval itself | The approver's PIN checked by the server | — | — | — | **Online only** (never offline) |

Every refusal keeps the operation: the register's queue keeps it and the server holds it in the review list.
Nothing completed is discarded, and no customer is charged again to resolve synchronization.

Refusal codes: `IDENTITY_REQUIRED` (no enrolled device, no session, invalid session, inactive person),
`SESSION_REVIEW` (session expired or signed out before the operation arrived), `OFFLINE_REVIEW`,
`IDENTITY_MISMATCH` (the operation names another person), `HUB_UNSUPPORTED` (cloud: a forward the hub did
not sign, or a reviewer who is not active), plus the ordinary permission refusals.

## 4. Policy: issued, versioned, cached, synchronized

- **Issued at the cloud only**: `POST /api/sync/identity-mode` by a person with `settings.manage` signed in as
  themselves; the hub answers `409 HUB_SERVER`. Each decision increments `Tenant.staffPolicyVersion`
  (with `staffPolicyIssuedAt`, `staffPolicyIssuedBy`) and is audited.
- **Gate**: `enforce` is refused (`409 IDENTITY_GATE`) while any blocker in §5 remains.
- **Synchronized**: every hub pull carries `staffPolicy {mode, version, issuedAt, issuedBy}`.
- **Adopted only when newer**: the hub stores a policy only if its version is higher than its own
  (audited `security.staff_policy.adopted`). An absent, equal or older policy is ignored.
- **Cached**: the policy is stored in the hub's own database. A disconnected hub, a restarted hub, a cloud
  outage or a stale pull never lowers it. Tested in process and on the packaged hub (LAN only, restart).
- **Lowering** is an explicit newer decision at the cloud (e.g. observe, version 2), adopted the same way.
- Registers read the mode from the server they sync with and show it (enforced badge); the server decides.

## 5. Activation and returning devices

`GET /api/sync/identity-gate` (cloud) lists blockers. **An activity window is not proof**: every client the
store has ever seen counts until the owner retires it.

| Blocker | Meaning | How it is cleared |
|---|---|---|
| `upgrade-needed` | A register on a sync schema below 5 | Upgrade it, or retire it (with a note) |
| `not-enrolled` / `device-not-enrolled` | A register seen (or an approved device never seen) without enrollment | Enroll it, or retire / revoke it |
| `no-identity-evidence` | Its latest operation did not carry a valid device credential and session | Sign in on it once (server PIN check), or retire it |
| `no-device-id` | An old account-only client (`user:*`) | Retire it |
| `hub-upgrade-needed` / `hub-not-enrolled` / `hub-unattested` | A hub link below schema 5, without an active hub key, or whose latest forward was not validly signed | Upgrade / enroll the hub key / let it forward once |
| `hub-register-unverified` | A register seen only through a hub whose latest forwarded operation had no verified device and session | Sign in on it, or retire it: `POST /api/sync/hub-registers/:deviceId/retire` with a note (audited) |

After enforcement: an old, retired, unseen or long-offline register that comes back is refused at the
boundary (`IDENTITY_REQUIRED`); its completed work stays on the register and is held for review. It is
**never** served in observe mode (no silent downgrade). A retired register re-admitted by the owner (audited)
still has to enroll and sign in.

## 6. Cloud verification of a hub's forwarded work

- The hub signs each forwarded command and its own evidence with its enrolled key. The cloud authorizes the
  forwarded operation as the hub recorded it: actor (session person), device, approver (approval re-checked
  against the command's digest) and accepting server (`acceptedBy`) are kept.
- Unsigned forwards, unknown or revoked keys: held (`HUB_UNSUPPORTED` / attestation result recorded).
  After key rotation forwarding is accepted again. Duplicates apply once.
- Work a manager applied on review at the hub reaches the cloud with the reviewer and is applied there on the
  reviewer's authority.
- Delayed delivery: an approval consumed at the hub stays valid when forwarded after its lifetime.
- Evidence values keep offline claims apart from authenticated online events: `verified` (device and session
  checked online), `claimed` / `legacy-claimed` (named by the register, not proven), offline-claimed sales
  carry `limitations` saying so.

### Staff switches and late delivery

- Locking the register or switching person drops the session on the register at once; the register then
  sends the work queued under it **before** telling the server the session ended (bounded; if the server
  cannot be reached the work stays queued). Found on the packaged hub: an approved void and payout queued a
  moment before a staff switch arrived after the sign-out and were held as `SESSION_REVIEW`.
- Work that still arrives after its session ended or expired is held (`SESSION_REVIEW`), never applied on
  the next person's authority. A held operation keeps the reason it was **first** held for when the register
  resends it, so the reviewer sees the real cause.
- Work a manager applies on review at the hub is forwarded to the cloud even if the register had resent it
  up to its limit (the hub restarts the forwarding count when it applies an operation). Found on the packaged
  hub: such a close stayed at the hub and never reached the cloud.

## 7. Deferred (stated, not enforced in this batch)

- The ordering app's **customer** tokens and **driver** tokens: they have their own narrow routes and never
  carry staff permissions; not covered by staff sessions.
- The hub's localhost **setup** routes (`/api/setup/*`): discovery, cloud configuration and hub-key enrollment
  use the owner's PIN; `auto-login` issues the hub screen's local token, which carries **no** authority in
  enforce mode until the hub screen is enrolled as a device and a person signs in (tested).
- Platform owner tooling (cross-store) is outside store policy.
- Monetary or percentage thresholds for approvals: none are invented; an action needs approval when the actor
  lacks its permission.
- **Activation has no owner screen yet.** Reviewing the gate, retiring clients and switching the mode are API
  calls at the cloud (`/api/sync/identity-gate`, `/api/sync/hub-registers/:id/retire`,
  `/api/sync/clients/:id/retire`, `/api/sync/identity-mode`), made by a person signed in as themselves. A
  store-run pilot needs a screen for this; the controlled pilot below is operated by IT.
- Business records take their actor fields from the register's payload; only the sale's cashier is
  rewritten to the session person. Another operation that names a different person is refused
  (`IDENTITY_MISMATCH`); one that names nobody is applied with the actor field empty, and the verified person
  is in its evidence. Registers on this build always name their user.
- **One topology per store.** The hub is authoritative for stock and does not take the cloud's inventory
  outside a restore. A register connected straight to the cloud in a store that has a hub makes sales the hub
  never applies: on the packaged run the hub showed 19 Milk and the cloud 17 after a direct register sold 2
  (closes agreed). Pre-existing design, not introduced by enforcement; the activation gate does not detect it.
- Permission refusals are answered as retryable errors (as in observe mode): a register resends a held
  operation up to its limit; the hub keeps one held entry, its first reason and the attempt count.

## 8. Offline limitations

- Routine offline checkout stays available in every mode. In enforce, a sale the register says it made
  offline is accepted as **offline-claimed** (recorded as a claim, not verified) — unless it carries a discount,
  a price override or another elevated element, which is held.
- Every other operation made offline (no server-checked session) is held for review in enforce.
- Manager approval is online only (the approver's PIN is checked by the server the register reaches — the hub
  on the LAN, or the cloud).
- A hub with the cloud unreachable keeps enforcing, checks sessions and approvals itself, and forwards later.
- A register that cannot reach any server cannot open a staff session; it can sell routinely and everything
  else waits.

## 9. Close reports for older clients

The server keeps one close per register and shift, with linked corrections. A client that understands only
one close per date (released 1.0.51 registers and hubs) is sent, per date:
- the one current close when there is exactly one;
- otherwise a **combined** close: a stable id per store and date, `closedBy: "N closes combined"`, sums of every
  current close (corrections replace the close they correct), cost figures null when any part is unknown, and
  a note that says this version shows one close per date and to upgrade.
Nothing is silently dropped for a register. Known limitation: a 1.0.51 **hub** has a one-close-per-date table;
it cannot hold a combined close beside a close it already stored for that date (it keeps its own). A 1.0.51
hub also blocks enforcement (`hub-upgrade-needed`), so this affects observe-mode stores only.

## 10. Errors people see

A database or internal error is never shown raw. The register or reviewer sees an actionable sentence and a
support reference `ERR-XXXXXXXX`; the technical detail is in the server log under that reference. Stored
technical reasons in the review list are replaced the same way.

## 11. Migrations and compatibility

| Migration | Change |
|---|---|
| `20261102120000_staff_policy_version` | `Tenant.staffPolicyVersion INT DEFAULT 0`, `staffPolicyIssuedAt`, `staffPolicyIssuedBy` (additive) |

Earlier Sprint-2 migrations (20261101150000, 20261101170000, 20261101190000, 20261102090000) are unchanged.

| Client | Observe store | Enforcing store |
|---|---|---|
| Register on this build (schema 5) | As before | Signs people in with a server PIN check; sends device and session |
| Register 1.0.51 (schema ≤ 4) | Works as before | Refused at the boundary; its work kept and held; blocks activation until upgraded or retired |
| Hub 1.0.51 | Works as before | Blocks activation (`hub-upgrade-needed`) |
| Admin app (bundled with this build) | Person sign-in | Person sign-in carries the person's authority |
| Token without `use` (issued before this build) | Account authority (as before) | Treated as a connection: no authority without a session |

## 12. Controlled test-store pilot checklist

Disposable store only; production stays in observe.

1. Create a disposable store at the cloud; staff: owner, manager, cashier, one person without checkout.
   Choose one topology for it: every register behind the hub, or every register connected to the cloud.
2. Install the development build on the hub machine and the registers (not over a real installation).
3. Activate the hub; enroll the hub key (owner PIN on the hub).
4. Pair and enroll every register; on each, sign in once (server PIN check). Enroll the hub's own screen if it
   is used for selling or review.
5. At the cloud, open the identity gate: resolve every blocker (upgrade, enroll, sign in) or retire it with a
   note. Do not retire a register that still trades.
6. Enable `enforce` at the cloud with a note. Confirm on the hub: status shows `enforce` and the same version.
7. Walk the roles: cashier on the owner's connection and on her own; staff switch to the manager; person
   without checkout; discounted checkout with approval; refund, void, payout with approval; receiving;
   expense; daily close; review of held work (actor, approver, reviewer shown apart).
8. Unplug the hub's internet (LAN only): sell, approve at the hub, confirm work waits; restart the hub; confirm
   still `enforce`; reconnect; confirm forwarded once.
9. Bring back an old register: confirm it is refused and its sale appears in review, not lost.
10. Check the closes and stock at hub and cloud agree.
11. At the end, lower to `observe` at the cloud (new version) and confirm the hub adopts it.
12. Record every support reference seen; collect the hub log.

Externally blocked: the Windows installer/upgrade on a real machine and real-network (LAN, Wi-Fi) testing need
an isolated machine; packaged tests used the build's unpacked application with isolated user data and a
loopback test cloud.

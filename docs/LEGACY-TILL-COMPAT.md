# Legacy till compatibility (1.0.50 / 1.0.51 against the development server)

Status: development master, not deployed. Enforcement stays off.

## The problem

The deployed containment server (`e2fd79a`) still sends every staff token two things that master withholds:
staff PIN verifiers and product cost. Master withheld them by deleting the fields, which broke the released
tills:

- **Verifiers.** A 1.0.50/1.0.51 till verifies PINs offline only against its *own* SHA-256 copy, written after
  an online sign-in. It never checks bcrypt. Its full pull keeps that copy only when the server's staff
  record carries a `$2…` value. With no `pin` field the copy is dropped, and offline login stops after
  every full pull. Proved on the released source (negative control in `legacy-till-*.test.ts`).
- **Cost.** A till without cost computes no cost (or a stale one) for sales, lots, adjustments and counts.
  The server took those figures as sent, so a refused adjustment could not even be applied (`a46e012`).

## Decision: nothing sensitive is gated, so nothing can be claimed

The original plan was to send legacy data to legacy tills. That was dropped: a 1.0.50/1.0.51 till has no
credential of its own. It shows a staff token and a self-reported `x-titan-sync-schema`, and an upgraded
cashier could send both. So no client claim unlocks anything, and the server sends every staff token the
same thing:

| Data | Hub link (store cloud key) | Every staff token (any version, any schema header) |
|---|---|---|
| Staff PIN verifier | real verifier (the hub verifies for its LAN tills) | `"$2-withheld"`: matches no PIN, reveals nothing |
| Customer PIN verifier | real verifier | field absent |
| Cost, profit, margin, lot cost | yes | only with `reports.cost` (as before) |

The `$2-withheld` placeholder keeps the old full-pull step working. Its only purpose is to look like
bcrypt to that step. It is not a valid bcrypt hash (`bcrypt.compare` fails), not a SHA-256 hash, and never
equals typed digits. The server refuses to store it, or any other `$2…` that is not a bcrypt hash, as a PIN.

**Server valuation** (`apps/api/src/routes/sync.ts`, `processOperation`):

- An adjustment's `valueImpact` and a count line's `valueImpact`/`totalValueImpact` are always quantity ×
  the server's product cost. Any submitted value is ignored, from any client.
- From an account without `reports.cost`, sale-line cost, lot-slice cost, the cost of a lot created by a
  positive adjustment, and the unit cost of a received lot all come from the server.
- Refused work a manager applies on review is valued at the server's cost, never the till's.
- Still taken from the client: a cost-visible account's sale-line and receiving cost (its own input), and
  purchase-order line cost.

## Evidence (`apps/api/__tests__/legacy-till-*.test.ts`)

One suite (`__tests__/legacy-till/suite.ts`) runs the till's own services against this API and a scratch
Postgres. It runs three times:

- the released **1.0.50** source (`7df7c58`, set `LEGACY_TILL_1050_SRC`);
- the released **1.0.51** source (`31e1ce6`, set `LEGACY_TILL_1051_SRC`);
- this repository's till.

The suite checks the checkout's HEAD and that its `apps/desktop/src` is clean. Without the variables, the
two release runs are skipped. They are not reported as passing.

What all three tills pass, connected with an account that may sell, refund, receive and adjust but has no
`reports.cost`:

- **Offline login:** after an online sign-in, offline unlock survives incremental and full pulls and a
  restart. A PIN reset stops the old PIN offline (full pull or incremental pull). A deactivated person
  cannot unlock. Someone who never signed in on the till cannot unlock offline.
- **Cost-hidden checkout, refund, receiving, adjustment, count and manager review:** all are recorded and
  valued from the server's cost, also when the till's cache holds a forged cost (999). The connection
  account receives no cost from `/api/products` or sync, including with an old schema header.
- **No verifier ever reaches a staff token.** The placeholder can never be written back as a PIN.

## Known limits (accepted, not fixed by the server)

1. **Legacy SHA-256 server verifiers.** Some older staff records hold an unsalted SHA-256 verifier. The
   deployed server sends it, and old tills match it offline directly; in effect it *is* the PIN. This
   server does not. Such a person needs one online sign-in on a till before offline login works there. A
   reset from the owner portal stores bcrypt; a PIN change made on a till still stores the till's SHA-256
   hash (unchanged here).
2. **Partial full pull (1.0.50/1.0.51 defect, any server).** If a full pull fails part-way, those tills drop
   their offline verifiers until the next online sign-in. This is identical against the deployed server
   (control in the suite). The current till is not affected.
3. **Shared PIN (1.0.50/1.0.51 defect).** They do not understand 409 `AMBIGUOUS_PIN`. If one of the people
   sharing a PIN signed in on that till before, they sign that person in locally. In the test that was the
   manager. The sync connection stays the connecting account's. Fix: give each person their own PIN (PIN
   uniqueness has been enforced since `f5d3a6b`), or upgrade.
4. **Till-side cost displays.** A cashier-connected old till shows no cost or profit locally. Only the
   server's figures, which are correct, were tested; the till's screens were not.
5. **Attribution.** Old tills send no device credential and no staff session. Their work is attributed to
   the connecting account, and the actor is whatever they claim. The enforcement gate already refuses to
   switch on while any of them trades (`identityGate.ts`, reason `upgrade-needed`).

## Enrolment, control, retirement

- **Enrolment:** none. Compatibility grants no data, so there is no access to enrol.
- **Control:** each store's old tills are listed by the Sprint 1 client record (`SyncClient`, sync schema
  < 4, seen within 14 days). The owner can retire a till that is no longer used; a retired old till cannot
  check out. Enforcement cannot be switched on while one trades.
- **Retirement of the shims:**
  - *Placeholder:* removable once no store has a 1.0.50/1.0.51 till trading (no `SyncClient` with schema
    < 4 inside the window). Until then, deleting it brings back limit 2 for every full pull.
  - *Server valuation:* permanent. Valuation is the server's job.

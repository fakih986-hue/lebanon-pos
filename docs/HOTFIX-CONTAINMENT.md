# Containment release for the deployed API — for approval

Branch `hotfix/containment-1.0.50`, 6 commits on top of the deployed revision `7df7c58`. **Not deployed.** It changes the cloud API and, through the same deploy, the ordering web app (one image-URL fix). It does not contain Sprint 1 or Sprint 2 work. The till (desktop) code and the hub EXE are unchanged.

| Commit | Content |
|---|---|
| `79a8c2b` | Token kinds, staff-only sync, permission rules for uncovered operations, ambiguous PIN, WebSocket channels |
| `63137b9` | First version of this document |
| `0a292a4` | Sprint 0 server fixes ported from `908f876`: tenant isolation, route permissions, cost hiding, customer PIN hashes withheld. Staff PIN verifiers are deliberately still sent (see §2, finding 4) |
| `5b86e09` | Refused operations are kept on the server and listed for managers |
| `a049d0f` | Test: the store admin web app keeps working |
| `fe310c8` | Test: shared PIN on a 1.0.50 till |

## 1. Release matrix

"Master" names the same fix on the development line. "Hub" means the store hub's own API, which runs from the installed EXE. A cloud deploy does not change it.

| # | Finding | Fixed in (hotfix / master) | In this release? | Cloud | Hub | Tills | Migration / client update | Evidence |
|---|---|---|---|---|---|---|---|---|
| 1 | **Customer tokens accepted as staff.** Sync push skipped every check for accounts without a staff record, so an ordering-app customer could change prices. | `79a8c2b` / `b21e9d8` | **Yes** | Fixed | **Still exposed** on the 1.0.50 hub API (LAN only) until a new EXE | No change | None | `sprint2-identity.test.ts` (4); control: original skip restored → fails |
| 2 | **Driver tokens on till sync/setup.** A driver could adjust stock. | `79a8c2b` / `29d0a7b` | **Yes** | Fixed | Hub API unchanged; drivers use the cloud | No change | None | `containment.test.ts`: driver refused on push/pull/status/setup; driver still lists orders. Controls fail |
| 3 | **WebSocket exposure.** Customers received store sales activity. | `79a8c2b` / `29d0a7b` | **Yes** | Fixed; customers get only their own order updates | Hub WS unchanged (LAN) | No change | None | Real WebSocket clients in `containment.test.ts`; control fails |
| 4 | **Cross-tenant reads.** `?tenantId=` on lists, images, drivers, setup. | `0a292a4` / `908f876` | **Yes** | Fixed (403 `TENANT_SCOPE`); own store still works | Single-store hub: not applicable | No change | None. Ordering app ships with this deploy (image URL carries tenantId) | `cafe-audit.test.ts` J: B's data never leaks to A; admin app's own-store lists all 200. Control fails |
| 5a | **PIN-hash disclosure: customer PIN hashes** to tills. | `0a292a4` / `908f876` | **Yes** | Fixed (incremental and full pull) | Unchanged | 1.0.50 tills never used them | None | `cafe-audit.test.ts`, `offline-auth.test.ts`; controls for incremental and full pull each fail |
| 5b | **PIN-hash disclosure: staff bcrypt verifiers** to every staff till, cashiers included. | Not fixed (master `908f876` withholds them for Sprint 0+ tills) | **No: still exposed** | Still sent to staff accounts | Unchanged | **1.0.50 tills need them** for offline unlock | Fix needs every till on a client that verifies online first. Then withhold on the server. | Measured with the real 1.0.50 till code: withholding breaks offline unlock after a full pull (`offline-auth.test.ts`, recorded as an expected failure). `cafe-audit.test.ts` "KNOWN 1.0.50 LIMITATION" |
| 6a | **Cost disclosure on report/catalogue endpoints** (products, sales, KPI, low stock, X/Z report, margin) | `0a292a4` / `908f876` | **Yes** | Hidden without `reports.cost` | Unchanged | Not used by 1.0.50 tills | None | `cafe-audit.test.ts`; `cashier-connected.test.ts`: the cashier's `/api/products` has no cost. Control fails |
| 6b | **Cost in the sync pull** to every staff till | Not fixed | **No: still exposed** | Sent | Unchanged | 1.0.50 tills need cost to record sale cost offline | Needs a client that does not depend on pulled cost (Sprint 1 `costFromServer` line) | `cashier-connected.test.ts`: cost present in the cashier till's cache |
| 7 | **Missing operation permissions** (stock adjust/count/receive, debt, customers, held/delivery orders, below-price sales, catalogue edits) | `79a8c2b` + `0a292a4` / `29d0a7b` + `908f876` | **Yes, with the limitation in §2** | Enforced **against the connecting account** | Unchanged (hub forwards as the store bridge, which is exempt) | 1.0.50 tills unchanged; refusals shown as failed sync | None required | `containment.test.ts`; controls fail. `cashier-connected.test.ts` (real 1.0.50 till) |
| 7b | **Refused work silently dropped on the server** (no record of the refused operation) | `5b86e09` / `3a8941f` | **Yes** | Kept as unapplied `Refused` rows (payload, reason, account, device). Never forwarded or pruned. `GET /api/sync/refused` for `reports.view`. A resend by an allowed account applies once | Unchanged | Till keeps its own queued copy (measured) | None (status is a text column) | `cashier-connected.test.ts`, `containment.test.ts` (master); controls fail |
| 8 | **Shared PIN → highest role online** | `79a8c2b` / `29d0a7b` | **Yes** (server) | 409 `AMBIGUOUS_PIN`, never a role pick | Unchanged | 1.0.50 fallback: see §3 | Each person needs their own PIN | `containment.test.ts`; `cashier-connected.test.ts` shared-PIN block |

**Suite on the release tree:** API 420 passed + 5 expected failures, against a schema migrated with exactly the deployed migrations. The expected failures are:
- 2 Sprint 0 audit probes fixed later on master: empty-string barcodes, and prepared drinks without stock.
- 1 probe still open on master: a sale attributed to another staff member (Sprint 2).
- 5b.
- The 1.0.50 part-way-pull limitation. The type check is clean. `tsc` (the Docker step) and the ordering `vite build` succeed.

**Negative controls:** each control reverts one guard, and each fails its intended test; the source is restored after each run.
- `79a8c2b` (8): drivers on sync, setup any token, no inventory rule, no customer rule, silent shared-PIN pick, customer on the store channel, customer token accepted, original skip.
- `0a292a4` / `5b86e09` (6): refused work not kept, customer hashes in the incremental pull, customer hashes in the full pull, cost shown to everyone, tenant scope removed. The first was also run on master.

## 2. Decision needed: tills connected with a cashier's account

On 1.0.50 the sync token is the account of whoever pressed **Connect**. A manager unlocking that till locally does not change it. The server therefore cannot know who acted, and every operation rule in finding 7 is checked against the **connecting** account.

What a real 1.0.50 till did against this release (cashier Rana connected, manager Sami unlocked, +5 stock adjustment):

1. The adjustment was applied locally, and the server refused it ("You don't have permission to adjust inventory").
2. Server stock was unchanged. The server kept a `Refused` row with the payload, the reason, Rana's account and the device, and wrote an audit event.
3. After the retry limit, the till entry was still kept, counted as **dead** in the sync status, and still not hidden.
4. **After a full pull the till showed the server's stock (10), not 15.** The manager's correction disappeared from the screen, though it stayed in the queue and in the server's refused list.
5. Once the connecting account was allowed, resending the same queued operation applied it exactly once (stock 15).

**I cannot measure how many production tills are cashier-connected without reading production data.**

| Option | Effect | Risk |
|---|---|---|
| **A. Enforce as built** | Correct for owner- and manager-connected tills. On cashier-connected tills, manager stock/customer/debt work is refused, kept and visible to managers, but disappears from the till's stock screen after a full pull | Business disruption of unknown size. Recovery today means granting the connecting account the permission, or waiting for Phase C staff sessions |
| **B. Observe the finding-7 rules for staff accounts until Phase C** (apply, and audit "would have refused") | No false refusals | Leaves today's production behaviour for a *tampered* staff till. Customers and drivers stay fully blocked: findings 1–2 don't depend on these rules |

Not recommended in either case: reconnecting tills with an owner or shared manager credential. That makes every person's work look like the owner's and defeats the attribution Sprint 2 is building. The permanent answer is Phase C: per-staff sessions, so the server checks the person who acted.

Option B is not implemented. It is a small, contained change (finding-7 rules only, staff tokens only), and I will make it on request.

## 3. Shared-PIN fallback on old clients, and the transition

Measured with the real 1.0.50 till code against this release:

- **Online sign-in** with a PIN shared by two people is refused (409). The server never picks a role.
- **A 1.0.50 till treats the 409 like being offline** and falls back to its local verifiers. These exist only for people who already signed in online on that device.
  - **Neither person has signed in on that till before:** nobody is signed in.
  - **One of them has** (before this release, the server always resolved a shared PIN to the higher role, so this is usually the manager): **the till signs in the manager**, offline-style. The sync connection is unchanged.
- **Connect & Download** with a shared PIN fails.

**Transition (required before or with this release):**
1. List staff who share a PIN in each store (owner portal).
2. Give each person their own PIN, then have each person sign in once online on each till they use. That replaces the old local verifier and bumps `pinVersion`, which stops the old one.
3. Sprint 0+ tills refuse an ambiguous PIN outright (`3c48be1`) and do not need step 2's sign-in to be safe.

## 4. What stays exposed after this release

- **5b:** staff bcrypt verifiers reach every staff till.
- **6b:** product cost reaches every staff till.
- **Hub-local APIs** keep 1.0.50 behaviour on the LAN for findings 1–3, 7 and 8 until a new EXE.
- **Attribution:** the actor on every operation is still client-claimed. Sprint 2 Phase B only records this; Phase C starts fixing it.

## 5. Release steps (only when approved)

`origin/master` (as last fetched) is `7df7c58`, so pushing this branch to `master` is a fast-forward. Railway then deploys it. The local `master` (30 unreleased commits) must merge this branch afterwards. It must not be pushed for this fix.

Before pushing:
- Production database backup (memory: Railway deploy topology).
- Shared-PIN audit (§3).
- The §2 decision.

No migration runs.

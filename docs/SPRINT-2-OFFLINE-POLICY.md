# Sprint 2 — offline policy and time

Canonical source for offline behaviour. **Nothing here changes today's behaviour until the owner approves it (decisions D2, D7).** Today: routine checkout works offline indefinitely; queued work is delivered whenever connectivity returns.

## 1. Four separate policies

| Policy | Proposal (default) | Store-configurable |
|---|---|---|
| **1. Routine checkout** | Allowed offline with no time limit (today's behaviour). Actor = staff who unlocked with the local PIN; evidence `verified-session-offline` when a server-issued staff session exists for that staff on this device, else `claimed-legacy`. Warning banner after 24 h without contact. | Optional "require contact every N hours for checkout" (off by default). If enabled: warn at 80 % of N; at N, checkout stops **but completed sales remain queued and deliverable** |
| **2. Elevated actions** (approval-eligible list, matrix §3) | Online: manager approval token. Offline: allowed only with a **fresh local manager PIN entry** bound to the op, labelled `offline-local`, **held for review** on receipt unless the store allows accept-with-audit (D2) | Per capability: refuse offline / allow-with-review |
| **3. Device enrollment and security administration** (enroll/revoke devices, staff create/update, PIN reset, settings, retire/readmit) | **Online only** | — |
| **4. Queued delivery** | Never expires. Completed work is always transportable. An expired device credential is renewed by any online staff PIN unlock on that device; a revoked device's queue is still accepted for **review** (held), never discarded | — |

## 2. Scenarios (proposed defaults)

| Scenario | Checkout | Elevated | Delivery on reconnect |
|---|---|---|---|
| 24 h disconnected | Works; banner "working offline since …" | Fresh manager PIN, held for review | All delivered; offline evidence labelled |
| 72 h | Same | Same | Same |
| A week | Same (unless store set a limit) | Same | Same; ops created under sessions whose staff changed meanwhile → evaluated against current permissions; failures held |
| Expired staff session | Staff can still unlock locally (verifier); evidence downgrades to `claimed-legacy` for that staff until an online unlock | Requires online approval | Delivered, labelled |
| Expired transport (device) credential | Sales continue locally | — | Delivery pauses until any staff unlocks online (renews device credential); queue kept |
| PIN reset learned after reconnect | Old local PIN worked offline (cannot be prevented) | — | Ops by that staff after the till last saw `pinVersion` are delivered; server marks those whose session `av` < current `tokenVersion` as `held`, never auto-accepted, never deleted |
| Permission removed, learned after reconnect | Till enforced old permissions offline | — | Ops needing the removed permission → held for review |
| Device revoked | Till learns on next contact; local work kept | — | All its unsent ops → held for review with money effects shown; nothing applied automatically, nothing deleted |
| Clock rollback | Claimed times unreliable | — | Order from device sequence numbers; server receipt time recorded; no acceptance decision is based on claimed time alone |
| App restart while offline | Local session survives per today's rules; pending queue/journals survive (existing persistence) | Pending approvals do **not** survive a user switch or restart | Unchanged |

## 3. Time
- **Server receipt time** is the only independent time; recorded on every op.
- **Claimed client time** is stored and displayed as claimed.
- **Server anchor:** each sync response returns server time; the till stores (server time, device sequence at that moment). Offline ops carry the last anchor + sequence delta. This orders events and bounds "not before the last contact", it does **not** prove execution time — a compromised machine or a copied browser profile can fabricate anything after the anchor.
- Therefore **no operation is accepted as "created before revocation" on a device timestamp.** Revocation decisions use only: was the op received before the revocation was recorded (server time), or was it covered by a session the server issued before revocation **and** received with a device sequence below the last sequence the server saw before revocation. Everything else is held.

## 4. Recovery without losing sales
Expiry or revocation never deletes queued work. The review queue shows the original op, evidence, money collected or paid out, and local/hub/cloud effects; resolution is a separate audited record by an authorized reviewer (matrix §5). Customers are never asked to pay again to resolve a sync state.

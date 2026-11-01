# Sprint 2 — authorization matrix

Canonical source for **which permission each business action needs, who acts, who approves, and where it is enforced.** Permission catalog and role presets: `apps/api/src/lib/permissions.ts` (mirrored in the desktop `security.service.ts`).

Legend — Today: **API** = enforced by the server against the *pushing account* (the device's connecting account, not the cashier); **svc** = desktop service check; **UI** = hidden/disabled control; **—** = nothing. Sprint 2 target: the server evaluates the **derived actor** (staff session) and, where marked, a **manager approval**.

## 1. Catalog
`sales.checkout`, `sales.discount`, `sales.price_override`, `sales.refund`, `sales.void`, `sales.reprint`, `inventory.view`, `inventory.manage`, `inventory.receive`, `inventory.adjust`, `customers.manage`, `suppliers.manage`, `reports.view`, `reports.cost`, `accounting.manage`, `cash.manage`, `shifts.manage`, `staff.manage`, `settings.manage`, `delivery.manage`. Presets: Admin/Owner = all; Manager = all but `staff.manage`, `settings.manage`; Cashier = `sales.checkout`, `sales.reprint`, `inventory.view`; Driver = `delivery.manage`. Legacy expansion: `inventory.manage` ⇒ view/receive/adjust; `accounting.manage` ⇒ `suppliers.manage`, `cash.manage`; `reports.view`/`inventory.manage`/`accounting.manage` ⇒ `reports.cost`.

## 2. Actions

| Action (sync entity/action or route) | Permission | Today | Sprint 2 target | Approval eligible (D4) |
|---|---|---|---|---|
| Checkout (`sale/create`) | `sales.checkout` | UI/svc; API: not mapped | API on derived actor | — |
| Discount on checkout | `sales.discount` | UI; API: any discount > 0 needs it (pushing account) | API on actor; or approval | yes (above a threshold) |
| Price below list / sell at cost | `sales.price_override` | svc (sell-at-cost); API: price floor check (pushing account) | actor or approval | yes |
| Refund (`refund/create`) | `sales.refund` | svc; API (pushing account) | actor or approval; refunder + approver recorded | yes (above a threshold) |
| Void (`sale/void`) | `sales.void` | svc; API (pushing account); **no actor in payload** | actor recorded; actor or approval | yes |
| Debt sale (`debt/create`) | `sales.checkout` + `customers.manage`? (decide) | **— on API** | API on actor | maybe (credit limit) |
| Debt collection (`debt/payment`) | `cash.manage`? (decide) | **— on API** | API on actor | — |
| Cash movement / owner draw (`cash-movement`) | `cash.manage` | API (pushing account) + recorded-actor consistency | actor; pay-out above threshold needs approval | yes |
| Expense (`expense`) | `accounting.manage` | API (pushing account) + recorded actor | actor | — |
| Receiving (`inventory/receive`, PO) | `inventory.receive` / `suppliers.manage` (PO) | PO: API; **receive: not mapped** | API on actor | — |
| Supplier payment (`supplier-payment`) | `suppliers.manage` | API (pushing account) | actor | yes (above threshold) |
| Stock adjustment (`inventory/adjust`) | `inventory.adjust` | **— on API** (any staff token, incl. driver) | API on actor | — |
| Stock count completion (`inventory/count`) | `inventory.adjust` | **— on API** | API on actor | — |
| Product cost/price/catalogue (`product/*`) | create `inventory.receive`; update/delete `inventory.manage` | API (Sprint 0) | actor | — |
| Stock-policy change (`product/update` with stockPolicy) | `inventory.manage` + upgrade gate | API + gate (Sprint 1) | actor | — |
| Stock-policy held-sale decision (`stockPolicyResolution`) | `inventory.manage` | API checks the **client-named** manager (Sprint 1 limitation) | **manager approval** (§4) | required |
| Staff administration (`staff/*`) | `staff.manage` | API | actor; online only | — |
| Device enrollment / revocation / retire / readmit | `settings.manage` (enroll), `inventory.manage` (retire/readmit today) | API routes | actor (staff session), online only; align to one permission (decide) | — |
| Settings (`settings/update`) | `settings.manage` | API | actor; online only | — |
| Shift open / close | `sales.checkout` or `shifts.manage` / opener or `shifts.manage` | API (pushing account + recorded actor) | actor | close by non-opener: approval |
| Daily close / manual close | `accounting.manage` | API | actor | — |
| Reconciliation repair (`/api/inventory/reconciliation/repair`) | role claim Admin/Manager/Owner | route checks **role claim**, not permission | permission `inventory.manage` on actor; system authority recorded separately | — |
| Customer create/update (`customer`) | `customers.manage` | **— on API** | API on actor (checkout-time quick-add: `sales.checkout`, decide) | — |
| Held/parked order (`held-sale`) | `sales.checkout` | **—** | creator recorded; editors appended | — |
| Delivery order (`delivery-order`, routes) | `delivery.manage` | routes: yes; sync: **—** | actor | — |
| Reprint (`sales.reprint`) | `sales.reprint` | UI | no authorship change on reprint | — |
| Reports / cost visibility | `reports.view` / `reports.cost` | reads, pull, exports filtered (Sprint 0); `POST /api/reports/z-report`: `requireAuth` + cost filter only | permission on actor for every read incl. nested | — |

## 3. Restricted actions and thresholds (decision D4 — owner's values)
Candidates: discount above X% or Y amount; price below list; refund above Z or without receipt; void after N minutes; pay-out/owner draw above W; supplier payment above V; stock-policy decision (always). Proposal: start with **price below list, void, refund, pay-out, stock-policy decision** as approval-eligible; thresholds configurable per store, default "always requires the permission (no approval)" until set.

## 4. Manager approval (canonical rules)
**Implemented online (`apps/api/src/lib/approvals.ts`, `routes/approvals.ts`):** approvable now — refund (`sales.refund`), void (`sales.void`), cash movement (`cash.manage`), stock adjustment (`inventory.adjust`), checkout discount / price below list / stock-policy decision (`sales.discount`, `sales.price_override`, `inventory.manage`; register UI for checkout pending). No thresholds: an action needs approval exactly when the person lacks its permission. Lifetime 120 s to first use. Binding is to the record and its material values rather than a full payload digest, so a timestamp written at commit cannot invalidate an approval while any change of amount, line, method, currency, record or action does. Offline: not implemented.
- The cashier remains the **actor**; the manager is recorded as **approver**; the device is not switched to the manager's session.
- **Online:** manager enters PIN on the till → server verifies (bcrypt) against an approval request containing tenant, device, op id, payload digest (RFC 8785 + SHA-256) and the material fields (amount, currency, items, discount, payout currency) → single-use approval id, expires (proposal 2 minutes), bound to all of the above. The op carries the approval id; the server checks binding, expiry, single use, approver active + permission **at approval time and at receipt**. Retrying the identical op is idempotent (same op id). Any change → new approval.
- **Offline (if allowed, D2):** requires a **fresh local manager PIN entry** for this op (a cached manager session alone is never enough); the till records approver id, digest, local check, claimed time; labelled `offline-local`; per-capability policy decides accept-with-review or refuse. A modified client can defeat local checks — stated.
- The manager's PIN is never stored in the operation, the approval record or the audit.
- Tests: acceptance plan §E.

## 5. Review of held operations (decision D5 proposal)
**Implemented:** one queue (refused work); each item shows its category, the evidence it was held with, the money the register says moved, stock effects, and the permissions that may decide; decisions are whole (apply as sent, or decline with a money outcome) and recorded in `ReviewResolution`. Routing uses the existing mapping below (identity holds: `sales.void` or `settings.manage`).
| Held operation | Reviewer permission |
|---|---|
| Sale / void / refund | `sales.refund` |
| Debt sale / collection | `customers.manage` (+ `cash.manage` for collections) |
| Cash movement / expense / supplier payment | `accounting.manage` |
| Receiving / stock adjustment / count | `inventory.adjust` (receive: `inventory.receive`) |
| Stock-policy decision | `inventory.manage` |
| Anything from a revoked device | the above **and** `settings.manage` to see device context |

# Cash rounding policy: proposal for approval

Status: 2026-10-16. **Proposal only.** The app still uses the current rules (`docs/CASH-ROUNDING-RECONCILIATION.md`) until this is approved. No historical sale, refund or closed shift is rewritten under any option here.

Evidence: `docs/evidence/cash-rounding-policy-proposal.ts`. It computes the current rules with the app's own `currency.ts` and the proposed rules beside them. Run it with `npx tsx ../../docs/evidence/cash-rounding-policy-proposal.ts` from `apps/desktop`. All examples use rate 89,500 LBP/$ and a $6.72 sale (601,440 LBP).

## Summary of the recommendation

| # | Decision | Recommended default |
|---|---|---|
| 1 | Are USD payments rounded? | **No.** Dollars pay the exact total, to the cent |
| 2 | LBP rounding | Round up only the part still due **in LBP**, to a store setting: none / 1,000 / **5,000** (today's value) / 10,000 |
| 3 | Mixed payments and change | Apply USD first; the rest is due in LBP. The cashier chooses the change currency explicitly. **Default: LBP if any LBP was tendered, otherwise USD.** LBP change rounds **down** to the denomination |
| 4 | Recording | Record the rounding **separately** as an exact LBP integer. `total` stays the sale price |
| 5 | Reconciliation | Expected cash, receipts, refunds and reports all use total + rounding. The drawer is counted in USD and LBP separately |

## Decision 1: USD payments keep cent precision

**Recommended: yes, as you proposed.** Today a dollar-paying customer pays $6.76 for a $6.72 sale, because USD uses the LBP-rounded payable.

| Tender | Today | Proposed |
|---|---|---|
| Exact USD | $6.76 | **$6.72**, rounding 0 |
| $10 | change $3.24 | change **$3.28**, rounding 0 |

There is one practical caveat: US coins rarely circulate. Option 3b below lets a store give the cents part of USD change in LBP instead.

## Decision 2: LBP rounding uses a configurable denomination

**Recommended: a store setting, `cashRoundingLbp` = 0 | 1,000 | 5,000 | 10,000, default 5,000.**
- The amount due in LBP rounds **up**, as today. The store's gain is always less than one denomination per sale.
- 0 means no rounding: exact LBP, for stores that handle small notes.

| Pure-LBP tender | 5,000 (default) | 1,000 |
|---|---|---|
| Due | 605,000 (rounding +3,560) | 602,000 (rounding +560) |
| Exact LBP | no change | 605,000 paid → change 3,000 |
| 1,000,000 LBP | change 395,000 | change 398,000 |

A store that sets 1,000 gives back 3,000 LBP from a 605,000 payment. Its cashiers need 1,000 notes.

## Decision 3: mixed payments name the change currency

**Recommended:** apply USD first. The remaining amount is converted at the sale's rate and rounded up to the denomination. The cashier then sees **"Change in: LBP | USD"** as an explicit choice.
- **Default:** LBP when any LBP was tendered, USD otherwise.
- LBP change rounds **down** to the denomination, so the store never hands out notes that don't exist.
- USD change is exact cents (3a), or optionally whole dollars with the remainder in LBP (3b, a setting).

| $5 + 200,000 LBP (denomination 5,000) | Today | Proposed, change LBP | Proposed, change USD |
|---|---|---|---|
| Due after $5 | (whole sale $6.76) | 155,000 LBP | 155,000 LBP |
| Change | $0.47 | **45,000 LBP** | **$0.50** |
| Rounding recorded | not recorded (+3,995 unexplained) | +1,060 LBP | +1,310 LBP |

| $20 + 200,000 LBP (USD covers it) | Proposed, change USD | Proposed, change LBP |
|---|---|---|
| Change | **$13.28 + the 200,000 LBP back** | **1,385,000 LBP** |
| Rounding | 0 | +3,560 LBP |

Today this tender gives $15.47 with no choice. The receipt names the currency handed back; see Decision 5.

## Decision 4: record the rounding separately from the sale total

**Recommended:**
- `total` stays the sale price. Revenue, tax, discounts, debts and the refund rules are unchanged.
- Each cash sale records `cashRoundingLbp`, an exact integer: the value kept in the drawer − total × rate.
- Every example reconciles exactly (`reconciles: true` in the evidence output), because LBP is an integer at an integer rate. A USD-cents rounding field would drift by a cent per sale.

How to store it without breaking older servers and hubs (checked; see Compatibility):
1. **Server first.** Add a nullable `SaleTender.cashRoundingLbp` column. When a push omits it, the server derives it from the tender already sent (`paidLbp`, `paidUsd`, `changeLbp`/`changeUsd` and `changeCurrency`).
2. **Clients second.** The desktop sends the field only to a server that advertises it. Pulls to older hubs strip it, the same way `x-titan-sync-schema: 2` already strips refund fields.
3. **Accounting.** The rounding is booked as "Cash rounding" other income, not as sales.

## Decision 5: everything reconciles to the same numbers

| Surface | Proposed rule |
|---|---|
| Expected cash (shift, drawer widget, staff page, accounting, server Z-report) | Float + Σ cash sale **total + rounding** − cash refund **payouts** − cash expenses − cash supplier payments ± cash in/out |
| Drawer count | **USD and LBP counted separately.** Expected USD = Σ USD kept, expected LBP = Σ LBP kept, both exact from the tender. Variance shown per currency and combined at a stated rate |
| Receipt | Total; then, when there is rounding, "Cash rounding +3,560 LBP" and "Paid"; then **only the change actually given**, in its currency. Today both change lines are printed |
| Refund | The amount still comes from the refund rules (`previewRefund` and `assertRefundAmount` on `sale.total`; unchanged). New: a **payout currency**. An LBP payout rounds **up** to the denomination, in the customer's favour, mirroring the sale. The payout total per sale is capped at the cash the sale kept |
| Reports | Sales unchanged. A new "Cash rounding" line (net of refund rounding) on the Z-report, daily close and accounting |

Refund examples (sale paid 605,000 LBP, rounding +3,560):

| Refund | LBP payout (5,000) | Refund rounding | USD payout |
|---|---|---|---|
| Full, $6.72 | **605,000**: exactly what was paid | −3,560 | $6.72 |
| Partial, $1.50 | 135,000 | −750 | $1.50 |

After the sale and its full LBP refund, the shift's expected LBP is back to zero. The customer got back exactly what they paid, and nothing is left unexplained. The cap stops repeated partial refunds, each rounded up, from paying out more than the 605,000 received.

## Compatibility check (current code, before any change)

| Area | Finding | Effect on the proposal |
|---|---|---|
| Refund rules | `previewRefund` (`sales.service.ts:667`) uses line prices scaled to `sale.total`, capped by prior refunds. Refunds store only `total` (USD) and the rate; they never read `payableLbp` | Unchanged. Payout currency and refund rounding are **new fields** on the refund. The server's refund push builds explicit fields, so an old server ignores them (they are not rejected); gate the feature on server support |
| Sale push | The sale and tender are spread into `prisma.create` (`sync.ts:1014`, `1123`). An unknown field makes an **old server reject the sale** | This is why the server ships first and derives the value, and the client sends the field only when the server supports it |
| Pull to hubs | Old hubs re-insert pulled rows as they are (`cloudSync.ts:800`). Stripping is controlled by `x-titan-sync-schema` (`sync.ts:39`) | Add `cashRoundingLbp` to the schema-gated strip list (schema 3) |
| Debt, Card, Wallet | `payableLbp` is computed for all sales but saved only for Cash. Tender is Cash-only. Debt increases by `total` | Unaffected: rounding applies only to cash tenders |
| Rounding denomination | Hard-coded: `POSPage.tsx:263` `ceilLbp(totalLbp, 5000)` and defaults in `currency.ts` | Becomes the setting. Default 5,000 keeps today's LBP behaviour |
| Expected cash formula | Duplicated in `shift.service.ts:59`, `StaffPage.tsx:164`, `accounting.helpers.ts:128` and server `reports.ts:176` | One shared function, applied to all four places together |
| History | Closed shifts store their `expectedCashUsd`. Old sales have `payableLbp` and `tender` | **Nothing is rewritten.** Closed shifts keep their stored figures. The new formula applies to shifts opened after the policy is switched on (a policy version on the shift). Old sales can show a derived, read-only rounding in reports |
| Tests | `cashChange.test.ts` checks today's 5,000 rounding and change | New vectors for the five decisions. Existing tests change only where the decision changes behaviour (USD exact) |

Found during this check, separate from the policy: the server **X-report** (`reports.ts:88-129`) subtracts **all** refunds and expenses from net cash, not only cash ones. The Z-report and the desktop subtract only cash refunds and expenses. I recommend fixing this as its own correctness change.

## What approval unlocks (one correctness change, separate from design)

1. Server: migration and derivation for `SaleTender.cashRoundingLbp`, refund payout fields, schema-3 pull stripping, and the shared expected-cash formula including the X-report fix.
2. Desktop: the rounding setting, the tender rules in `currency.ts` with test vectors, the change-currency control, receipt lines, two-currency close and refund payout.
3. Evidence: this script turned into unit vectors, plus one end-to-end check on the scratch DB (sale, then partial and full refund, then close). Expected and counted cash must match exactly.

# Cash rounding policy: proposal for approval (revision 3)

Status: 2026-10-16. **Proposal only. The app still uses today's rules** (`docs/CASH-ROUNDING-RECONCILIATION.md`). No historical sale, refund or closed shift is rewritten under anything here.

Revision 2 separated due and change rounding, allocated refunds cumulatively, kept the drawer per currency, and added capability gating.

Revision 3 changes two things:
1. Refunds keep the **original tender breakdown**. They are no longer converted into the currency the sale was mostly paid in (§3).
2. Mixed-payment settlement is shown **end to end**. Each rounding applies once, to its own quantity, and the recorded adjustment is checked against the physical currency movements (§2).

Dual-currency accounting (the per-currency drawer) is planned as its own sprint: `docs/DUAL-CURRENCY-ACCOUNTING-SPRINT.md`.

Evidence: `docs/evidence/cash-rounding-policy-proposal.ts`. It contains the proposed functions `settle()` and `refundSequence()` and prints every example below. Run it with `npx tsx ../../docs/evidence/cash-rounding-policy-proposal.ts` from `apps/desktop`. All examples use rate 89,500 LBP/$ and a $6.72 sale (601,440 LBP).

## 1. Two policies: the amount due, and the change returned

| Policy | What it rounds | Modes | Denomination |
|---|---|---|---|
| **Due rounding** | An amount still due **in LBP**, after any USD | none, **up** (today), **nearest** | Setting: 1,000 / 5,000 / 10,000 |
| **Change rounding** | LBP change **actually handed back** | none, **down**, **nearest** | Setting, separate from the due denomination |
| USD change | USD handed back | **cents**, or whole dollars with the rest in LBP | n/a |

USD is never rounded. A dollar payer pays the total to the cent.

### Due rounding: up vs nearest (pure LBP)

| Sale | Total LBP | Up, 5,000 | Nearest, 5,000 | Up, 1,000 | Nearest, 1,000 |
|---|---|---|---|---|---|
| $6.72 | 601,440 | 605,000 (+3,560) | **600,000 (−1,440)** | 602,000 (+560) | 601,000 (−440) |
| $3.15 | 281,925 | 285,000 (+3,075) | **280,000 (−1,925)** | 282,000 (+75) | 282,000 (+75) |
| $1.10 | 98,450 | 100,000 (+1,550) | 100,000 (+1,550) | 99,000 (+550) | 98,000 (−450) |
| $6.70 | 599,650 | 600,000 (+350) | 600,000 (+350) | 600,000 (+350) | 600,000 (+350) |

- **Up:** the store always gains, by up to one denomination per sale. At 5,000 that is about 2,500 LBP per LBP sale on average, roughly $8 a day over 300 sales.
- **Nearest:** each sale moves by at most half a denomination either way, and over many sales the rounding averages close to zero.
- Both reconcile, because the rounding is recorded on each sale (§4).

### Change rounding: down vs nearest ($6.72 sale, change in LBP)

| Customer pays | Exact change | Down, 5,000 | Nearest, 5,000 |
|---|---|---|---|
| $10 | 293,560 | 290,000 (store keeps 3,560) | **295,000** (store gives 1,440 extra) |
| $20 | 1,188,560 | 1,185,000 (keeps 3,560) | **1,190,000** (gives 1,440) |
| $7 | 25,060 | 25,000 (keeps 60) | 25,000 (keeps 60) |

- **Down:** the store never hands out more than it owes.
- **Nearest:** symmetric with nearest due rounding.

**Recommended defaults:** due **nearest**, change **nearest**, both at **5,000**, USD change in **cents**. That is one rule a cashier can explain ("to the nearest 5,000, both ways"), and it averages to zero.

The alternatives stay a setting:
- Due **up** keeps today's amount.
- Change **down** if the owner never wants to give extra.

## 2. Mixed payments end to end: each rounding once

Settlement runs in a fixed order, so the due rounding and the change rounding can never adjust the same amount twice:

1. **USD is applied first**, exactly, to the cent.
2. **Due rounding** applies once, to the LBP still due. This gives the *due adjustment*.
3. **Change** is computed from what was tendered beyond the **rounded** due, never from the unrounded remainder. **Change rounding** then applies once, to the LBP actually handed back. This gives the *change adjustment*.
4. **Recorded adjustment = due adjustment + change adjustment.** The evidence script asserts that this equals the value kept minus the sale total, computed from the physical movements. If it doesn't, the settlement is refused.

Recommended policy (due nearest, change nearest, both 5,000; USD change in cents) on the $6.72 sale (601,440 LBP):

| Tender | Exact due → rounded | Due adj. | Owed back → given | Change adj. | **Recorded adj.** | Drawer movements |
|---|---|---|---|---|---|---|
| $5 + 200,000 LBP, change LBP | 153,940 → 155,000 | +1,060 | 45,000 → 45,000 LBP | 0 | **+1,060** | +$5.00, +200,000 LBP, −45,000 LBP |
| $5 + 157,000 LBP, change LBP | 153,940 → 155,000 | +1,060 | 2,000 → none | +2,000 | **+3,060** | +$5.00, +157,000 LBP |
| $5 + 200,000 LBP, change USD | 153,940 → 155,000 | +1,060 | 45,000 → $0.50 | +250 | **+1,310** | +$5.00, +200,000 LBP, −$0.50 |
| $20 + 200,000 LBP, change USD | none (USD covers it) | 0 | 1,388,560 → $15.51 | +415 | **+415** | +$20.00, +200,000 LBP, −$15.51 |
| $10, change LBP | none | 0 | 293,560 → 295,000 LBP | −1,440 | **−1,440** | +$10.00, −295,000 LBP |
| Exact USD $6.72 | none | 0 | none | 0 | **0** | +$6.72 |
| Exact LBP 600,000 | 601,440 → 600,000 | −1,440 | none | 0 | **−1,440** | +600,000 LBP |

**The mistake this order prevents.** A naive implementation computes change from the unrounded remainder, then books both roundings:

| Tender | Naive change | Naive recorded adj. | Actual adj. | Effect |
|---|---|---|---|---|
| $5 + 200,000 LBP | 46,060 → 45,000 | +2,120 | +1,060 | The adjustment is booked twice: reports overstate it, and the drawer looks 1,060 short |
| $5 + 157,000 LBP | 3,060 → **5,000** | −880 | −1,940 | The cashier hands back 5,000 and collects only 152,000 against a 155,000 due |

Each cash sale records:
- the policy snapshot;
- the rate;
- the exact due and the rounded due;
- the due adjustment and the change adjustment (both shown on the receipt when non-zero);
- the physical movements per currency: tendered USD and LBP, change USD and LBP. Most of these already exist in `SaleTender`.

The sale `total` is not changed. The receipt prints only the change actually handed back.

## 3. Refunds: the original tender breakdown, cumulative, never above what was paid

**Rejected rule:** rounding every partial refund up on its own. Four partial refunds of $1.68 on a sale that kept 605,000 would pay back **620,000 LBP**.

**Also rejected (revision 2):** converting the whole refund into the currency the sale was mostly paid in. That makes the drawer exchange money the customer never gave.

**Proposed rule:**
1. **The refund amount is unchanged.** `previewRefund` and `assertRefundAmount` still decide each refund's USD amount from `sale.total` and prior refunds.
2. **The breakdown is what the customer net paid in each currency:** tendered − change, per currency. If the change in one currency exceeded what was paid in it (for example, $10 paid and 295,000 LBP change), that currency's net is negative. It is netted into the other currency at the sale's rate, so the refund comes back in the currency that was actually paid.
3. **Each currency is allocated cumulatively.** After refunds totalling ΣA, the target for that currency is its net paid × ΣA / total, rounded once: USD down to the cent, LBP to the nearest change denomination. The target never exceeds that currency's net. Each payout is the target minus what that currency has already paid back.
4. **The last refund pays the exact remainder of each currency.** The total paid back equals the breakdown, per currency, and never exceeds it.
5. **Override.** If the drawer lacks a currency, a cashier can pay that leg in the other one. This is recorded as an explicit exchange at the sale's rate, with its own adjustment. It is never the default.

| Case | Refundable breakdown | Payouts | Paid back |
|---|---|---|---|
| A. LBP sale, full | 600,000 LBP | 600,000 LBP | 600,000 LBP |
| B. USD sale, full | $6.72 | **$6.72** (stays USD) | $6.72 |
| C. LBP sale, $1.50 then the rest | 600,000 LBP | 135,000, then 465,000 LBP | 600,000 LBP |
| D. Sale rounded up (605,000 kept), four × $1.68 | 605,000 LBP | 150,000 + 155,000 + 150,000 + 150,000 | **605,000 LBP** (the rejected rule pays 620,000) |
| E. Mixed $5 + 155,000 kept, half then half | $5.00 + 155,000 LBP | $2.50 + 80,000, then $2.50 + 75,000 | $5.00 + 155,000 LBP |
| F. Mixed, three partials ($1.00, $2.50, $3.22) | $5.00 + 155,000 LBP | $0.74 + 25,000; $1.86 + 55,000; $2.40 + 75,000 | $5.00 + 155,000 LBP |
| G. $10 paid, 295,000 LBP change | $6.70 (LBP leg netted into USD) | $6.70 | $6.70; 350 LBP of value, under one cent, stays and is recorded |

Each refund records:
- its USD amount (the existing `total`);
- the payout per currency;
- the sale's original rate;
- its refund adjustment (payout value − amount × rate).

These sum to zero over a fully refunded sale, apart from G's sub-cent remainder. The original sale is not changed.

**Non-cash refunds** (card, wallet, debt credit) are not rounded. A card sale refunded in cash is an explicit exchange: the exact USD amount, or LBP rounded **down**, recorded the same way.

## 4. Currency accounting: two drawers, one report

The drawer is **two ledgers**, USD and LBP, each moved by the actual notes:
- **Sale:** +paid − change, per currency.
- **Refund:** − payout, per currency.
- Cash in/out, expenses and supplier payments in their own currency.

Example shift, float $100 + 0 LBP:
- Sales: an exact LBP sale, a $10 sale with USD change, and a $5 + 200,000 sale with LBP change.
- Refund C ($1.50, paid in LBP).

| | USD drawer | LBP drawer |
|---|---|---|
| Expected | **$111.72** | **620,000** |
| Counted at close | counted separately | counted separately |
| Variance | per currency | per currency |

The USD-equivalent total ($118.65 at 89,500, $118.61 at 90,000) is a **reporting value at a stated rate**. It does not prove the drawer balances: a drawer $5 short and 447,500 LBP over shows ±0 combined. The close screen reports a variance per currency first, and the combined figure second, labelled with its rate.

Each cash sale stores a **snapshot**:
- the policy (`version`, due mode and denomination, change mode and denomination, USD change mode);
- the rate (already stored);
- the due LBP amount;
- the rounding.

Reports and refunds use the snapshot, never today's settings.

**Gap to decide:** expenses, supplier payments, cash in/out and the opening float are recorded in **USD only** today. To keep the LBP drawer exact they need a currency and an LBP amount (decision 6). Until then, they count as USD movements.

The per-currency drawer does not depend on the rounding decisions: it can ship first, under today's rounding. Scope, order and acceptance tests are in `docs/DUAL-CURRENCY-ACCOUNTING-SPRINT.md`.

## 5. Compatibility: gated, never silently dropped

| Risk | Rule |
|---|---|
| A new device sends policy fields to an old server | An old server **rejects** an unknown sale field, failing and retrying; it does not drop it. So the policy is enabled only when the connected server advertises the `cash-policy-v1` capability. The device caches that capability per server |
| The policy is enabled while an old hub or register still syncs | The **server** owns the tenant setting. It refuses to enable the policy until every active device and hub of the tenant has synced with schema ≥ 3 (the server records each device's schema from the `x-titan-sync-schema` header) |
| A device holds v1 sales but syncs to a server without the capability (restored old hub, downgrade) | The push returns `CAPABILITY_REQUIRED`. The operations are **held**: kept, not dropped, not stripped and not retried in a loop. A banner says "Update the store server", and a manager can export them. Nothing is recorded as synced |
| Pull to an old hub (schema < 3) for a tenant with the policy on | No stripping. The server answers **426 Update required**. Enabling already required every device to be on schema 3, so this only reaches stragglers |
| Fallback when the capability is missing | The device keeps using **today's rules** for new sales, unchanged. It never records half a policy |
| Server validation | On a v1 sale push, the server runs `settle()` from the sale's own snapshot, tender, total and rate. On a v1 refund push, it runs `refundSequence()` from the stored sale and its prior refunds, in `refundVersion` order. A mismatch is a **rejected money conflict**, using the existing settlement flow. Sales without a snapshot are stored as today; their rounding is **not reconstructed** from current settings |

## 6. Historical records and shifts that are open at activation

- **Closed shifts:** their stored figures (`expectedCashUsd`, `differenceUsd` and so on) are never recomputed or rewritten.
- **The policy is stamped on the shift when it opens** (`cashPolicyVersion`). Turning the policy on takes effect at the **next shift opened on each register**.
  - A shift already open keeps today's rules until it closes: its sales, its expected cash (today's USD formula) and its Z-report.
  - No shift mixes two policies. The settings screen shows "takes effect from the next shift" and lists the open shifts still on the old rules.
- **Old sales stay as they are.** Refunding a pre-policy sale in a v1 shift uses the refund rules as today. The payout is recorded per currency at that sale's own rate, and its rounding is recorded on the refund. The old sale's rounding is not derived or written back.
- **Reports** show each shift's policy version.
  - Pre-policy shifts keep today's known "+rounding over" gap, explained by a note, not corrected.
  - The derived "rounded" chip on old sales stays informational.

## 7. Decisions for approval

| # | Decision | Recommended default |
|---|---|---|
| 1 | Due rounding mode | **Nearest**. Alternative: up (today) |
| 2 | Due denomination | **5,000**. Options 1,000 / 10,000 / none |
| 3 | Change rounding mode and denomination | **Nearest, 5,000**. Alternative: down |
| 4 | USD change | **Cents**. Option: whole dollars, the rest in LBP |
| 5 | Refunds | **Original tender breakdown per currency, allocated cumulatively**, last refund exact. Override only as a recorded exchange at the sale's rate |
| 6 | Non-sale drawer movements | Add a currency and LBP amount to expenses, supplier payments, cash in/out and the float, so both ledgers are exact. Planned as its own sprint: `docs/DUAL-CURRENCY-ACCOUNTING-SPRINT.md` |
| 7 | Close | **Count USD and LBP separately**; per-currency variance first; the USD-equivalent labelled with its rate |
| 8 | Activation | Server-owned setting, gated on every device at schema 3; effective from each register's next shift |

## 8. Already fixed this round (separate commits, no rounding change)

- `dd0fd98` + `9d3baa4`: shift close, owner draw and expense permissions are enforced in the desktop services and on the server push, checked against the pushing account and against the staff member the record names (16 tests, mutation-checked). **The named staff member is client-asserted, not authenticated.** This is not authenticated cashier authorization; see `docs/PERMISSIONS-ENFORCEMENT.md`.
- `fff6385`: the X-report and its CSV export count only cash tenders in the drawer, with the same formula as the Z-report. A Z-close needs the shift's opener or a manager.
- `7abe012`: the shell top bar fits at 768, 820 and 1024 px and on phones.

After approval, the policy is one correctness change, implemented in order:
1. Server capability, schema-3 fields and validation, with real-Postgres tests.
2. Desktop `settle()` / `refundSequence()` and settings, with vectors shared with the server.
3. Two-currency close and receipt.
4. A scratch-DB end-to-end run: sale, partial and repeated refunds, close. Both currencies must reconcile exactly.

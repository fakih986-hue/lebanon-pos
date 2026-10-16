# Cash rounding policy: proposal for approval (revision 2)

Status: 2026-10-16. **Proposal only. The app still uses today's rules** (`docs/CASH-ROUNDING-RECONCILIATION.md`). No historical sale, refund or closed shift is rewritten under anything here.

Revision 2 makes four changes:
1. Rounding the amount due and rounding the change handed back are separate policies.
2. Refunds are allocated cumulatively.
3. The drawer is kept in USD and LBP separately, with a rate and policy snapshot on every sale.
4. Capability gating, with no silent discarding of fields.

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

## 2. Every tender under the recommended policy

USD is applied first, at the exact cents. Any rest is due in LBP and rounded once. The cashier chooses the change currency explicitly; the default is LBP if any LBP was tendered, otherwise USD.

| Tender | Today | Due LBP | Change | Kept in drawer | Rounding recorded |
|---|---|---|---|---|---|
| Exact USD | $6.76 charged | none | none | **$6.72** | 0 |
| $10, change USD | $3.24 | none | **$3.28** | $6.72 | 0 |
| $10, change LBP | $3.24 | none | **295,000 LBP** | +$10, −295,000 LBP | −1,440 |
| $10, change whole dollars + LBP | $3.24 | none | **$3 + 25,000 LBP** | +$7, −25,000 LBP | +60 |
| Exact LBP | 605,000 | **600,000** | none | 600,000 LBP | −1,440 |
| 1,000,000 LBP | 395,000 back | 600,000 | **400,000 LBP** | 600,000 LBP | −1,440 |
| $5 + 200,000, change LBP | $0.47 | 155,000 | **45,000 LBP** | $5 + 155,000 LBP | +1,060 |
| $5 + 200,000, change USD | $0.47 | 155,000 | **$0.50** | $4.50 + 200,000 LBP | +1,310 |
| $20 + 200,000, change USD | $15.47 | none | **$15.51** | $4.49 + 200,000 LBP | +415 |

In every row, kept value − sale total = recorded rounding, exactly, because LBP is an integer and the rate is stored. The receipt prints only the change actually handed back, in its currency.

## 3. Refunds: cumulative, never above what was paid

**Rejected rule:** rounding every partial refund up on its own. Four partial refunds of $1.68 on a sale that kept 605,000 would pay back **620,000 LBP**, which is 15,000 more than the customer paid.

**Proposed rule:**
1. **The refund amount is unchanged.** `previewRefund` and `assertRefundAmount` still decide each refund's USD amount from `sale.total` and prior refunds.
2. **The cash returned is cumulative.** After refunds totalling ΣA, the cash owed back is **kept value × ΣA / total**. Kept value is the cash the sale actually retained, including its rounding.
3. **Each payout** = that cumulative target − what has already been paid out, rounded **once** in the payout currency (LBP to the change denomination, nearest; USD to the cent, rounded down). An over- or under-payment carries into the next refund instead of compounding.
4. **Cap.** The total paid out can never exceed the kept value. If nearest would exceed it, the payout rounds down.
5. **The last refund** pays whatever remains. The part LBP notes cannot express goes in USD cents, rounded down. At most one cent of value stays, and it is recorded.
6. **Payout currency.** Default: the currency the sale was mostly paid in. The cashier can change it; it is converted at the **sale's original rate**, never today's.

| Case | Payouts | Paid back / kept |
|---|---|---|
| A. Full refund, LBP sale | 600,000 LBP | 600,000 / 600,000 |
| B. Full refund, a sale rounded **up** under that policy | 605,000 LBP | 605,000 / 605,000 (exactly what was paid) |
| C. Partial $1.50, then the rest | 135,000, then 465,000 LBP | 600,000 / 600,000 |
| D. Four partials of $1.68 | 150,000 + 155,000 + 150,000 + 150,000 | **605,000 / 605,000** (the rejected rule pays 620,000) |
| E. Mixed sale ($5 + 155,000 kept): half in USD, half in LBP | $3.36, then 300,000 LBP + $0.01 | 601,615 / 602,500 (885 LBP, under one cent, stays and is recorded) |
| F. USD sale refunded in LBP | 600,000 LBP + $0.01 | 600,895 / 601,440 (545 LBP, under one cent). The default currency here would be USD: exactly $6.72 |

Each refund records:
- its USD amount (the existing `total`);
- the payout in USD and in LBP;
- the original rate;
- its refund rounding (payout value − amount × rate).

The original sale is not changed.

**Non-cash refunds** (card, wallet, debt credit) are not rounded. A card sale refunded in cash pays the exact USD amount, or LBP rounded **down**, recorded the same way.

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
| 5 | Refunds | **Cumulative allocation with the cap**, payout currency defaulting to how the sale was paid, at the sale's rate |
| 6 | Non-sale drawer movements | Add a currency and LBP amount to expenses, supplier payments, cash in/out and the float, so both ledgers are exact |
| 7 | Close | **Count USD and LBP separately**; per-currency variance first; the USD-equivalent labelled with its rate |
| 8 | Activation | Server-owned setting, gated on every device at schema 3; effective from each register's next shift |

## 8. Already fixed this round (separate commits, no rounding change)

- `dd0fd98` + `9d3baa4`: shift close, owner draw and expense permissions are enforced in the desktop services and on the server push, checked against the pushing account **and** the staff member the record names (16 tests, mutation-checked).
- `fff6385`: the X-report and its CSV export count only cash tenders in the drawer, with the same formula as the Z-report. A Z-close needs the shift's opener or a manager.
- `7abe012`: the shell top bar fits at 768, 820 and 1024 px and on phones.

After approval, the policy is one correctness change, implemented in order:
1. Server capability, schema-3 fields and validation, with real-Postgres tests.
2. Desktop `settle()` / `refundSequence()` and settings, with vectors shared with the server.
3. Two-currency close and receipt.
4. A scratch-DB end-to-end run: sale, partial and repeated refunds, close. Both currencies must reconcile exactly.

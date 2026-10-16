# Cash rounding, change, receipts and drawer totals: how they reconcile today

Status: 2026-10-16. **This documents current behaviour; nothing here changes the calculation.** The change calculation stays as it is until a rounding policy is approved (decisions in §5).

Worked numbers below are computed with the app's own functions: `docs/evidence/cash-rounding-reconciliation.ts`, which imports `apps/desktop/src/features/pos/lib/currency.ts`.

## 1. The rules in code

All of these live in `POSPage.tsx` and `lib/currency.ts`.

| Quantity | Rule | Example (rate 89,500, sale $6.72) |
|---|---|---|
| Sale total | `total` (USD, 2 decimals). Recorded on the sale, in reports, and in the shift's expected cash | **$6.72** |
| Total in LBP | `totalLbp = total × rate` | 601,440 |
| Cash payable (LBP) | `payableLbp = ceilLbp(totalLbp, 5000)`: rounded **up** to the next 5,000 note | **605,000** (+3,560 LBP) |
| Cash payable (USD) | `payableUsd = payableLbp ÷ rate`, rounded to cents. **Used for USD and mixed cash too** | **$6.76** (+$0.04) |
| Paid enough? | LBP-only tender: `paidLbp ≥ payableLbp`. Otherwise: paid total in USD + 0.005 ≥ `payableUsd` | |
| Change | `computeCashChange` against the **payable** amount. LBP-only tender: change in LBP = `paidLbp − payableLbp`. USD or mixed tender: `changeUsd = paid − payableUsd`; `changeLbp` is only its conversion | |
| Change currency | `tender.changeCurrency`: LBP for a pure-LBP tender, **USD otherwise** | |
| Exact buttons | Exact USD fills `payableUsd`; Exact LBP fills `payableLbp` | |
| Stored on the sale | `total`, `payableLbp`, and `tender` (paid USD/LBP, paid totals, change USD/LBP, change currency, rate) | |

## 2. Worked examples (from the evidence script)

Every row is the same $6.72 cash sale.

| Tender | Change given | Kept in drawer | Expected cash credited | Difference |
|---|---|---|---|---|
| Exact LBP (605,000) | none | $6.76 | $6.72 | **+$0.04** |
| Exact USD ($6.76) | none | $6.76 | $6.72 | **+$0.04** |
| $20 + 200,000 LBP | **$15.47 in USD** (≈ 1,384,565 LBP) | $6.76 | $6.72 | **+$0.04** |
| 1,000,000 LBP | **395,000 LBP** | $6.76 | $6.72 | **+$0.04** |
| $10 | **$3.24 in USD** | $6.76 | $6.72 | **+$0.04** |

## 3. Where each number appears

| Surface | Shows | Consistent with the drawer? |
|---|---|---|
| Register total (v2 slice) | $6.72, then "605,000 LBP cash · $6.76", then "Rounded up from 601,440" | Yes. The payable line is what the cashier takes |
| Pay button / review / receipt panel (v2) | Payable amount ($6.76 · 605,000 LBP) and the change, led by the currency actually handed back | Yes |
| Printed receipt (`printReceipt.ts`) | Total $6.72, "Total LBP 601,440", "Cash rounding +3,560", "Cash payable 605,000", Paid, Change USD and Change LBP | Yes, but it prints **both** change lines, although only one currency is handed back |
| Shift expected cash (`shift.service.ts`), drawer widget, daily close | Opening float + Σ **sale totals** of cash sales − cash refunds − cash expenses − cash supplier payments ± cash in/out | **No.** The rounding kept on each cash sale is not counted |
| Server Z-report (`reports.ts`) | The same formula, server side | **No**, for the same reason |

## 4. What reconciles and what doesn't

- **Each sale:** paid − change = payable. Payable − total = the rounding the store keeps (+3,560 LBP, $0.04 here). This is exact and stored: `payableLbp` and `tender` are on the sale.
- **Each shift:** counted cash − expected cash = **Σ rounding of all cash sales** + any real over/short. At 300 cash sales a day, averaging about 2,500 LBP of rounding each, the drawer closes about **$8 over** with no error. That is noise next to the "short $6.50" a cashier would be asked to explain.
- **USD-paying customers are rounded too.** A customer who pays in dollars pays $6.76, not $6.72, because USD and mixed cash use `payableUsd`, which is derived from the LBP rounding.
- **Change in mixed tenders** is given in USD, with no rounding to coins. Change in pure-LBP tenders is an exact multiple of 5,000 only when the paid amount is too; for example, 1,000,000 − 605,000 = 395,000.
- **Exchange rate.** Everything above uses the sale's own rate. A drawer holding LBP that is counted in USD at another day's rate will differ by the rate movement. The drawer widget's "counted" field is USD only.

## 5. Decisions needed (policy, not code)

1. **Record the rounding** so expected cash includes it. For example, store `payableUsd` on cash sales and use it in expected cash, or record a "cash rounding" line. Without this, every drawer closes over.
2. **Should USD-paying customers be rounded?** Current behaviour: yes (+$0.04 here). The alternative: round only LBP tenders and charge USD at the exact `total`.
3. **Change rounding.** Should LBP change be rounded to notes (and in which direction), and should mixed-tender change be offered in LBP?
4. **Printed receipt.** Print only the change actually handed back (USD *or* LBP).
5. **Drawer count in two currencies.** Count USD and LBP separately at close (as the v2 close-the-day preview proposes), converted at a stated rate.

Once these are approved, the implementation and its tests belong with the money rules (`lib/currency.ts`, `shift.service.ts`, `reports.ts`), as a correctness change, separate from design work.

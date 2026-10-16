// Worked examples of the CURRENT cash rules, computed with the app's own
// functions (apps/desktop/src/features/pos/lib/currency.ts + POSPage formulas).
// Run: npx tsx docs/evidence/cash-rounding-reconciliation.ts  (from apps/desktop)
import { ceilLbp, computeCashChange, lbpToUsd, roundMoney, usdToLbp } from "../../apps/desktop/src/features/pos/lib/currency"

const rate = 89_500
const total = 6.72 // sale total (USD) as recorded on the sale and in the shift's expected cash
const totalLbp = usdToLbp(total, rate)
const payableLbp = ceilLbp(totalLbp, 5000)         // POSPage: cash payable, LBP rounded UP to 5,000
const payableUsd = lbpToUsd(payableLbp, rate)       // POSPage: its USD equivalent (used for USD and mixed cash too)

const cases: Array<[string, number, number]> = [
  ["Exact LBP", 0, payableLbp],
  ["Exact USD", payableUsd, 0],
  ["$20 + 200,000 LBP (mixed)", 20, 200_000],
  ["1,000,000 LBP only", 0, 1_000_000],
  ["$10 only", 10, 0],
]
console.log({ rate, total, totalLbp, payableLbp, payableUsd, roundingLbp: payableLbp - totalLbp, roundingUsd: roundMoney(payableUsd - total) })
for (const [label, paidUsd, paidLbp] of cases) {
  const { changeUsd, changeLbp } = computeCashChange({ paidUsd, paidLbp, totalUsd: payableUsd, totalLbp: payableLbp, exchangeRate: rate })
  const tenderMode = paidLbp > 0 ? (paidUsd > 0 ? "Mixed" : "LBP") : "USD"
  const changeCurrency = tenderMode === "LBP" ? "LBP" : "USD"
  // What physically stays in the drawer, valued in USD at the sale's rate:
  const keptUsd = roundMoney(paidUsd + lbpToUsd(paidLbp, rate) - (changeCurrency === "USD" ? changeUsd : lbpToUsd(changeLbp, rate)))
  console.log(JSON.stringify({ label, paidUsd, paidLbp, tenderMode, changeCurrency, changeUsd, changeLbp, drawerGainUsd: keptUsd, expectedCashCredit: total, unexplainedOverUsd: roundMoney(keptUsd - total) }))
}

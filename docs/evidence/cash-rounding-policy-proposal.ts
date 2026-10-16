// PROPOSED cash rounding policy vs the CURRENT rules, on the same sales.
// Nothing here is wired into the app: it is the arithmetic the proposal in
// docs/CASH-ROUNDING-POLICY-PROPOSAL.md asks to approve.
// Run: npx tsx ../../docs/evidence/cash-rounding-policy-proposal.ts  (from apps/desktop)
import { ceilLbp, computeCashChange, lbpToUsd, roundMoney, usdToLbp } from "../../apps/desktop/src/features/pos/lib/currency"

type ChangeCurrency = "USD" | "LBP"
type Tender = { paidUsd: number; paidLbp: number; changeIn?: ChangeCurrency }

/** Current rules (POSPage + currency.ts): LBP payable rounded up to 5,000, USD and mixed charged its USD equivalent. */
function current(total: number, rate: number, t: Tender) {
  const payableLbp = ceilLbp(usdToLbp(total, rate), 5000)
  const payableUsd = lbpToUsd(payableLbp, rate)
  const { changeUsd, changeLbp } = computeCashChange({ paidUsd: t.paidUsd, paidLbp: t.paidLbp, totalUsd: payableUsd, totalLbp: payableLbp, exchangeRate: rate })
  const lbpOnly = t.paidLbp > 0 && t.paidUsd === 0
  const keptLbp = lbpOnly ? t.paidLbp - changeLbp : t.paidLbp
  const keptUsd = lbpOnly ? 0 : roundMoney(t.paidUsd - changeUsd)
  const keptValueLbp = keptLbp + Math.round(keptUsd * rate)
  return { change: lbpOnly ? `${changeLbp} LBP` : `$${changeUsd.toFixed(2)}`, keptValueLbp, expectedCreditLbp: Math.round(total * rate) }
}

/**
 * Proposed rules.
 *  1. USD is exact: dollars pay the total to the cent.
 *  2. Only an amount still due in LBP is rounded, UP to `denom` (0 = no rounding).
 *  3. USD is applied first; the rest is due in LBP. Change currency is explicit
 *     (default: LBP if any LBP was tendered, else USD). LBP change rounds DOWN to `denom`.
 *  4. rounding = value kept − sale total, recorded on the sale in LBP (exact integer); total untouched.
 */
function proposed(total: number, rate: number, denom: number, t: Tender) {
  const totalLbp = Math.round(total * rate)
  const remainingUsd = roundMoney(Math.max(0, total - t.paidUsd))
  const dueLbp = remainingUsd > 0 ? (denom > 0 ? ceilLbp(Math.round(remainingUsd * rate), denom) : Math.round(remainingUsd * rate)) : 0
  const changeIn: ChangeCurrency = t.changeIn ?? (t.paidLbp > 0 ? "LBP" : "USD")
  let changeUsd = 0
  let changeLbp = 0
  if (remainingUsd === 0) {
    // USD covered the total: all LBP comes back, plus the USD excess in the chosen currency.
    const excessUsd = roundMoney(t.paidUsd - total)
    if (changeIn === "USD") { changeUsd = excessUsd; changeLbp = t.paidLbp }
    else { const raw = Math.round(excessUsd * rate) + t.paidLbp; changeLbp = denom > 0 ? Math.floor(raw / denom) * denom : raw }
  } else {
    if (t.paidLbp < dueLbp) return { short: `still due ${dueLbp - t.paidLbp} LBP` }
    const raw = t.paidLbp - dueLbp
    if (changeIn === "LBP") changeLbp = denom > 0 ? Math.floor(raw / denom) * denom : raw
    else { changeUsd = Math.floor(raw / rate * 100) / 100; changeLbp = 0 }
  }
  const keptUsd = roundMoney(t.paidUsd - changeUsd)
  const keptLbp = t.paidLbp - changeLbp
  const keptValueLbp = keptLbp + Math.round(keptUsd * rate)
  const roundingLbp = keptValueLbp - totalLbp
  return {
    dueLbp, change: [changeUsd ? `$${changeUsd.toFixed(2)}` : "", changeLbp ? `${changeLbp} LBP` : ""].filter(Boolean).join(" + ") || "none",
    keptUsd, keptLbp, roundingLbp, expectedCreditLbp: totalLbp + roundingLbp, reconciles: keptValueLbp === totalLbp + roundingLbp,
  }
}

/** Proposed refund payout: amount from the refund rules (sale.total based, unchanged); an LBP payout rounds UP to `denom`. */
function refundPayout(refundUsd: number, rate: number, denom: number, payIn: ChangeCurrency) {
  if (payIn === "USD") return { payout: `$${refundUsd.toFixed(2)}`, roundingLbp: 0 }
  const raw = Math.round(refundUsd * rate)
  const paid = denom > 0 ? ceilLbp(raw, denom) : raw
  return { payout: `${paid} LBP`, roundingLbp: -(paid - raw) } // negative: extra cash out, recorded on the refund
}

const rate = 89_500
const total = 6.72
const cases: Array<[string, Tender]> = [
  ["Exact USD $6.72", { paidUsd: 6.72, paidLbp: 0 }],
  ["$10", { paidUsd: 10, paidLbp: 0 }],
  ["Exact LBP", { paidUsd: 0, paidLbp: 605_000 }],
  ["1,000,000 LBP", { paidUsd: 0, paidLbp: 1_000_000 }],
  ["$5 + 200,000 LBP (change LBP)", { paidUsd: 5, paidLbp: 200_000 }],
  ["$5 + 200,000 LBP (change USD)", { paidUsd: 5, paidLbp: 200_000, changeIn: "USD" }],
  ["$20 + 200,000 LBP (change USD)", { paidUsd: 20, paidLbp: 200_000, changeIn: "USD" }],
  ["$20 + 200,000 LBP (change LBP)", { paidUsd: 20, paidLbp: 200_000, changeIn: "LBP" }],
]
console.log(`rate ${rate}, sale total $${total} = ${Math.round(total * rate)} LBP`)
for (const denom of [5000, 1000]) {
  console.log(`\n── LBP denomination ${denom} ──`)
  for (const [label, t] of cases) {
    const c = current(total, rate, t)
    const p = proposed(total, rate, denom, t)
    console.log(JSON.stringify({ label, current: { change: c.change, overLbp: c.keptValueLbp - c.expectedCreditLbp }, proposed: p }))
  }
}
console.log("\n── refunds (sale paid in LBP, 605,000 kept, rounding +3,560) ──")
for (const [label, usd] of [["full refund $6.72", 6.72], ["partial refund $1.50", 1.5]] as const) {
  for (const denom of [5000, 1000]) console.log(JSON.stringify({ label, denom, LBP: refundPayout(usd, rate, denom, "LBP"), USD: refundPayout(usd, rate, denom, "USD") }))
}
// Shift: float $100 + the sale paid exact LBP, then a full LBP refund.
const s = proposed(total, rate, 5000, { paidUsd: 0, paidLbp: 605_000 })
const r = refundPayout(total, rate, 5000, "LBP")
if (!("roundingLbp" in s)) throw new Error("unexpected short tender")
const expectedLbp = 0 + (Math.round(total * rate) + s.roundingLbp) - (Math.round(total * rate) - r.roundingLbp)
console.log("\nshift after sale + full refund, LBP drawer expected change:", expectedLbp, "(customer got back exactly the 605,000 paid)")

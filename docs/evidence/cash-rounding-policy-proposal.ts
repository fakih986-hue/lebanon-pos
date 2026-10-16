// Cash rounding policy proposal, revision 2: the arithmetic behind
// docs/CASH-ROUNDING-POLICY-PROPOSAL.md. Nothing here is wired into the app.
// Run: npx tsx ../../docs/evidence/cash-rounding-policy-proposal.ts  (from apps/desktop)
//
// Every amount is kept per currency: USD in cents, LBP in whole pounds. A
// "value" (LBP at the sale's own rate) is used only to compare and allocate;
// the drawer is never balanced on it.
import { ceilLbp, computeCashChange, lbpToUsd, roundMoney, usdToLbp } from "../../apps/desktop/src/features/pos/lib/currency"

type Mode = "none" | "up" | "nearest" | "down"
/** Snapshot stored on every cash sale: the server validates against this, never against today's settings. */
type CashPolicy = {
  version: 1
  due: { mode: "none" | "up" | "nearest"; denomLbp: number }      // rounding of an amount still due in LBP
  change: { mode: "none" | "down" | "nearest"; denomLbp: number }  // rounding of LBP change actually handed back
  usdChange: "cents" | "dollars"                                   // dollars: whole dollars in USD, the rest in LBP
}
type Tender = { paidUsd: number; paidLbp: number; changeIn: "USD" | "LBP" }

const cents = (usd: number) => Math.round(usd * 100)
function roundTo(v: number, denom: number, mode: Mode) {
  if (mode === "none" || denom <= 0) return Math.round(v)
  const q = v / denom
  return (mode === "up" ? Math.ceil(q - 1e-9) : mode === "down" ? Math.floor(q + 1e-9) : Math.round(q)) * denom
}

/** One cash sale under a policy snapshot. USD first and exact; any LBP remainder rounded per `due`. */
function settle(totalUsd: number, rate: number, t: Tender, p: CashPolicy) {
  const totalLbp = Math.round(totalUsd * rate)
  const remainingCents = Math.max(0, cents(totalUsd) - cents(t.paidUsd))
  const dueLbp = remainingCents > 0 ? roundTo((remainingCents / 100) * rate, p.due.denomLbp, p.due.mode) : 0
  // Value tendered above what is due, in LBP at the sale rate (exact integer at an integer rate).
  const overLbp = remainingCents > 0 ? t.paidLbp - dueLbp : t.paidLbp + Math.round(((cents(t.paidUsd) - cents(totalUsd)) / 100) * rate)
  if (overLbp < 0) return { short: `still due ${-overLbp} LBP` as const }
  let changeUsdCents = 0
  let changeLbp = 0
  if (t.changeIn === "LBP") {
    changeLbp = roundTo(overLbp, p.change.denomLbp, p.change.mode)
  } else {
    // The cashier chose USD: the whole excess in USD at the sale rate (cents, or whole dollars),
    // and only what USD cannot express comes back in LBP, rounded per the change policy.
    const usdCents = Math.floor(overLbp / rate * 100 + 1e-9)
    changeUsdCents = p.usdChange === "dollars" ? Math.floor(usdCents / 100) * 100 : usdCents
    changeLbp = roundTo(overLbp - Math.round((changeUsdCents / 100) * rate), p.change.denomLbp, p.change.mode)
  }
  const keptUsdCents = cents(t.paidUsd) - changeUsdCents
  const keptLbp = t.paidLbp - changeLbp
  const valueLbp = Math.round((keptUsdCents / 100) * rate) + keptLbp
  return {
    dueLbp, changeUsd: changeUsdCents / 100, changeLbp,
    keptUsd: keptUsdCents / 100, keptLbp,          // the drawer movements, per currency
    roundingLbp: valueLbp - totalLbp,              // recorded separately; total is untouched
    valueLbp,                                      // = totalLbp + roundingLbp, at the sale rate
  }
}

/**
 * Refunds, allocated CUMULATIVELY. The refund rules (unchanged) give each
 * refund's USD amount from sale.total. The cash to give back after k refunds
 * is valueLbp × (Σ amounts / total), never more than the cash the sale kept.
 * Each payout is that cumulative target minus what was already paid out,
 * rounded once in the payout currency — rounding never compounds, and the
 * last refund takes whatever remains.
 */
function refundSequence(sale: { totalUsd: number; rate: number; valueLbp: number }, p: CashPolicy, refunds: Array<{ amountUsd: number; payIn: "USD" | "LBP" }>) {
  let refundedCents = 0
  let paidValue = 0
  const rows = []
  for (const r of refunds) {
    refundedCents += cents(r.amountUsd)
    const targetValue = Math.round(sale.valueLbp * refundedCents / cents(sale.totalUsd))
    const owed = Math.min(targetValue, sale.valueLbp) - paidValue
    const final = refundedCents >= cents(sale.totalUsd)
    let usd = 0, lbp = 0
    if (r.payIn === "USD") usd = Math.floor(owed / sale.rate * 100) / 100
    else {
      lbp = roundTo(owed, p.change.denomLbp, p.change.mode === "none" ? "none" : "nearest")
      if (paidValue + lbp > sale.valueLbp) lbp = roundTo(owed, p.change.denomLbp, "down") // cap: never above what was kept
      // The last refund settles what LBP notes cannot: the leftover in USD cents (floor, so still within the cap).
      if (final) usd = Math.floor((owed - lbp) / sale.rate * 100) / 100
    }
    const value = Math.round(usd * sale.rate) + lbp
    paidValue += value
    rows.push({ refundUsd: r.amountUsd, payIn: r.payIn, targetValue, payout: [lbp ? `${lbp.toLocaleString("en")} LBP` : "", usd ? `$${usd.toFixed(2)}` : ""].filter(Boolean).join(" + ") || "none", payoutUsd: usd, payoutLbp: lbp,
      refundRoundingLbp: value - Math.round(r.amountUsd * sale.rate), carried: targetValue - paidValue, paidSoFar: paidValue })
  }
  return { rows, paidValue, cap: sale.valueLbp, withinCap: paidValue <= sale.valueLbp }
}

/** The naive rule the proposal rejects: every partial refund rounded up on its own. */
function naiveRefunds(rate: number, denom: number, amounts: number[]) {
  return amounts.reduce((s, a) => s + ceilLbp(Math.round(a * rate), denom), 0)
}

// ── Inputs ──
const rate = 89_500
const total = 6.72
const P = (dueMode: CashPolicy["due"]["mode"], changeMode: CashPolicy["change"]["mode"], denom = 5000, usdChange: CashPolicy["usdChange"] = "cents"): CashPolicy =>
  ({ version: 1, due: { mode: dueMode, denomLbp: denom }, change: { mode: changeMode, denomLbp: denom }, usdChange })

console.log(`rate ${rate}; sale total $${total} = ${Math.round(total * rate).toLocaleString("en")} LBP\n`)

console.log("── 1. Amount-due rounding: up vs nearest (pure LBP) ──")
for (const t of [6.72, 6.70, 3.15, 1.10]) for (const mode of ["up", "nearest"] as const) for (const d of [5000, 1000]) {
  const s = settle(t, rate, { paidUsd: 0, paidLbp: 10_000_000, changeIn: "LBP" }, P(mode, "none", d))
  if ("short" in s) continue
  console.log(JSON.stringify({ totalUsd: t, totalLbp: Math.round(t * rate), mode, denom: d, dueLbp: s.dueLbp, roundingLbp: s.roundingLbp }))
}

console.log("\n── 2. Change rounding: down vs nearest (USD paid, change in LBP) ──")
for (const [paid, label] of [[10, "$10"], [7, "$7"], [20, "$20"]] as const) for (const mode of ["down", "nearest"] as const) {
  const s = settle(total, rate, { paidUsd: paid, paidLbp: 0, changeIn: "LBP" }, P("nearest", mode))
  if ("short" in s) continue
  console.log(JSON.stringify({ tender: label, changeMode: mode, exactChangeLbp: Math.round((paid - total) * rate), changeLbp: s.changeLbp, roundingLbp: s.roundingLbp }))
}

console.log("\n── 3. Every tender, recommended policy (due nearest, change nearest, 5,000) ──")
const rec = P("nearest", "nearest")
const cases: Array<[string, Tender]> = [
  ["Exact USD $6.72", { paidUsd: 6.72, paidLbp: 0, changeIn: "USD" }],
  ["$10, change USD", { paidUsd: 10, paidLbp: 0, changeIn: "USD" }],
  ["$10, change LBP", { paidUsd: 10, paidLbp: 0, changeIn: "LBP" }],
  ["$10, change whole dollars + LBP", { paidUsd: 10, paidLbp: 0, changeIn: "USD" }],
  ["Exact LBP", { paidUsd: 0, paidLbp: 600_000, changeIn: "LBP" }],
  ["1,000,000 LBP", { paidUsd: 0, paidLbp: 1_000_000, changeIn: "LBP" }],
  ["$5 + 200,000 LBP, change LBP", { paidUsd: 5, paidLbp: 200_000, changeIn: "LBP" }],
  ["$5 + 200,000 LBP, change USD", { paidUsd: 5, paidLbp: 200_000, changeIn: "USD" }],
  ["$20 + 200,000 LBP, change USD", { paidUsd: 20, paidLbp: 200_000, changeIn: "USD" }],
]
for (const [label, t] of cases) {
  const pol = label.includes("whole dollars") ? P("nearest", "nearest", 5000, "dollars") : rec
  const s = settle(total, rate, t, pol)
  const cur = (() => { // current rules, for comparison
    const payableLbp = ceilLbp(usdToLbp(total, rate), 5000); const payableUsd = lbpToUsd(payableLbp, rate)
    const { changeUsd, changeLbp } = computeCashChange({ paidUsd: t.paidUsd, paidLbp: t.paidLbp, totalUsd: payableUsd, totalLbp: payableLbp, exchangeRate: rate })
    return t.paidUsd === 0 ? `${changeLbp} LBP` : `$${roundMoney(changeUsd).toFixed(2)}`
  })()
  console.log(JSON.stringify({ label, currentChange: cur, ...s }))
}

console.log("\n── 4. Refunds, cumulative allocation (recommended policy) ──")
const lbpSale = settle(total, rate, { paidUsd: 0, paidLbp: 600_000, changeIn: "LBP" }, rec) as ReturnType<typeof settle> & { valueLbp: number }
const upSale = settle(total, rate, { paidUsd: 0, paidLbp: 605_000, changeIn: "LBP" }, P("up", "nearest")) as ReturnType<typeof settle> & { valueLbp: number }
const mixSale = settle(total, rate, { paidUsd: 5, paidLbp: 200_000, changeIn: "LBP" }, rec) as ReturnType<typeof settle> & { valueLbp: number }
const show = (label: string, sale: { valueLbp: number }, pol: CashPolicy, rs: Array<{ amountUsd: number; payIn: "USD" | "LBP" }>) => {
  const out = refundSequence({ totalUsd: total, rate, valueLbp: sale.valueLbp }, pol, rs)
  console.log(label, JSON.stringify({ keptValueLbp: out.cap, paidBackValueLbp: out.paidValue, withinCap: out.withinCap }))
  for (const r of out.rows) console.log("   ", JSON.stringify(r))
}
show("A. full refund, LBP sale (kept 600,000)", lbpSale, rec, [{ amountUsd: 6.72, payIn: "LBP" }])
show("B. full refund, sale rounded UP (kept 605,000)", upSale, P("up", "nearest"), [{ amountUsd: 6.72, payIn: "LBP" }])
show("C. partial $1.50 then the rest", lbpSale, rec, [{ amountUsd: 1.5, payIn: "LBP" }, { amountUsd: 5.22, payIn: "LBP" }])
show("D. four repeated partials of $1.68", upSale, P("up", "nearest"), [1, 2, 3, 4].map(() => ({ amountUsd: 1.68, payIn: "LBP" as const })))
show("E. mixed sale ($5 + 155,000 LBP kept), refund half in USD then half in LBP", mixSale, rec, [{ amountUsd: 3.36, payIn: "USD" }, { amountUsd: 3.36, payIn: "LBP" }])
const usdSale = settle(total, rate, { paidUsd: 6.72, paidLbp: 0, changeIn: "USD" }, rec) as ReturnType<typeof settle> & { valueLbp: number }
show("F. USD sale ($6.72 kept) refunded in LBP", usdSale, rec, [{ amountUsd: 6.72, payIn: "LBP" }])
console.log("naive rule for D (each partial rounded up):", naiveRefunds(rate, 5000, [1.68, 1.68, 1.68, 1.68]).toLocaleString("en"), "LBP paid back vs 605,000 received")

console.log("\n── 5. Drawer per currency (one shift) ──")
// Float $100 + 0 LBP. Sales: exact LBP; $10 change USD; $5 + 200,000 change LBP. Then refund C (partial $1.50 in LBP).
const shiftSales = [
  settle(total, rate, { paidUsd: 0, paidLbp: 600_000, changeIn: "LBP" }, rec),
  settle(total, rate, { paidUsd: 10, paidLbp: 0, changeIn: "USD" }, rec),
  settle(total, rate, { paidUsd: 5, paidLbp: 200_000, changeIn: "LBP" }, rec),
] as Array<{ keptUsd: number; keptLbp: number; roundingLbp: number; valueLbp: number }>
const refund = refundSequence({ totalUsd: total, rate, valueLbp: shiftSales[0].valueLbp }, rec, [{ amountUsd: 1.5, payIn: "LBP" }]).rows[0]
const expectedUsd = roundMoney(100 + shiftSales.reduce((s, x) => s + x.keptUsd, 0) - refund.payoutUsd)
const expectedLbp = shiftSales.reduce((s, x) => s + x.keptLbp, 0) - refund.payoutLbp
console.log(JSON.stringify({ expectedUsd, expectedLbp, salesRoundingLbp: shiftSales.reduce((s, x) => s + x.roundingLbp, 0), refundRoundingLbp: refund.refundRoundingLbp }))
for (const closingRate of [89_500, 90_000]) {
  console.log(JSON.stringify({ reportingOnly: `USD-equivalent at closing rate ${closingRate}`, totalUsdEq: roundMoney(expectedUsd + expectedLbp / closingRate) }))
}

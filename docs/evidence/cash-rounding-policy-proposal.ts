// Cash rounding policy proposal, revision 3: the arithmetic behind
// docs/CASH-ROUNDING-POLICY-PROPOSAL.md. Nothing here is wired into the app.
// Run: npx tsx ../../docs/evidence/cash-rounding-policy-proposal.ts  (from apps/desktop)
//
// Amounts are kept per currency: USD in cents, LBP in whole pounds. A
// "value" (LBP at the sale's own rate) is used only to state the adjustment;
// the drawer is balanced per currency, never on the value.
import { ceilLbp } from "../../apps/desktop/src/features/pos/lib/currency"

type Mode = "none" | "up" | "nearest" | "down"
/** Snapshot stored on every cash sale: the server validates against this, never against today's settings. */
type CashPolicy = {
  version: 1
  due: { mode: "none" | "up" | "nearest"; denomLbp: number }      // rounding of an amount still due in LBP
  change: { mode: "none" | "down" | "nearest"; denomLbp: number }  // rounding of LBP change actually handed back
  usdChange: "cents" | "dollars"
}
type Tender = { paidUsd: number; paidLbp: number; changeIn: "USD" | "LBP" }
type Movement = { currency: "USD" | "LBP"; amount: number; what: string } // + into the drawer, − out of it

const cents = (usd: number) => Math.round(usd * 100)
const fmt = (m: Movement) => `${m.amount >= 0 ? "+" : "−"}${m.currency === "USD" ? "$" + Math.abs(m.amount).toFixed(2) : Math.abs(m.amount).toLocaleString("en") + " LBP"} ${m.what}`
function roundTo(v: number, denom: number, mode: Mode) {
  if (mode === "none" || denom <= 0) return Math.round(v)
  const q = v / denom
  return (mode === "up" ? Math.ceil(q - 1e-9) : mode === "down" ? Math.floor(q + 1e-9) : Math.round(q)) * denom
}

/**
 * One cash sale, settled in a fixed order so each rounding applies to its own
 * quantity exactly once:
 *   1. USD is applied first, exactly (cents).
 *   2. DUE rounding applies once, to the LBP still due  → dueAdjustment.
 *   3. Change is computed from what was tendered beyond the ROUNDED due (never
 *      from the unrounded remainder), and CHANGE rounding applies once, to the
 *      LBP actually handed back                          → changeAdjustment.
 *   4. Recorded adjustment = dueAdjustment + changeAdjustment, and it must
 *      equal (value kept − sale total) computed from the physical movements.
 */
function settle(totalUsd: number, rate: number, t: Tender, p: CashPolicy) {
  const totalLbp = Math.round(totalUsd * rate)
  const remainingCents = Math.max(0, cents(totalUsd) - cents(t.paidUsd))
  const exactDueLbp = Math.round((remainingCents / 100) * rate)
  const dueLbp = remainingCents > 0 ? roundTo(exactDueLbp, p.due.denomLbp, p.due.mode) : 0
  const dueAdjustmentLbp = dueLbp - exactDueLbp
  const owedBackLbp = remainingCents > 0 ? t.paidLbp - dueLbp : t.paidLbp + Math.round(((cents(t.paidUsd) - cents(totalUsd)) / 100) * rate)
  if (owedBackLbp < 0) return { short: `still due ${(-owedBackLbp).toLocaleString("en")} LBP` }
  let changeUsdCents = 0
  let changeLbp = 0
  if (t.changeIn === "LBP") changeLbp = roundTo(owedBackLbp, p.change.denomLbp, p.change.mode)
  else {
    const usdCents = Math.floor(owedBackLbp / rate * 100 + 1e-9)
    changeUsdCents = p.usdChange === "dollars" ? Math.floor(usdCents / 100) * 100 : usdCents
    changeLbp = roundTo(owedBackLbp - Math.round((changeUsdCents / 100) * rate), p.change.denomLbp, p.change.mode)
  }
  const changeGivenValue = Math.round((changeUsdCents / 100) * rate) + changeLbp
  const changeAdjustmentLbp = owedBackLbp - changeGivenValue
  const movements: Movement[] = [
    ...(t.paidUsd ? [{ currency: "USD" as const, amount: t.paidUsd, what: "tendered" }] : []),
    ...(t.paidLbp ? [{ currency: "LBP" as const, amount: t.paidLbp, what: "tendered" }] : []),
    ...(changeUsdCents ? [{ currency: "USD" as const, amount: -changeUsdCents / 100, what: "change" }] : []),
    ...(changeLbp ? [{ currency: "LBP" as const, amount: -changeLbp, what: "change" }] : []),
  ]
  const keptUsd = (cents(t.paidUsd) - changeUsdCents) / 100
  const keptLbp = t.paidLbp - changeLbp
  const keptValueLbp = Math.round(keptUsd * rate) + keptLbp
  const adjustmentLbp = dueAdjustmentLbp + changeAdjustmentLbp
  if (adjustmentLbp !== keptValueLbp - totalLbp) throw new Error("adjustment does not match the physical movements")
  return { exactDueLbp, dueLbp, dueAdjustmentLbp, owedBackLbp, changeUsd: changeUsdCents / 100, changeLbp, changeAdjustmentLbp, adjustmentLbp, keptUsd, keptLbp, keptValueLbp, movements }
}
type Settled = Exclude<ReturnType<typeof settle>, { short: string }>

/** The mistake the order above prevents: change from the UNROUNDED remainder, then both roundings recorded. */
function naiveDoubleRounding(totalUsd: number, rate: number, t: Tender, p: CashPolicy) {
  const exactDueLbp = Math.round(((cents(totalUsd) - cents(t.paidUsd)) / 100) * rate)
  const dueLbp = roundTo(exactDueLbp, p.due.denomLbp, p.due.mode)
  const changeExact = t.paidLbp - exactDueLbp                       // ← from the unrounded remainder
  const changeLbp = roundTo(changeExact, p.change.denomLbp, p.change.mode)
  const recorded = (dueLbp - exactDueLbp) + (changeExact - changeLbp) // both adjustments booked
  const actual = (t.paidLbp - changeLbp) - exactDueLbp               // what the drawer really kept beyond the price
  return { changeLbp, recordedAdjustmentLbp: recorded, actualAdjustmentLbp: actual, cashierCollectedDue: t.paidLbp - changeLbp }
}

/**
 * Refunds keep the ORIGINAL TENDER BREAKDOWN. Each currency the customer net
 * paid is refunded in that currency, in proportion to the cumulative refunded
 * share of the sale (refund amounts still come from the refund rules on
 * sale.total). Per currency, the cumulative target is rounded once (USD down
 * to the cent, LBP to the nearest change denomination, never above what that
 * currency kept), each payout is the target minus what was already paid in
 * that currency, and the last refund pays the exact remainder of each currency.
 * Where change in one currency exceeded what was paid in it (kept < 0), that
 * leg is netted into the other currency at the sale's rate.
 */
function refundSequence(sale: Settled, totalUsd: number, rate: number, p: CashPolicy, amountsUsd: number[]) {
  // Net breakdown per currency (both ≥ 0).
  let netUsdCents = cents(sale.keptUsd), netLbp = sale.keptLbp
  if (netLbp < 0) { netUsdCents = Math.floor(sale.keptValueLbp / rate * 100 + 1e-9); netLbp = 0 }
  if (netUsdCents < 0) { netLbp = sale.keptValueLbp; netUsdCents = 0 }
  let refunded = 0, paidUsdCents = 0, paidLbp = 0
  const rows = amountsUsd.map((a) => {
    refunded += cents(a)
    const final = refunded >= cents(totalUsd)
    const share = refunded / cents(totalUsd)
    const targetUsd = final ? netUsdCents : Math.floor(netUsdCents * share)
    const targetLbp = final ? netLbp : Math.min(netLbp, roundTo(netLbp * share, p.change.denomLbp, p.change.mode === "none" ? "none" : "nearest"))
    const usd = targetUsd - paidUsdCents, lbp = targetLbp - paidLbp
    paidUsdCents += usd; paidLbp += lbp
    const movements: Movement[] = [...(usd ? [{ currency: "USD" as const, amount: -usd / 100, what: "refund" }] : []), ...(lbp ? [{ currency: "LBP" as const, amount: -lbp, what: "refund" }] : [])]
    return { refundUsd: a, payout: movements.map(fmt).join(", ") || "none", refundAdjustmentLbp: Math.round((usd / 100) * rate) + lbp - Math.round(a * rate) }
  })
  return { breakdown: { usd: netUsdCents / 100, lbp: netLbp }, rows, paidBack: { usd: paidUsdCents / 100, lbp: paidLbp }, withinBreakdown: paidUsdCents <= netUsdCents && paidLbp <= netLbp }
}

const rate = 89_500
const total = 6.72
const P = (dueMode: CashPolicy["due"]["mode"], changeMode: CashPolicy["change"]["mode"], denom = 5000, usdChange: CashPolicy["usdChange"] = "cents"): CashPolicy =>
  ({ version: 1, due: { mode: dueMode, denomLbp: denom }, change: { mode: changeMode, denomLbp: denom }, usdChange })
const rec = P("nearest", "nearest")
const sale = (t: Tender, p = rec) => { const s = settle(total, rate, t, p); if ("short" in s) throw new Error(s.short); return s }

console.log(`rate ${rate}; sale total $${total} = ${Math.round(total * rate).toLocaleString("en")} LBP; policy: due nearest 5,000, change nearest 5,000, USD change in cents\n`)

console.log("── 1. Due rounding: up vs nearest (pure LBP) ──")
for (const t of [6.72, 3.15, 1.10]) for (const mode of ["up", "nearest"] as const) for (const d of [5000, 1000]) {
  const s = settle(t, rate, { paidUsd: 0, paidLbp: 10_000_000, changeIn: "LBP" }, P(mode, "none", d)) as Settled
  console.log(JSON.stringify({ totalUsd: t, exactLbp: s.exactDueLbp, mode, denom: d, dueLbp: s.dueLbp, dueAdjustmentLbp: s.dueAdjustmentLbp }))
}

console.log("\n── 2. Change rounding: down vs nearest ($ paid, change in LBP) ──")
for (const paid of [10, 20]) for (const mode of ["down", "nearest"] as const) {
  const s = settle(total, rate, { paidUsd: paid, paidLbp: 0, changeIn: "LBP" }, P("nearest", mode)) as Settled
  console.log(JSON.stringify({ paid: `$${paid}`, changeMode: mode, owedBackLbp: s.owedBackLbp, changeLbp: s.changeLbp, changeAdjustmentLbp: s.changeAdjustmentLbp }))
}

console.log("\n── 3. Mixed payments end to end: each rounding once, recorded adjustment = physical result ──")
const mixed: Array<[string, Tender]> = [
  ["$5 + 200,000 LBP, change LBP", { paidUsd: 5, paidLbp: 200_000, changeIn: "LBP" }],
  ["$5 + 157,000 LBP, change LBP", { paidUsd: 5, paidLbp: 157_000, changeIn: "LBP" }],
  ["$5 + 200,000 LBP, change USD", { paidUsd: 5, paidLbp: 200_000, changeIn: "USD" }],
  ["$20 + 200,000 LBP, change USD", { paidUsd: 20, paidLbp: 200_000, changeIn: "USD" }],
  ["$10, change LBP", { paidUsd: 10, paidLbp: 0, changeIn: "LBP" }],
]
for (const [label, t] of mixed) {
  const s = sale(t)
  console.log(label)
  console.log("   steps:", JSON.stringify({ exactDueLbp: s.exactDueLbp, dueLbp: s.dueLbp, dueAdjustmentLbp: s.dueAdjustmentLbp, owedBackLbp: s.owedBackLbp, changeGiven: [s.changeUsd ? `$${s.changeUsd.toFixed(2)}` : "", s.changeLbp ? `${s.changeLbp.toLocaleString("en")} LBP` : ""].filter(Boolean).join(" + ") || "none", changeAdjustmentLbp: s.changeAdjustmentLbp }))
  console.log("   recorded:", JSON.stringify({ adjustmentLbp: s.adjustmentLbp, keptValueMinusTotal: s.keptValueLbp - Math.round(total * rate), kept: { usd: s.keptUsd, lbp: s.keptLbp } }))
  console.log("   drawer:", s.movements.map(fmt).join(", "))
  if (t.changeIn === "LBP" && t.paidUsd < total) console.log("   naive (change from unrounded remainder, both roundings booked):", JSON.stringify(naiveDoubleRounding(total, rate, t, rec)))
}

console.log("\n── 4. Refunds keep the original tender breakdown ──")
const show = (label: string, s: Settled, amounts: number[], p = rec) => {
  const r = refundSequence(s, total, rate, p, amounts)
  console.log(label, JSON.stringify({ sale: s.movements.map(fmt).join(", "), refundable: r.breakdown, paidBack: r.paidBack, withinBreakdown: r.withinBreakdown }))
  for (const row of r.rows) console.log("   ", JSON.stringify(row))
}
show("A. LBP sale, full refund", sale({ paidUsd: 0, paidLbp: 600_000, changeIn: "LBP" }), [6.72])
show("B. USD sale, full refund (stays USD)", sale({ paidUsd: 6.72, paidLbp: 0, changeIn: "USD" }), [6.72])
show("C. LBP sale, $1.50 then the rest", sale({ paidUsd: 0, paidLbp: 600_000, changeIn: "LBP" }), [1.5, 5.22])
show("D. sale rounded up (605,000 kept), four partials of $1.68", sale({ paidUsd: 0, paidLbp: 605_000, changeIn: "LBP" }, P("up", "nearest")), [1.68, 1.68, 1.68, 1.68], P("up", "nearest"))
show("E. mixed $5 + 155,000 kept, half then half", sale({ paidUsd: 5, paidLbp: 200_000, changeIn: "LBP" }), [3.36, 3.36])
show("F. mixed $5 + 155,000 kept, three partials", sale({ paidUsd: 5, paidLbp: 200_000, changeIn: "LBP" }), [1.0, 2.5, 3.22])
// G. Cross-currency change: $10 received, 295,000 LBP handed back. TWO physical movements
// (+$10.00, −295,000 LBP). A refund either reverses both, or converts the net into one
// currency, which is an explicit exchange at the sale's rate with its own cent/note rounding.
{
  const g = sale({ paidUsd: 10, paidLbp: 0, changeIn: "LBP" })
  const netValue = g.keptValueLbp                         // 895,000 − 295,000 = 600,000 LBP of value
  const exactUsd = netValue / rate                        // 6.7039106… — not a whole number of cents
  const usdCents = Math.floor(exactUsd * 100 + 1e-9)      // cent rounding (down: never above the value kept)
  const usdResidualLbp = netValue - Math.round((usdCents / 100) * rate)
  const lbpNotes = roundTo(netValue, rec.change.denomLbp, "down")
  console.log("G. $10 received, 295,000 LBP returned:", g.movements.map(fmt).join(", "), "| net value", netValue.toLocaleString("en"), "LBP at", rate)
  console.log("   option 1, reverse both movements:", JSON.stringify({ drawer: "−$10.00, +295,000 LBP (customer hands back the LBP change)", conversion: "none", residualLbp: 0 }))
  console.log("   option 2, convert the net to USD:", JSON.stringify({ exactUsd: exactUsd.toFixed(7), paid: `$${(usdCents / 100).toFixed(2)}`, centRounding: "down", residualLbp: usdResidualLbp, residualUsd: (usdResidualLbp / rate).toFixed(5), drawer: `−$${(usdCents / 100).toFixed(2)}` }))
  console.log("   option 3, convert the net to LBP:", JSON.stringify({ paid: `${lbpNotes.toLocaleString("en")} LBP`, noteRounding: "down to 5,000", residualLbp: netValue - lbpNotes, drawer: `−${lbpNotes.toLocaleString("en")} LBP` }))
  // Partial refund of half ($3.36), then the rest, converting to USD: cumulative on the net value, last exact to the cent.
  let paidValue = 0
  for (const [i, share] of [[1, 0.5], [2, 1]] as const) {
    const target = Math.round(netValue * share)
    const cents = Math.floor((target - paidValue) / rate * 100 + 1e-9)
    paidValue += Math.round((cents / 100) * rate)
    console.log(`   option 2, refund ${i} of 2:`, JSON.stringify({ targetValueLbp: target, paid: `$${(cents / 100).toFixed(2)}`, paidValueSoFar: paidValue, residualLbp: target - paidValue }))
  }
}
console.log("naive per-refund round-up for D:", [1.68, 1.68, 1.68, 1.68].reduce((s, a) => s + ceilLbp(Math.round(a * rate), 5000), 0).toLocaleString("en"), "LBP back for 605,000 received")

console.log("\n── 5. Drawer per currency (one shift; float $100 + 0 LBP) ──")
// Sales: exact LBP; $10 change USD; $5 + 200,000 change LBP. Then refund C's first payout ($1.50 of the LBP sale).
const shiftSales = [sale({ paidUsd: 0, paidLbp: 600_000, changeIn: "LBP" }), sale({ paidUsd: 10, paidLbp: 0, changeIn: "USD" }), sale({ paidUsd: 5, paidLbp: 200_000, changeIn: "LBP" })]
const firstRefund = refundSequence(shiftSales[0], total, rate, rec, [1.5])
const expectedUsd = (cents(100) + shiftSales.reduce((s, x) => s + cents(x.keptUsd), 0) - cents(firstRefund.paidBack.usd)) / 100
const expectedLbp = shiftSales.reduce((s, x) => s + x.keptLbp, 0) - firstRefund.paidBack.lbp
console.log(JSON.stringify({ expectedUsd, expectedLbp, saleAdjustmentsLbp: shiftSales.reduce((s, x) => s + x.adjustmentLbp, 0), refundAdjustmentLbp: firstRefund.rows[0].refundAdjustmentLbp }))
for (const closingRate of [89_500, 90_000]) console.log(JSON.stringify({ reportingOnly: `USD-equivalent at ${closingRate}`, value: Math.round((expectedUsd + expectedLbp / closingRate) * 100) / 100 }))

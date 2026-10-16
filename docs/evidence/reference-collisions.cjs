// Evidence for the document-reference release blocker.
//
// Reproduces each client generator EXACTLY as it is in apps/desktop (commit
// 508ddfe), with Date.now / Math.random injected, and measures how often a
// tenant ends up with two records sharing a reference. The server holds
// @@unique([tenantId, <reference>]) for each, so a shared reference makes the
// later record's sync push fail (status "error", retried until dead).
//
//   node docs/evidence/reference-collisions.cjs [trials]
//
// Generators (copied, not paraphrased):
//   sale     POSPage.tsx:621          `S-${Date.now().toString().slice(-6)}${Math.floor(Math.random() * 90 + 10)}`
//   expense  expense.service.ts:110   `EXP-${Date.now().toString().slice(-6)}`
//   PO       supplier.service.ts:425  `PO-${Date.now().toString().slice(-6)}`
//   shift    security.service.ts:961  `SHIFT-${String(shifts.length + 1).padStart(3, "0")}`  (shifts = this device's local list)
//
// Timing model (stated, so it can be challenged): one store, 2 registers,
// open 08:00–22:00, events spread uniformly at random over opening hours, ms
// resolution. `.slice(-6)` keeps the last 6 digits of the ms clock, so the
// value cycles every 1,000,000 ms (16 min 40 s) regardless of the date.
const trials = Number(process.argv[2] ?? 2000)

let seed = 0x9e3779b9
const rand = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32 }

const generators = {
  sale: (now, random) => `S-${now.toString().slice(-6)}${Math.floor(random() * 90 + 10)}`,
  expense: (now) => `EXP-${now.toString().slice(-6)}`,
  po: (now) => `PO-${now.toString().slice(-6)}`,
}

const DAY0 = Date.UTC(2026, 0, 1, 6, 0, 0) // 08:00 Beirut
const OPEN_MS = 14 * 3600 * 1000
function timestamps(count, days) {
  const out = []
  for (let i = 0; i < count; i++) out.push(DAY0 + Math.floor(rand() * days) * 86400000 + Math.floor(rand() * OPEN_MS))
  return out
}
function probabilityOfAnyCollision(kind, count, days) {
  let hit = 0
  for (let t = 0; t < trials; t++) {
    const seen = new Set()
    for (const now of timestamps(count, days)) {
      const ref = generators[kind](now, rand)
      if (seen.has(ref)) { hit++; break }
      seen.add(ref)
    }
  }
  return hit / trials
}
// Closed form for comparison: values are uniform over M (1e6 ms phases × 90 randoms for sales).
const birthday = (n, m) => 1 - Math.exp(-(n * (n - 1)) / (2 * m))

const rows = []
for (const [kind, m, scenarios] of [
  ["sale", 1e6 * 90, [[1000, 10], [5000, 30], [10000, 60], [20000, 120], [50000, 300]]],
  ["expense", 1e6, [[100, 30], [500, 180], [1000, 365], [2000, 730]]],
  ["po", 1e6, [[100, 30], [500, 180], [1000, 365]]],
]) {
  for (const [n, days] of scenarios) {
    rows.push({ kind, records: n, overDays: days, simulated: probabilityOfAnyCollision(kind, n, days), closedForm: birthday(n, m) })
  }
}

// Shift: deterministic, not probabilistic. Two registers each number from
// their OWN local list; until a register has pulled the other's shifts, both
// produce the same next number.
function shiftScenario() {
  const reg1 = [], reg2 = []
  const open = (list) => { const n = `SHIFT-${String(list.length + 1).padStart(3, "0")}`; list.push(n); return n }
  // Day 1 morning: both registers open before either has synced.
  const a = open(reg1), b = open(reg2)
  return { register1: a, register2: b, collides: a === b }
}

console.log(`trials per scenario: ${trials}`)
for (const r of rows) console.log(`${r.kind.padEnd(8)} ${String(r.records).padStart(6)} records over ${String(r.overDays).padStart(4)} days: simulated P(≥1 duplicate) = ${(r.simulated * 100).toFixed(1).padStart(5)}%   closed form = ${(r.closedForm * 100).toFixed(1).padStart(5)}%`)
console.log("shift   ", JSON.stringify(shiftScenario()))
module.exports = { rows, shift: shiftScenario() }

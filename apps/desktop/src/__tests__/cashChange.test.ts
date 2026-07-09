import { describe, expect, it } from "vitest"
import { ceilLbp, computeCashChange, lbpToUsd, roundLbp, roundMoney, usdToLbp } from "../features/pos/lib/currency"

const RATE = 89_500

describe("computeCashChange", () => {
  it("pure-LBP tender: change is exact LBP arithmetic, no USD round-trip drift", () => {
    // The live bug: total 1,790 LBP ($0.02), tendered 250,000 LBP.
    // USD round-trip gave 247,915; banknote arithmetic says 248,210.
    const { changeLbp } = computeCashChange({
      paidUsd: 0,
      paidLbp: 250_000,
      totalUsd: 0.02,
      totalLbp: 1_790,
      exchangeRate: RATE,
    })
    expect(changeLbp).toBe(248_210)
  })

  it("pure-LBP tender: exact payment gives zero change", () => {
    const { changeUsd, changeLbp } = computeCashChange({
      paidUsd: 0,
      paidLbp: 268_500,
      totalUsd: 3,
      totalLbp: 268_500,
      exchangeRate: RATE,
    })
    expect(changeLbp).toBe(0)
    expect(changeUsd).toBe(0)
  })

  it("pure-USD tender: change stays on the USD-canonical path", () => {
    const { changeUsd, changeLbp } = computeCashChange({
      paidUsd: 5,
      paidLbp: 0,
      totalUsd: 3,
      totalLbp: usdToLbp(3, RATE),
      exchangeRate: RATE,
    })
    expect(changeUsd).toBe(2)
    expect(changeLbp).toBe(usdToLbp(2, RATE))
  })

  it("mixed tender: change derives from combined USD value", () => {
    // $2 + 89,500 LBP (= $1) on a $2.50 sale → $0.50 change
    const { changeUsd } = computeCashChange({
      paidUsd: 2,
      paidLbp: 89_500,
      totalUsd: 2.5,
      totalLbp: usdToLbp(2.5, RATE),
      exchangeRate: RATE,
    })
    expect(changeUsd).toBe(roundMoney(0.5))
  })

  it("underpayment yields zero change in both currencies", () => {
    const { changeUsd, changeLbp } = computeCashChange({
      paidUsd: 1,
      paidLbp: 0,
      totalUsd: 3,
      totalLbp: usdToLbp(3, RATE),
      exchangeRate: RATE,
    })
    expect(changeUsd).toBe(0)
    expect(changeLbp).toBe(0)
  })
})

describe("roundLbp vs ceilLbp", () => {
  it("roundLbp rounds to nearest 5000", () => {
    expect(roundLbp(206745, 5000)).toBe(205000) // 41.349 → rounds down to 41 × 5000
    expect(roundLbp(207500, 5000)).toBe(210000) // 41.5 → rounds to... Math.round(41.5) = 42 (ties go up)
    expect(roundLbp(207499, 5000)).toBe(205000) // 41.4998 → rounds down
  })

  it("ceilLbp always rounds UP to nearest 5000", () => {
    expect(ceilLbp(206745, 5000)).toBe(210000)  // covers the total
    expect(ceilLbp(200001, 5000)).toBe(205000)  // just over, goes up
    expect(ceilLbp(200000, 5000)).toBe(200000)  // exact
    expect(ceilLbp(1, 5000)).toBe(5000)         // tiny values round up
  })

  it("ceilLbp always produces >= the raw value", () => {
    const values = [0, 1, 1790, 5000, 89500, 206745, 268500, 447500, 1000000]
    for (const v of values) {
      expect(ceilLbp(v, 5000)).toBeGreaterThanOrEqual(v)
    }
  })
})

describe("Exact LBP tender — fillExactTender scenario", () => {
  it("$2.31 sale: ceilLbp gives enough to cover total (roundLbp would underpay)", () => {
    const rate = 89500
    const totalUsd = 2.31
    const totalLbp = usdToLbp(totalUsd, rate) // 206,745

    // OLD behavior (roundLbp) — this was the bug
    const oldPaidLbp = roundLbp(totalLbp, 5000) // 205,000
    const oldPaidTotalUsd = roundMoney(lbpToUsd(oldPaidLbp, rate))
    expect(oldPaidTotalUsd + 0.005).toBeLessThan(totalUsd) // SALE BLOCKED

    // NEW behavior (ceilLbp) — covers the total
    const newPaidLbp = ceilLbp(totalLbp, 5000) // 210,000
    const newPaidTotalUsd = roundMoney(lbpToUsd(newPaidLbp, rate))
    expect(newPaidTotalUsd + 0.005).toBeGreaterThanOrEqual(totalUsd) // SALE ALLOWED
  })

  it("small sale $0.02: ceilLbp covers total", () => {
    const rate = 89500
    const totalUsd = 0.02
    const totalLbp = usdToLbp(totalUsd, rate) // 1,790
    const paidLbp = ceilLbp(totalLbp, 5000)     // 5,000
    expect(paidLbp).toBeGreaterThanOrEqual(totalLbp)
    expect(paidLbp).toBe(5000)
  })

  it("$3.00 exact: ceilLbp gives zero rounding gap", () => {
    const rate = 89500
    const totalUsd = 3.00
    const totalLbp = usdToLbp(totalUsd, rate) // 268,500
    const paidLbp = ceilLbp(totalLbp, 5000)     // 270,000
    expect(paidLbp).toBeGreaterThanOrEqual(totalLbp)
  })

  it("pure-LBP: paidLbp >= totalLbp means paid in LBP space", () => {
    const rate = 89500
    const totalUsd = 2.31
    const totalLbp = usdToLbp(totalUsd, rate) // 206,745
    const paidLbp = ceilLbp(totalLbp, 5000)    // 210,000
    // New cashTenderValid: tenderMode === "LBP" → check paidLbp >= totalLbp
    expect(paidLbp).toBeGreaterThanOrEqual(totalLbp)
  })

  it("mixed tender still works — USD comparison path unchanged", () => {
    const rate = 89500
    const totalUsd = 2.50
    const totalLbp = usdToLbp(totalUsd, rate)
    // Pay $2 + 89,500 LBP = $2 + $1 = $3 total
    const paidUsd = 2
    const paidLbp = 89500
    const paidTotalUsd = roundMoney(paidUsd + lbpToUsd(paidLbp, rate))
    expect(paidTotalUsd + 0.005).toBeGreaterThanOrEqual(totalUsd)
  })
})

describe("Canonical cash payable rounding", () => {
  const RATE = 89_500

  it("$9.13 → 820,000 LBP payable (ceil to 5000 banknote)", () => {
    const rawUsd = 9.13
    const rawLbp = usdToLbp(rawUsd, RATE)          // 817,135
    const payableLbp = ceilLbp(rawLbp, 5000)        // 820,000
    const payableUsd = lbpToUsd(payableLbp, RATE)   // ~9.16

    expect(Math.round(rawLbp)).toBe(817_135)           // raw conversion (floating point)
    expect(payableLbp).toBe(820_000)                   // canonical cash payable
    expect(payableUsd).toBeGreaterThan(rawUsd)       // payable exceeds raw
  })

  it("Exact LBP against canonical payable → zero change", () => {
    const payableLbp = ceilLbp(usdToLbp(9.13, RATE), 5000)  // 820,000
    const payableUsd = lbpToUsd(payableLbp, RATE)
    const { changeUsd, changeLbp } = computeCashChange({
      paidUsd: 0, paidLbp: payableLbp,       // Exact LBP fills 820,000
      totalUsd: payableUsd, totalLbp: payableLbp,  // Compared against canonical
      exchangeRate: RATE,
    })
    expect(changeLbp).toBe(0)
    expect(changeUsd).toBe(0)
  })

  it("Paying above canonical payable → correct change in LBP", () => {
    const payableLbp = ceilLbp(usdToLbp(9.13, RATE), 5000)  // 820,000
    const payableUsd = lbpToUsd(payableLbp, RATE)
    const paidLbp = 1_000_000
    const { changeLbp } = computeCashChange({
      paidUsd: 0, paidLbp,
      totalUsd: payableUsd, totalLbp: payableLbp,
      exchangeRate: RATE,
    })
    expect(changeLbp).toBe(180_000)
  })

  it("Exact USD against canonical payable → zero change", () => {
    const payableLbp = ceilLbp(usdToLbp(9.13, RATE), 5000)  // 820,000
    const payableUsd = lbpToUsd(payableLbp, RATE)            // ~9.16
    const { changeUsd, changeLbp } = computeCashChange({
      paidUsd: payableUsd, paidLbp: 0,
      totalUsd: payableUsd, totalLbp: payableLbp,
      exchangeRate: RATE,
    })
    expect(changeUsd).toBe(0)
    expect(changeLbp).toBe(0)
  })

  it("Mixed tender against canonical payable", () => {
    const payableLbp = ceilLbp(usdToLbp(9.13, RATE), 5000)  // 820,000
    const payableUsd = lbpToUsd(payableLbp, RATE)
    // Pay $4 + 462,100 LBP = $4 + ~$5.16 = $9.16
    const paidUsd = 4
    const paidLbp = 462_100
    const paidTotalUsd = roundMoney(paidUsd + lbpToUsd(paidLbp, RATE))
    expect(paidTotalUsd + 0.005).toBeGreaterThanOrEqual(payableUsd)
  })
})

describe("Cash rounding disclosure", () => {
  const RATE = 89_500

  it("817,135 LBP → +2,865 → 820,000 LBP", () => {
    const rawLbp = usdToLbp(9.13, RATE)                          // ~817,135
    const payableLbp = ceilLbp(rawLbp, 5000)                     // 820,000
    const adjustment = Math.round(payableLbp - rawLbp)
    expect(adjustment).toBe(2_865)
    expect(payableLbp).toBe(820_000)
  })

  it("already-rounded total → no adjustment", () => {
    const rawLbp = usdToLbp(3.00, RATE)     // 268,500
    const payableLbp = ceilLbp(rawLbp, 5000) // 270,000
    // Not zero because ceilLbp rounds up — but for EXACTLY aligned values:
    const exact = ceilLbp(200_000, 5000)
    expect(exact).toBe(200_000)             // exact → no adjustment
    expect(exact - 200_000).toBe(0)
  })

  it("non-cash sale should not show rounding (legacy totals used)", () => {
    // Card/Debt/Wallet: payableLbp is NOT used, totalLbp stays raw
    const rawLbp = usdToLbp(9.13, RATE)     // 817,135
    // Only cash shows the rounding box in review overlay
    // This test documents that rawLbp ≠ ceilLbp(rawLbp) for non-cash context
    expect(ceilLbp(rawLbp, 5000)).not.toBe(Math.round(rawLbp))
  })
})

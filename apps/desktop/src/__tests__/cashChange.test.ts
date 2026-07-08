import { describe, expect, it } from "vitest"
import { computeCashChange, roundMoney, usdToLbp } from "../features/pos/lib/currency"

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

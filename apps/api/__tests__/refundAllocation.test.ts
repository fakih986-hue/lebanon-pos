import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import {
  buildRefundableLines, planRefund, planVoidRestoration, assertRefundAmount, resolveRefundRate,
  RefundRuleError, type PriorRefundLine,
} from "../src/lib/refundAllocation"

// REFUND-INTEGRITY-1 — the same vectors run in apps/api and apps/desktop, so
// the server and the till apply identical refund/void allocation rules.
const repoRoot = resolve(__dirname, "../../..")
const vectors = JSON.parse(readFileSync(resolve(repoRoot, "packages/shared/test-vectors/refund-allocation.json"), "utf8"))

function codeOf(fn: () => unknown): string | null {
  try { fn(); return null } catch (err) { return err instanceof RefundRuleError ? err.code : String(err) }
}

describe("refund allocation shared vectors", () => {
  it("api and desktop copies of refundAllocation.ts are byte-identical", () => {
    const api = readFileSync(resolve(repoRoot, "apps/api/src/lib/refundAllocation.ts"), "utf8")
    const desktop = readFileSync(resolve(repoRoot, "apps/desktop/src/features/pos/lib/refundAllocation.ts"), "utf8")
    expect(desktop).toBe(api)
  })

  for (const seq of vectors.sequences) {
    it(seq.name, () => {
      const lines = buildRefundableLines(seq.items)
      const prior: PriorRefundLine[] = []
      for (const step of seq.steps) {
        if (step.error) {
          expect(codeOf(() => planRefund(lines, prior, step.request))).toBe(step.error)
          continue
        }
        const planned = planRefund(lines, prior, step.request)
        expect(planned).toEqual(step.expect)
        for (const p of planned) prior.push({ key: p.key, quantity: p.quantity, allocations: p.allocations })
      }
    })
  }

  for (const v of vectors.voids) {
    it(v.name, () => {
      const lines = buildRefundableLines(v.items)
      if (v.error) expect(codeOf(() => planVoidRestoration(lines, v.prior))).toBe(v.error)
      else expect(planVoidRestoration(lines, v.prior)).toEqual(v.expect)
    })
  }

  for (const a of vectors.amounts) {
    it(`amount: ${a.name}`, () => {
      expect(codeOf(() => assertRefundAmount(a.saleTotal, a.prior, a.amount))).toBe(a.ok ? null : a.error)
    })
  }

  for (const r of vectors.rates) {
    it(`rate: ${r.name}`, () => {
      expect(resolveRefundRate(r.input)).toEqual(r.expect)
    })
  }
})

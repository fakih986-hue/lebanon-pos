import { describe, it, expect, vi } from "vitest"
import { isTechnicalError, publicError } from "../src/lib/publicError.js"

// SPRINT-2 hub batch: registers and reviewers never see a raw database error; they get an actionable sentence
// and a support reference, and the technical detail is logged under that reference.
describe("public errors", () => {
  it("a database error becomes an actionable message with a support reference; the detail goes to the log only", () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined)
    const raw = Object.assign(new Error("\nInvalid `prisma.sale.create()` invocation:\nArgument `saleNumber` is missing."), { name: "PrismaClientValidationError" })
    const r = publicError(raw, "sync push sale create op-1")
    expect(r.reference).toMatch(/^ERR-[0-9A-F]{8}$/)
    expect(r.message).toContain(`Support reference: ${r.reference}.`)
    expect(r.message).toMatch(/missing information.*Nothing was applied/)
    expect(r.message).not.toMatch(/prisma|saleNumber|invocation/i)
    expect(log).toHaveBeenCalledWith(`[support ${r.reference}] sync push sale create op-1:`, raw)
    expect(publicError(new Error('insert or update on table "Sale" violates foreign key constraint "Sale_shiftId_fkey"'), "x").message).toMatch(/refers to something this server does not have yet/)
    expect(publicError(new Error("duplicate key value violates unique constraint"), "x").message).toMatch(/same identity already exists/)
    log.mockRestore()
  })

  it("a business refusal is already written for people and passes through unchanged, without a reference", () => {
    const r = publicError(new Error("Rana does not have permission to give a discount (sales.discount)."), "x")
    expect(r).toEqual({ message: "Rana does not have permission to give a discount (sales.discount).", reference: null })
    expect(isTechnicalError(new Error("IDENTITY_REQUIRED: this store requires the person to sign in."))).toBe(false)
    expect(isTechnicalError({ message: "Cannot read properties of undefined (reading 'id')" })).toBe(true)
  })
})

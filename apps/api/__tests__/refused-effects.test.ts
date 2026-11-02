import { describe, it, expect, afterAll } from "vitest"
import { randomUUID } from "node:crypto"

// Release batch — what a manager sees before deciding about held work: a remake or waste says what it takes from
// stock (drink, options, quantity, note), and a stock count says how many products it counts (registers send `lines`).
const prisma = (await import("../src/lib/prisma.js")).default
const { describeEffects } = await import("../src/lib/refusedReview.js")
const T = randomUUID()

afterAll(async () => { await prisma.$disconnect() })

describe("held work effects", () => {
  it("a remake: the drink, its options, how many and the note", async () => {
    const fx = await describeEffects(T, "inventory", "waste", { id: "w1", productName: "Cappuccino", quantity: 2, reason: "Remake", modifiers: [{ name: "Large" }, { name: "Oat milk" }], note: "too hot" })
    expect(fx).toEqual([{ kind: "waste", product: "Cappuccino", quantity: 2, reason: "Remake", options: "Large, Oat milk", note: "too hot" }])
  })
  it("a waste of a stock item", async () => {
    const fx = await describeEffects(T, "inventory", "waste", { id: "w2", productName: "Oat milk", quantity: 250, reason: "Waste" })
    expect(fx).toEqual([{ kind: "waste", product: "Oat milk", quantity: 250, reason: "Waste", options: "", note: null }])
  })
  it("a stock count: the number of lines a register sends", async () => {
    expect(await describeEffects(T, "inventory", "count", { id: "c1", lines: [{ productId: 1 }, { productId: 2 }, { productId: 3 }] })).toEqual([{ kind: "stock-count", lines: 3 }])
  })
})

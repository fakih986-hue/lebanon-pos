import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import {
  checkGroup, checkRecipe, checkSelection, defaultSelection, lineConfigKey, planReceive, priceWithModifiers, purchaseConversion,
  recipeConsumption, sameConsumption, servingsAvailable, snapshotModifiers, toMilli, toTT, type ModifierGroup, type RecipeDef,
} from "../src/lib/cafeMenu"

// Café batch: the shared menu, unit and recipe rules (lib/cafeMenu.ts, byte-identical on the register).
const repoRoot = resolve(__dirname, "../../..")
const SIZE: ModifierGroup = { id: "size", name: "Size", required: true, minSelect: 1, maxSelect: 1, options: [
  { id: "s", name: "Small", priceDelta: -0.25, sortOrder: 1 }, { id: "m", name: "Medium", priceDelta: 0, isDefault: true, sortOrder: 2 }, { id: "l", name: "Large", priceDelta: "0.75", sortOrder: 3 },
  { id: "xl", name: "XL", priceDelta: 1, archived: true }, { id: "kid", name: "Kids", priceDelta: -1, available: false }] }
const MILK: ModifierGroup = { id: "milk", name: "Milk", required: true, maxSelect: 1, options: [{ id: "whole", name: "Whole", priceDelta: 0, isDefault: true }, { id: "oat", name: "Oat", priceDelta: 0.5 }] }
const EXTRA: ModifierGroup = { id: "extra", name: "Extra", maxSelect: 2, options: [{ id: "shot", name: "Extra shot", priceDelta: 0.75 }, { id: "syrup", name: "Vanilla", priceDelta: 0.5 }, { id: "cream", name: "Cream", priceDelta: 0.5 }] }
const CAPP: RecipeDef = { id: "r1", yield: 1, lines: [
  { ingredientSyncId: "beans", quantity: 18 },
  { ingredientSyncId: "milk", quantity: 150, when: ["s"], unless: ["oat"] }, { ingredientSyncId: "oat", quantity: 150, when: ["s", "oat"] },
  { ingredientSyncId: "milk", quantity: 200, when: ["m"], unless: ["oat"] }, { ingredientSyncId: "oat", quantity: 200, when: ["m", "oat"] },
  { ingredientSyncId: "beans", quantity: "18", when: ["shot"] }, { ingredientSyncId: "cups", quantity: 1 }] }

describe("café rules (shared with the register)", () => {
  it("api and desktop copies of cafeMenu.ts are byte-identical", () => {
    const api = readFileSync(resolve(repoRoot, "apps/api/src/lib/cafeMenu.ts"), "utf8")
    const desktop = readFileSync(resolve(repoRoot, "apps/desktop/src/features/pos/lib/cafeMenu.ts"), "utf8")
    expect(desktop).toBe(api)
  })

  it("decimals are exact and never silently rounded: 3 decimals for quantities, 4 for money", () => {
    expect([toMilli("18"), toMilli(0.1 + 0.2), toMilli("12.5"), toMilli("0.001"), toMilli("-2.5")]).toEqual([18000, 300, 12500, 1, -2500])
    expect([toMilli("18.0005"), toMilli("1e3"), toMilli("abc"), toMilli(Number.NaN)]).toEqual([null, null, null, null])
    expect([toTT("18.37"), toTT(0.0184), toTT("1.23456")]).toEqual([183700, 184, null])
  })

  it("purchase units convert within one dimension only; a receive derives stock and valuation exactly", () => {
    expect(purchaseConversion("g", "kg")).toEqual({ ok: true, unitsPerPurchase: 1000 })
    expect(purchaseConversion("ml", "L")).toEqual({ ok: true, unitsPerPurchase: 1000 })
    expect(purchaseConversion("unit", "pack", 50)).toEqual({ ok: true, unitsPerPurchase: 50 })
    expect(purchaseConversion("ml", "kg")).toEqual({ ok: false, reason: "incompatible" })
    expect(purchaseConversion("g", "L")).toEqual({ ok: false, reason: "incompatible" })
    expect(purchaseConversion("unit", "pack", 2.5)).toEqual({ ok: false, reason: "pack-size" })
    // 2 kg at 18.37/kg → 2000 g at 0.0184/g (half-up), the invoice price kept by the caller
    expect(planReceive({ stockUnit: "g", purchaseUnit: "kg", purchaseQuantity: 2, purchasePrice: 18.37 })).toEqual({ ok: true, stockMilli: 2_000_000, unitCostTT: 184 })
    expect(planReceive({ stockUnit: "unit", purchaseUnit: "pack", packSize: 50, purchaseQuantity: "3", purchasePrice: "4" })).toEqual({ ok: true, stockMilli: 150_000, unitCostTT: 800 })
    expect(planReceive({ stockUnit: "ml", purchaseUnit: "L", purchaseQuantity: 1.2345, purchasePrice: 1 })).toEqual({ ok: false, reason: "quantity" })
    expect(planReceive({ stockUnit: "g", purchaseUnit: "kg", purchaseQuantity: 1, purchasePrice: -1 })).toEqual({ ok: false, reason: "price" })
  })

  it("groups: definitions are checked; selections need required choices, respect min/max, refuse archived/unavailable/foreign options", () => {
    expect(checkGroup(SIZE)).toEqual([])
    expect(checkGroup({ id: "x", name: "", options: [] })).toEqual(expect.arrayContaining(["name", "no-options"]))
    expect(checkGroup({ id: "x", name: "X", required: true, minSelect: 3, maxSelect: 3, options: [{ id: "a", name: "A", priceDelta: 0 }] })).toContain("min-max")
    expect(checkGroup({ id: "x", name: "X", maxSelect: 1, options: [{ id: "a", name: "A", priceDelta: 0, isDefault: true }, { id: "b", name: "B", priceDelta: 0, isDefault: true }] })).toContain("defaults")
    expect(checkGroup({ id: "x", name: "X", options: [{ id: "a", name: "A", priceDelta: "0.12345" }] })).toContain("price")
    const groups = [SIZE, MILK, EXTRA]
    expect(defaultSelection(groups)).toEqual([{ groupId: "size", optionId: "m" }, { groupId: "milk", optionId: "whole" }])
    expect(checkSelection(groups, defaultSelection(groups))).toEqual([])
    expect(checkSelection(groups, [{ groupId: "milk", optionId: "oat" }])).toEqual([{ groupId: "size", code: "required" }])
    expect(checkSelection(groups, [...defaultSelection(groups), { groupId: "extra", optionId: "shot" }, { groupId: "extra", optionId: "syrup" }, { groupId: "extra", optionId: "cream" }])).toEqual([{ groupId: "extra", code: "too-many" }])
    expect(checkSelection(groups, [{ groupId: "size", optionId: "xl" }, { groupId: "milk", optionId: "whole" }]).map((p) => p.code)).toEqual(["unavailable", "required"])
    expect(checkSelection(groups, [{ groupId: "size", optionId: "kid" }, { groupId: "milk", optionId: "whole" }]).map((p) => p.code)).toEqual(["unavailable", "required"])
    expect(checkSelection([MILK], [{ groupId: "size", optionId: "m" }, { groupId: "milk", optionId: "whole" }]).map((p) => p.code)).toEqual(["not-offered"])
    // a repeated option counts once; an archived group asks nothing
    expect(checkSelection([{ ...SIZE }, { ...MILK, archived: true }], [{ groupId: "size", optionId: "m" }, { groupId: "size", optionId: "m" }])).toEqual([])
  })

  it("the snapshot follows the menu's order; price = base + deltas exactly; lines merge only for the same configuration", () => {
    const sel = [{ groupId: "extra", optionId: "shot" }, { groupId: "milk", optionId: "oat" }, { groupId: "size", optionId: "l" }]
    const snap = snapshotModifiers([SIZE, MILK, EXTRA], sel)
    expect(snap.map((m) => m.optionId)).toEqual(["l", "oat", "shot"])
    expect(priceWithModifiers("3", snap)).toBe(5)
    expect(priceWithModifiers(2.1, [{ priceDelta: 0.2 }])).toBe(2.3) // not 2.3000000000000003
    expect(priceWithModifiers(3, snapshotModifiers([SIZE], [{ groupId: "size", optionId: "s" }]))).toBe(2.75)
    const a = lineConfigKey(7, snap, " extra hot ", 5), b = lineConfigKey(7, [...snap].reverse(), "extra hot", 5)
    expect(a).toBe(b)
    expect(lineConfigKey(7, snap, "", 5)).not.toBe(a)
    expect(lineConfigKey(7, snap, "extra hot", 4.5)).not.toBe(a)
  })

  it("recipes: conditions pick lines (size, substitution, extras); consumption rounds once per ingredient; yield divides", () => {
    expect(recipeConsumption(CAPP, ["m", "whole"], 1)).toEqual([{ ingredientSyncId: "beans", milli: 18000 }, { ingredientSyncId: "milk", milli: 200000 }, { ingredientSyncId: "cups", milli: 1000 }])
    expect(recipeConsumption(CAPP, ["m", "oat", "shot"], 2)).toEqual([{ ingredientSyncId: "beans", milli: 72000 }, { ingredientSyncId: "oat", milli: 400000 }, { ingredientSyncId: "cups", milli: 2000 }])
    // yield 3: 10 g per 3 servings, one serving = 3.333 g (rounded once, half-up); two servings = 6.667 g
    const batch: RecipeDef = { id: "b", yield: 3, lines: [{ ingredientSyncId: "syrup", quantity: 10 }] }
    expect(recipeConsumption(batch, [], 1)).toEqual([{ ingredientSyncId: "syrup", milli: 3333 }])
    expect(recipeConsumption(batch, [], 2)).toEqual([{ ingredientSyncId: "syrup", milli: 6667 }])
    expect(recipeConsumption(batch, [], 0)).toBeNull()
    // ingredient quantities summed per serving before rounding: never drift with many lines
    const many: RecipeDef = { id: "m", yield: 7, lines: Array.from({ length: 7 }, () => ({ ingredientSyncId: "x", quantity: "0.1" })) }
    expect(recipeConsumption(many, [], 1)).toEqual([{ ingredientSyncId: "x", milli: 100 }])
    expect(sameConsumption([{ ingredientSyncId: "a", milli: 1 }, { ingredientSyncId: "b", milli: 2 }], [{ ingredientSyncId: "b", milli: 2 }, { ingredientSyncId: "a", milli: 1 }])).toBe(true)
  })

  it("availability comes from the ingredients in stock (no fake drink stock); recipe checks refuse bad lines", () => {
    const stock: Record<string, number> = { beans: 40_000, milk: 1_000_000, oat: 150_000, cups: 100_000 }
    const have = (sid: string) => stock[sid] ?? 0
    expect(servingsAvailable(CAPP, have, ["m", "whole"])).toBe(2) // 40 g beans / 18 g
    expect(servingsAvailable(CAPP, have, ["m", "oat"])).toBe(0) // 150 ml oat < 200 ml
    expect(servingsAvailable({ id: "e", lines: [] }, have)).toBe(Number.POSITIVE_INFINITY)
    const isIngredient = (sid: string) => sid in stock
    expect(checkRecipe(CAPP, isIngredient, "capp")).toEqual([])
    expect(checkRecipe({ id: "x", yield: 0, lines: [{ ingredientSyncId: "capp", quantity: 1 }, { ingredientSyncId: "beans", quantity: "1.0001" }, { ingredientSyncId: "nope", quantity: 1 }] }, isIngredient, "capp").map((p) => `${p.line}:${p.code}`))
      .toEqual(["-1:yield", "0:self", "1:precision", "2:ingredient"])
  })
})

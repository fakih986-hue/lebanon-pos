/**
 * Café batch — shared menu, modifier, unit and recipe rules.
 *
 * THIS FILE IS DUPLICATED BYTE-FOR-BYTE in:
 *   apps/api/src/lib/cafeMenu.ts
 *   apps/desktop/src/features/pos/lib/cafeMenu.ts
 * Both apps' test suites assert the two files are identical. Edit both.
 *
 * Design: docs/CAFE-IMPLEMENTATION-PLAN.md ("Café menu, modifiers, recipes and ingredient stock").
 * - Quantities are exact to 0.001 of the stock unit: computed in integer thousandths ("milli"), rounded
 *   half-up once per ingredient. A value with more than 3 decimals is refused, never silently rounded.
 * - Money is exact to 0.0001: computed in integer ten-thousandths ("tt").
 * - Nothing here reads a clock, storage or the network: the register and the server compute the same.
 */

export type StockUnit = "unit" | "g" | "ml"
export type PurchaseUnit = "unit" | "pack" | "g" | "kg" | "ml" | "L"
export const STOCK_UNITS: StockUnit[] = ["unit", "g", "ml"]
/** The purchase units each stock unit can be bought in (same dimension only). */
export const PURCHASE_UNITS: Record<StockUnit, PurchaseUnit[]> = { unit: ["unit", "pack"], g: ["g", "kg"], ml: ["ml", "L"] }
export const asStockUnit = (u: unknown): StockUnit => (u === "g" || u === "ml" ? u : "unit")
export const isPurchaseUnit = (u: unknown): u is PurchaseUnit => u === "unit" || u === "pack" || u === "g" || u === "kg" || u === "ml" || u === "L"

/** A decimal string of a number (no exponent), or "" when it is not a finite number. */
function decimalText(value: unknown): string {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return ""
    // a JS number may carry binary noise (0.1 + 0.2): 6 decimals, then trailing zeros dropped
    return value.toFixed(6).replace(/\.?0+$/, "")
  }
  if (typeof value === "string") return value.trim()
  if (value && typeof value === "object" && typeof (value as { toFixed?: unknown }).toFixed === "function") return decimalText(String(value))
  return ""
}

/** An integer number of 10^-places, or null when the value is not a number or has more decimals. */
function scaled(value: unknown, places: number): number | null {
  const m = /^(-?)(\d+)(?:\.(\d+))?$/.exec(decimalText(value))
  if (!m) return null
  const frac = (m[3] ?? "").replace(/0+$/, "")
  if (frac.length > places) return null
  const v = Number(m[2]) * 10 ** places + Number((frac + "0".repeat(places)).slice(0, places) || "0")
  if (!Number.isSafeInteger(v)) return null
  return m[1] && v !== 0 ? -v : v
}

/** Quantity in thousandths of its unit (null: not a number, or more than 3 decimals). */
export const toMilli = (value: unknown): number | null => scaled(value, 3)
export const fromMilli = (milli: number): number => milli / 1000
/** Money in ten-thousandths (null: not a number, or more than 4 decimals). */
export const toTT = (value: unknown): number | null => scaled(value, 4)
export const fromTT = (tt: number): number => tt / 10000

/** n / d rounded half-up, for n >= 0 and d > 0 (integers). */
export function roundDiv(n: number, d: number): number {
  return Math.floor((2 * n + d) / (2 * d))
}

// ─── Units and purchase conversion ─────────────────────────────────────────────────────────────────

export type Conversion = { ok: true; unitsPerPurchase: number } | { ok: false; reason: "incompatible" | "pack-size" }
/**
 * How many stock units one purchase unit holds: kg→g 1000, L→ml 1000, pack→unit n (a whole number ≥ 1),
 * same unit 1. Anything across dimensions (kg→ml, L→unit…) is incompatible.
 */
export function purchaseConversion(stockUnit: unknown, purchaseUnit: unknown, packSize?: unknown): Conversion {
  const unit = asStockUnit(stockUnit)
  if (!isPurchaseUnit(purchaseUnit) || !PURCHASE_UNITS[unit].includes(purchaseUnit)) return { ok: false, reason: "incompatible" }
  if (purchaseUnit === "kg" || purchaseUnit === "L") return { ok: true, unitsPerPurchase: 1000 }
  if (purchaseUnit === "pack") {
    const n = Number(packSize)
    return Number.isInteger(n) && n >= 1 && n <= 100000 ? { ok: true, unitsPerPurchase: n } : { ok: false, reason: "pack-size" }
  }
  return { ok: true, unitsPerPurchase: 1 }
}

export type ReceivePlan =
  | { ok: true; stockMilli: number; unitCostTT: number | null }
  | { ok: false; reason: "incompatible" | "pack-size" | "quantity" | "price" }
/**
 * A receiving row in purchase units → the stock quantity it adds (exact, thousandths of the stock unit) and the
 * valuation per stock unit (purchase price ÷ units per purchase, 4 decimals, half-up). The invoice price itself is
 * kept by the caller unchanged.
 */
export function planReceive(row: { stockUnit: unknown; purchaseUnit: unknown; packSize?: unknown; purchaseQuantity: unknown; purchasePrice?: unknown }): ReceivePlan {
  const conv = purchaseConversion(row.stockUnit, row.purchaseUnit, row.packSize)
  if (!conv.ok) return conv
  const qty = toMilli(row.purchaseQuantity)
  if (qty === null || qty <= 0) return { ok: false, reason: "quantity" }
  let unitCostTT: number | null = null
  if (row.purchasePrice !== undefined && row.purchasePrice !== null && row.purchasePrice !== "") {
    const price = toTT(row.purchasePrice)
    if (price === null || price < 0) return { ok: false, reason: "price" }
    unitCostTT = roundDiv(price, conv.unitsPerPurchase)
  }
  return { ok: true, stockMilli: qty * conv.unitsPerPurchase, unitCostTT }
}

// ─── Modifier groups ───────────────────────────────────────────────────────────────────────────────

export type ModifierOption = {
  id: string; name: string; nameAr?: string; priceDelta: number | string
  isDefault?: boolean; available?: boolean; archived?: boolean; sortOrder?: number
}
export type ModifierGroup = {
  id: string; name: string; nameAr?: string; required?: boolean; minSelect?: number; maxSelect?: number
  sortOrder?: number; archived?: boolean; revision?: number; options: ModifierOption[]
}
export type Selection = { groupId: string; optionId: string }
/** What a sale line keeps of each option chosen (immutable; old sales display it after the menu changes). */
export type LineModifier = { groupId: string; groupName: string; groupNameAr: string; optionId: string; name: string; nameAr: string; priceDelta: number }

const bySort = <T extends { sortOrder?: number }>(a: T, b: T) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0)
export const selectable = (o: ModifierOption) => !o.archived && o.available !== false

/** How many options a group needs and allows (a required group needs at least one). */
export function groupBounds(g: ModifierGroup): { min: number; max: number } {
  const live = (g.options ?? []).filter((o) => !o.archived).length
  const min = Math.max(g.required ? 1 : 0, Math.floor(Number(g.minSelect) || 0))
  const rawMax = Math.floor(Number(g.maxSelect) || 0)
  const max = Math.max(min, rawMax >= 1 ? rawMax : Math.max(1, live))
  return { min, max }
}

export type GroupProblem = "name" | "option-name" | "option-id" | "duplicate-option" | "price" | "min-max" | "defaults" | "no-options"
/** What is wrong with a group definition (empty = valid). */
export function checkGroup(g: ModifierGroup): GroupProblem[] {
  const out = new Set<GroupProblem>()
  if (!g || typeof g.name !== "string" || !g.name.trim()) out.add("name")
  const options = Array.isArray(g?.options) ? g.options : []
  const live = options.filter((o) => !o.archived)
  if (live.length === 0) out.add("no-options")
  const ids = new Set<string>()
  for (const o of options) {
    if (!o || typeof o.id !== "string" || !o.id) { out.add("option-id"); continue }
    if (ids.has(o.id)) out.add("duplicate-option")
    ids.add(o.id)
    if (typeof o.name !== "string" || !o.name.trim()) out.add("option-name")
    if (toTT(o.priceDelta) === null) out.add("price")
  }
  const minRaw = Math.floor(Number(g?.minSelect) || 0)
  const maxRaw = Math.floor(Number(g?.maxSelect) || 0)
  if (minRaw < 0 || maxRaw < 0 || (maxRaw >= 1 && minRaw > maxRaw) || (live.length > 0 && Math.max(minRaw, g?.required ? 1 : 0) > live.length)) out.add("min-max")
  if (g && live.length && live.filter((o) => o.isDefault).length > groupBounds(g).max) out.add("defaults")
  return [...out]
}

export type SelectionProblem = { groupId: string; optionId?: string; code: "required" | "too-few" | "too-many" | "unknown-option" | "unavailable" | "not-offered" }
/**
 * Whether a choice of options is allowed for a product offering `groups` (in its order). Archived groups ask
 * nothing; an archived or unavailable option cannot be chosen; a repeated option counts once.
 */
export function checkSelection(groups: ModifierGroup[], selection: Selection[]): SelectionProblem[] {
  const out: SelectionProblem[] = []
  const offered = new Map(groups.map((g) => [g.id, g]))
  const chosen = new Map<string, Set<string>>()
  for (const s of selection ?? []) {
    const g = offered.get(s.groupId)
    if (!g || g.archived) { out.push({ groupId: s.groupId, optionId: s.optionId, code: "not-offered" }); continue }
    const o = (g.options ?? []).find((x) => x.id === s.optionId)
    if (!o) { out.push({ groupId: g.id, optionId: s.optionId, code: "unknown-option" }); continue }
    if (!selectable(o)) { out.push({ groupId: g.id, optionId: o.id, code: "unavailable" }); continue }
    if (!chosen.has(g.id)) chosen.set(g.id, new Set())
    chosen.get(g.id)!.add(o.id)
  }
  for (const g of groups) {
    if (g.archived) continue
    const n = chosen.get(g.id)?.size ?? 0
    const { min, max } = groupBounds(g)
    if (n < min) out.push({ groupId: g.id, code: g.required && n === 0 ? "required" : "too-few" })
    if (n > max) out.push({ groupId: g.id, code: "too-many" })
  }
  return out
}

/** The options pre-selected for a product: each live group's selectable defaults, up to its maximum. */
export function defaultSelection(groups: ModifierGroup[]): Selection[] {
  const out: Selection[] = []
  for (const g of groups) {
    if (g.archived) continue
    const defaults = [...(g.options ?? [])].sort(bySort).filter((o) => o.isDefault && selectable(o)).slice(0, groupBounds(g).max)
    for (const o of defaults) out.push({ groupId: g.id, optionId: o.id })
  }
  return out
}

/** The snapshot a sale line keeps, in the product's group order and each group's option order. */
export function snapshotModifiers(groups: ModifierGroup[], selection: Selection[]): LineModifier[] {
  const out: LineModifier[] = []
  const wanted = new Set((selection ?? []).map((s) => `${s.groupId}\u0000${s.optionId}`))
  for (const g of groups) {
    for (const o of [...(g.options ?? [])].sort(bySort)) {
      if (!wanted.has(`${g.id}\u0000${o.id}`)) continue
      out.push({ groupId: g.id, groupName: g.name, groupNameAr: g.nameAr ?? "", optionId: o.id, name: o.name, nameAr: o.nameAr ?? "", priceDelta: fromTT(toTT(o.priceDelta) ?? 0) })
    }
  }
  return out
}

/** Sum of the options' price deltas, in ten-thousandths (unparseable deltas count 0). */
export const modifiersDeltaTT = (mods: Array<{ priceDelta: unknown }>): number => (mods ?? []).reduce((sum, m) => sum + (toTT(m.priceDelta) ?? 0), 0)
/** A line's unit price: the product's price plus its options' deltas (4 decimals, exact). */
export function priceWithModifiers(basePrice: unknown, mods: Array<{ priceDelta: unknown }>): number {
  return fromTT((toTT(basePrice) ?? 0) + modifiersDeltaTT(mods))
}

/**
 * Cart identity of a configured line: two lines merge only when product, options, note and price are the same.
 * Options are compared as a set (order does not matter); the note exactly (trimmed).
 */
export function lineConfigKey(productId: string | number, mods: Array<{ optionId: string }>, note: string | null | undefined, unitPrice: number): string {
  const ids = [...new Set((mods ?? []).map((m) => m.optionId))].sort().join(",")
  return `${productId}|${ids}|${(note ?? "").trim()}|${toTT(unitPrice) ?? unitPrice}`
}

// ─── Recipes ───────────────────────────────────────────────────────────────────────────────────────

export type RecipeLine = { ingredientSyncId: string; quantity: number | string; when?: string[]; unless?: string[] }
export type RecipeDef = { id: string; yield?: number; lines: RecipeLine[] }
export type Consumption = { ingredientSyncId: string; milli: number }

export type RecipeProblem = { line: number; code: "yield" | "no-lines" | "ingredient" | "self" | "quantity" | "precision" | "condition" }
/** What is wrong with a recipe (empty = valid). `isIngredient` says whether a syncId names a stock-tracked product. */
export function checkRecipe(def: RecipeDef, isIngredient: (syncId: string) => boolean, selfSyncId?: string | null): RecipeProblem[] {
  const out: RecipeProblem[] = []
  const y = Number(def?.yield ?? 1)
  if (!Number.isInteger(y) || y < 1 || y > 1000) out.push({ line: -1, code: "yield" })
  const lines = Array.isArray(def?.lines) ? def.lines : []
  if (lines.length === 0) out.push({ line: -1, code: "no-lines" })
  lines.forEach((l, i) => {
    if (!l || typeof l.ingredientSyncId !== "string" || !l.ingredientSyncId) { out.push({ line: i, code: "ingredient" }); return }
    if (selfSyncId && l.ingredientSyncId === selfSyncId) out.push({ line: i, code: "self" })
    else if (!isIngredient(l.ingredientSyncId)) out.push({ line: i, code: "ingredient" })
    const q = toMilli(l.quantity)
    if (q === null) out.push({ line: i, code: Number.isFinite(Number(l.quantity)) ? "precision" : "quantity" })
    else if (q <= 0) out.push({ line: i, code: "quantity" })
    for (const c of [l.when, l.unless]) if (c !== undefined && (!Array.isArray(c) || c.some((x) => typeof x !== "string" || !x))) out.push({ line: i, code: "condition" })
  })
  return out
}

/** Whether a recipe line applies to the options chosen: all of `when` chosen, none of `unless`. */
export function lineApplies(line: RecipeLine, chosen: ReadonlySet<string>): boolean {
  return (line.when ?? []).every((id) => chosen.has(id)) && !(line.unless ?? []).some((id) => chosen.has(id))
}

/** One serving's quantity per ingredient (thousandths), for the options chosen, in first-appearance order. */
export function perServing(def: RecipeDef, optionIds: string[]): Consumption[] {
  const chosen = new Set(optionIds ?? [])
  const totals = new Map<string, number>()
  for (const l of def?.lines ?? []) {
    if (!lineApplies(l, chosen)) continue
    const q = toMilli(l.quantity)
    if (q === null || q <= 0) continue
    totals.set(l.ingredientSyncId, (totals.get(l.ingredientSyncId) ?? 0) + q)
  }
  return [...totals].map(([ingredientSyncId, milli]) => ({ ingredientSyncId, milli }))
}

/**
 * What selling `soldQuantity` of a drink consumes: per ingredient, (one serving's lines summed) × quantity ÷ yield,
 * rounded half-up once to 0.001 of its unit. null when the quantity is not a valid amount.
 */
export function recipeConsumption(def: RecipeDef, optionIds: string[], soldQuantity: unknown): Consumption[] | null {
  const sold = toMilli(soldQuantity)
  if (sold === null || sold <= 0) return null
  const y = Math.max(1, Math.floor(Number(def?.yield ?? 1)) || 1)
  return perServing(def, optionIds).map((c) => ({ ingredientSyncId: c.ingredientSyncId, milli: roundDiv(c.milli * sold, y * 1000) })).filter((c) => c.milli > 0)
}

/**
 * How many servings the ingredients in stock can still make (the recipe's lines for `optionIds`; no options =
 * the lines every serving needs). Infinity when the recipe consumes nothing.
 */
export function servingsAvailable(def: RecipeDef, stockMilliOf: (syncId: string) => number, optionIds: string[] = []): number {
  const y = Math.max(1, Math.floor(Number(def?.yield ?? 1)) || 1)
  let best = Number.POSITIVE_INFINITY
  for (const c of perServing(def, optionIds)) {
    const have = Math.max(0, Math.floor(stockMilliOf(c.ingredientSyncId) || 0))
    best = Math.min(best, Math.floor((have * y) / c.milli))
  }
  return best
}

/** Whether two consumptions are the same (per ingredient, order-free). */
export function sameConsumption(a: Consumption[], b: Consumption[]): boolean {
  const key = (x: Consumption[]) => [...(x ?? [])].filter((c) => c.milli > 0).map((c) => `${c.ingredientSyncId}=${c.milli}`).sort().join(";")
  return key(a) === key(b)
}

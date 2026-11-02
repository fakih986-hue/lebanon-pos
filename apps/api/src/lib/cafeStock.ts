/**
 * Café batch — the server's side of modifiers, recipes and ingredient stock (rules: lib/cafeMenu.ts, shared with the
 * register; design: docs/CAFE-IMPLEMENTATION-PLAN.md).
 *
 * - A recipe line of a sale consumes its ingredients in the transaction that commits the sale: FEFO over open lots
 *   (expiry, received, id: deterministic, so a hub and the cloud take the same lots), quantities written with a
 *   rounded SQL update (3 decimals) so repeated decrements cannot drift, never below zero.
 * - Cost comes from the lots actually consumed: the invoice price per purchase unit ÷ units per purchase (exact
 *   decimals), else the lot's valuation; stock without a lot is valued at the product's cost. "Unknown" is kept
 *   apart from a real zero.
 * - The revision a drink was made with decides; today's recipe is never substituted silently.
 */
import { Prisma } from "../generated/prisma/index.js"
import type prismaClient from "./prisma.js"
import { checkSelection, fromMilli, recipeConsumption, sameConsumption, toMilli, type Consumption, type ModifierGroup, type RecipeDef, type SelectionProblem } from "./cafeMenu.js"
import { effectivePermissions } from "./permissions.js"

type Db = typeof prismaClient

/** Retryable: the sale names a recipe revision (or an ingredient) this server has not received yet. Nothing applied. */
export class RecipeHeldError extends Error {
  constructor(drink: string, rev: string | null, what = "recipe") {
    super(`RECIPE_HELD: "${drink}" was made with ${what === "recipe" ? `a recipe ${rev ? `(${rev}) ` : ""}this server does not know yet` : what}. The sale is kept and retried; nothing was applied.`)
    this.name = "RecipeHeldError"
  }
}
/** Not enough of an ingredient where the stock is kept: a queued sale is held for review, a live checkout refused. */
export class IngredientShortError extends Error {
  constructor(public ingredient: string, public drink: string, public needed: number, public available: number, public unit: string) {
    super(`INGREDIENT_SHORT: Not enough "${ingredient}" for "${drink}" (needs ${needed} ${unit}, ${available} ${unit} in stock). Count or receive it, then apply the sale.`)
    this.name = "IngredientShortError"
  }
}
/** A live checkout (before payment) that breaks a menu rule: refused, nothing recorded. */
export class MenuRuleError extends Error {
  constructor(message: string) { super(message); this.name = "MenuRuleError" }
}
/** A product or recipe setup the server refuses (incompatible units, an invalid recipe…). */
export class ProductSetupError extends Error {
  constructor(message: string) { super(`PRODUCT_SETUP: ${message}`); this.name = "ProductSetupError" }
}

export const RESTORES_STOCK = (policy: unknown) => policy !== "untracked" && policy !== "recipe"

/** The product's modifier groups, in its order (unknown ids are skipped). */
export async function productGroups(db: Db, tenantId: string, ids: unknown): Promise<ModifierGroup[]> {
  const list = Array.isArray(ids) ? ids.filter((x): x is string => typeof x === "string" && !!x) : []
  if (!list.length) return []
  const rows = await (db as any).modifierGroup.findMany({ where: { tenantId, id: { in: list } } })
  const byId = new Map<string, any>(rows.map((r: any) => [r.id, r]))
  return list.map((id) => byId.get(id)).filter(Boolean).map((r: any) => ({ ...r, options: Array.isArray(r.options) ? r.options : [] }))
}

/** A sale line's chosen options (ids only; names are display copies). */
export function selectionOf(item: { modifiers?: unknown }): Array<{ groupId: string; optionId: string }> {
  return (Array.isArray(item?.modifiers) ? item.modifiers : [])
    .filter((m: any) => m && typeof m.groupId === "string" && typeof m.optionId === "string")
    .map((m: any) => ({ groupId: m.groupId, optionId: m.optionId }))
}

/** The options a line chose, checked against the product's groups (and which groups are archived). */
export async function modifierProblems(db: Db, tenantId: string, product: { modifierGroupIds?: unknown }, item: { modifiers?: unknown }): Promise<SelectionProblem[]> {
  const selection = selectionOf(item)
  const offered = await productGroups(db, tenantId, product.modifierGroupIds)
  if (!offered.length && !selection.length) return []
  return checkSelection(offered, selection)
}

/** The server's current price delta of each option a line chose (an option it does not know adds nothing). */
export async function knownDeltas(db: Db, tenantId: string, item: { modifiers?: unknown }): Promise<Prisma.Decimal> {
  const sel = selectionOf(item)
  if (!sel.length) return new Prisma.Decimal(0)
  const groups = await (db as any).modifierGroup.findMany({ where: { tenantId, id: { in: [...new Set(sel.map((s) => s.groupId))] } }, select: { id: true, options: true } })
  let sum = new Prisma.Decimal(0)
  for (const s of sel) {
    const g = groups.find((x: any) => x.id === s.groupId)
    const o = (Array.isArray(g?.options) ? g.options : []).find((x: any) => x?.id === s.optionId)
    if (o && Number.isFinite(Number(o.priceDelta))) sum = sum.add(new Prisma.Decimal(String(o.priceDelta)))
  }
  return sum
}

export async function loadRecipe(db: Db, tenantId: string, rev: unknown): Promise<(RecipeDef & { productSyncId: string }) | null> {
  if (typeof rev !== "string" || !rev) return null
  const r = await (db as any).recipeRevision.findFirst({ where: { tenantId, id: rev } })
  if (!r) return null
  return { id: r.id, yield: r.yield, lines: Array.isArray(r.lines) ? r.lines : [], productSyncId: r.productSyncId }
}

export type ConsumedSlice = { batchId: string | null; quantity: number; unitCost: number | null }
export type ConsumedIngredient = {
  ingredientSyncId: string; productId: number; name: string; unit: string; quantity: number
  allocations: ConsumedSlice[]; cost: number | null; costKnown: boolean
}

/**
 * Take `milli` thousandths of an ingredient out of stock: its product stock and its open lots (FEFO), with rounded
 * updates. Throws IngredientShortError when the product's stock cannot cover it (nothing of it is taken).
 */
export async function consumeIngredient(db: Db, tenantId: string, ingredient: { id: number; syncId: string; name: string; stockUnit: string; cost: unknown }, milli: number, drink: string): Promise<ConsumedIngredient> {
  const qty = fromMilli(milli)
  const taken = await db.$executeRaw`
    UPDATE "Product" SET "stock" = round(("stock" - ${qty})::numeric, 3)::float8, "updatedAt" = (now() AT TIME ZONE 'UTC')
    WHERE "tenantId" = ${tenantId} AND "id" = ${ingredient.id} AND "stock" >= ${qty}`
  if (taken === 0) {
    const now = await db.product.findFirst({ where: { tenantId, id: ingredient.id }, select: { stock: true } })
    throw new IngredientShortError(ingredient.name, drink, qty, Number(now?.stock ?? 0), ingredient.stockUnit)
  }
  const lots = await db.$queryRaw<Array<{ id: string; quantityRemaining: number; unitCost: Prisma.Decimal; purchasePrice: Prisma.Decimal | null; unitsPerPurchase: Prisma.Decimal | null }>>`
    SELECT "id", "quantityRemaining", "unitCost", "purchasePrice", "unitsPerPurchase" FROM "InventoryBatch"
    WHERE "tenantId" = ${tenantId} AND "productId" = ${ingredient.id} AND "status" = 'Open' AND "quantityRemaining" > 0
    ORDER BY "expiryDate" ASC NULLS LAST, "receivedAt" ASC, "id" ASC
    FOR UPDATE`
  let left = milli
  const allocations: ConsumedSlice[] = []
  let cost = new Prisma.Decimal(0)
  let known = true
  for (const lot of lots) {
    if (left <= 0) break
    const have = Math.round(Number(lot.quantityRemaining) * 1000)
    const take = Math.min(left, have)
    if (take <= 0) continue
    const q = fromMilli(take)
    const n = await db.$executeRaw`
      UPDATE "InventoryBatch" SET
        "quantityRemaining" = round(("quantityRemaining" - ${q})::numeric, 3)::float8,
        "status" = CASE WHEN round(("quantityRemaining" - ${q})::numeric, 3) <= 0 THEN 'Consumed'::"InventoryBatchStatus" ELSE "status" END,
        "updatedAt" = (now() AT TIME ZONE 'UTC')
      WHERE "id" = ${lot.id} AND "tenantId" = ${tenantId} AND "quantityRemaining" >= ${q}`
    if (n === 0) continue
    left -= take
    // the invoice price of this lot, exactly (else its valuation); a lot with neither a price nor a valuation is unknown
    const perUnit = lot.purchasePrice != null && lot.unitsPerPurchase != null && Number(lot.unitsPerPurchase) > 0
      ? new Prisma.Decimal(lot.purchasePrice).div(new Prisma.Decimal(lot.unitsPerPurchase))
      : new Prisma.Decimal(lot.unitCost ?? 0)
    const lotKnown = lot.purchasePrice != null || Number(lot.unitCost ?? 0) > 0
    if (!lotKnown) known = false
    cost = cost.add(perUnit.mul(q))
    allocations.push({ batchId: lot.id, quantity: q, unitCost: lotKnown ? Number(perUnit.toDecimalPlaces(6)) : null })
  }
  if (left > 0) {
    // stock with no lot behind it (opening stock, older data): valued at the product's cost when it has one
    const productCost = Number(ingredient.cost ?? 0)
    const q = fromMilli(left)
    if (productCost > 0) cost = cost.add(new Prisma.Decimal(String(ingredient.cost)).mul(q))
    else known = false
    allocations.push({ batchId: null, quantity: q, unitCost: productCost > 0 ? productCost : null })
  }
  return { ingredientSyncId: ingredient.syncId, productId: ingredient.id, name: ingredient.name, unit: ingredient.stockUnit, quantity: qty, allocations, cost: Number(cost.toDecimalPlaces(4)), costKnown: known }
}

/** A line's ingredient cost and whether it is known, partly known or unknown (unknown is never shown as 0). */
export function consumptionCost(items: ConsumedIngredient[]): { cost: number; status: "known" | "partial" | "unknown" } {
  if (!items.length) return { cost: 0, status: "known" }
  const total = items.reduce((s, c) => s.add(new Prisma.Decimal(c.cost ?? 0)), new Prisma.Decimal(0))
  const knownCount = items.filter((c) => c.costKnown).length
  return { cost: Number(total.toDecimalPlaces(4)), status: knownCount === items.length ? "known" : knownCount === 0 ? "unknown" : "partial" }
}

/** A manager's decision on a line whose recipe revision never reached this server (made on the register). */
export type RecipeResolution = { mode: "recorded" | "none"; resolvedBy: string; resolvedByName?: string; note: string; at?: string }
async function authorizedRecipeResolution(db: Db, tenantId: string, item: any, authority?: { staffId: string | null; approved: string[] }): Promise<RecipeResolution | null> {
  const r = item?.recipeResolution
  if (!r || (r.mode !== "recorded" && r.mode !== "none") || typeof r.resolvedBy !== "string" || typeof r.note !== "string" || r.note.trim().length < 3) return null
  if (authority && !authority.approved.includes("inventory.manage") && r.resolvedBy !== authority.staffId) return null
  const staff = await db.staffUser.findFirst({ where: { id: r.resolvedBy, tenantId, active: true }, select: { role: true, permissions: true } })
  if (!staff || !effectivePermissions(staff.permissions as any, staff.role).includes("inventory.manage" as any)) return null
  return r as RecipeResolution
}

/** What the register says it consumed (its snapshot), as thousandths; null when absent or malformed. */
function recordedConsumption(item: any): Consumption[] | null {
  if (!Array.isArray(item?.consumption)) return null
  const out: Consumption[] = []
  for (const c of item.consumption) {
    const m = toMilli(c?.quantity)
    if (!c || typeof c.ingredientSyncId !== "string" || m === null || m < 0) return null
    if (m > 0) out.push({ ingredientSyncId: c.ingredientSyncId, milli: m })
  }
  return out
}

export type RecipeLineResult = {
  consumed: ConsumedIngredient[]; cost: number; costStatus: "known" | "partial" | "unknown"
  rev: string | null; conflict: string | null; resolution: RecipeResolution | null
}
/**
 * Consume the ingredients of one recipe line (sale or remake). The revision named on the line decides; its
 * options pick the conditional lines. Unknown revision → RecipeHeldError, unless an authorized manager resolved it.
 */
export async function consumeRecipeLine(db: Db, tenantId: string, drink: { name: string; syncId: string | null; recipeRev?: string | null }, item: any, opts: { authority?: { staffId: string | null; approved: string[] }; useCurrent?: boolean } = {}): Promise<RecipeLineResult> {
  const rev = typeof item?.recipeRev === "string" && item.recipeRev ? item.recipeRev : opts.useCurrent ? drink.recipeRev ?? null : null
  const recipe = await loadRecipe(db, tenantId, rev)
  let wanted: Consumption[]
  let conflict: string | null = null
  let resolution: RecipeResolution | null = null
  if (!recipe || (drink.syncId && recipe.productSyncId !== drink.syncId)) {
    resolution = await authorizedRecipeResolution(db, tenantId, item, opts.authority)
    if (!resolution) throw new RecipeHeldError(drink.name, rev, recipe ? "a recipe of another product" : "recipe")
    if (resolution.mode === "none") wanted = []
    else {
      const recorded = recordedConsumption(item)
      if (!recorded) throw new RecipeHeldError(drink.name, rev, "no recipe recorded on the register to apply")
      wanted = recorded
    }
    conflict = "resolved"
  } else {
    const optionIds = selectionOf(item).map((s) => s.optionId)
    const amounts = recipeConsumption(recipe, optionIds, item?.quantity)
    // release batch: a quantity this precision cannot hold is refused, never sold as "nothing consumed"
    if (!amounts) throw new ProductSetupError(`"${drink.name}": ${String(item?.quantity)} is not a supported quantity (a positive amount with at most 3 decimals).`)
    wanted = amounts
    const recorded = recordedConsumption(item)
    if (recorded && !sameConsumption(recorded, wanted)) conflict = "mismatch" // the server's copy of the revision decides
  }
  const consumed: ConsumedIngredient[] = []
  for (const c of wanted) {
    const ing = await db.product.findFirst({ where: { tenantId, syncId: c.ingredientSyncId }, select: { id: true, syncId: true, name: true, stockUnit: true, cost: true, stockPolicy: true } })
    if (!ing) throw new RecipeHeldError(drink.name, rev, `an ingredient (${c.ingredientSyncId}) this server does not know yet`)
    // an ingredient later set to keep no stock: nothing to take; its cost is the product's, else unknown
    if (ing.stockPolicy !== "tracked") {
      const known = Number(ing.cost ?? 0) > 0
      consumed.push({ ingredientSyncId: c.ingredientSyncId, productId: ing.id, name: ing.name, unit: ing.stockUnit, quantity: c.milli / 1000, allocations: [], cost: known ? Number(new Prisma.Decimal(String(ing.cost)).mul(c.milli / 1000).toDecimalPlaces(4)) : null, costKnown: known })
      continue
    }
    consumed.push(await consumeIngredient(db, tenantId, { id: ing.id, syncId: ing.syncId!, name: ing.name, stockUnit: ing.stockUnit, cost: ing.cost }, c.milli, drink.name))
  }
  const { cost, status } = consumptionCost(consumed)
  return { consumed, cost, costStatus: status, rev, conflict, resolution }
}

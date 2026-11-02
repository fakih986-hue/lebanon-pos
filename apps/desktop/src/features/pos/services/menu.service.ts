/**
 * Café batch — the register's menu: modifier groups, drinks' recipe revisions, what a configured drink consumes and
 * whether the ingredients in stock can make it. Rules are lib/cafeMenu.ts (byte-identical to the server's copy);
 * design: docs/CAFE-IMPLEMENTATION-PLAN.md.
 *
 * Groups and recipe revisions come from the server's pull (schema 6) and are changed only by managing staff
 * (inventory.manage): a save is written here and queued like any other operation. A recipe revision is never edited:
 * saving adds one and moves the drink's pointer. A sale line keeps the revision it was made with.
 */
import {
  checkGroup, checkRecipe, defaultSelection, lineConfigKey, perServing, priceWithModifiers, recipeConsumption, servingsAvailable,
  snapshotModifiers, toMilli, fromMilli, type Consumption, type LineModifier, type ModifierGroup, type RecipeDef, type RecipeLine, type Selection,
} from "../lib/cafeMenu"
import { canUseStorage, createId } from "../lib/storage"
import { assertCanWrite, enqueueSyncOperation } from "./sync.service"
import { getProductsSync } from "./product.service"
import { getCurrentUser, PermissionError, userCan } from "./security.service"
import type { Product } from "../types/product"

export const MODIFIER_GROUPS_KEY = "lebanonpos.modifier-groups.v1"
export const RECIPE_REVISIONS_KEY = "lebanonpos.recipe-revisions.v1"
export const MENU_EVENT = "lebanonpos-menu-changed"
const PRODUCTS_KEY = "lebanonpos.products.v1"
const PRODUCT_EVENT = "lebanonpos-products-changed"

export type RecipeRevision = RecipeDef & { productSyncId: string; note?: string; parentRev?: string | null; createdAt?: string; createdByName?: string | null }

function readList<T>(key: string): T[] {
  if (!canUseStorage()) return []
  try { const v = JSON.parse(window.localStorage.getItem(key) ?? "[]"); return Array.isArray(v) ? v : [] } catch { return [] }
}
function writeList(key: string, value: unknown[]) {
  if (!canUseStorage()) return
  window.localStorage.setItem(key, JSON.stringify(value))
  window.dispatchEvent(new Event(MENU_EVENT))
}

export function getModifierGroups(): ModifierGroup[] {
  return readList<ModifierGroup>(MODIFIER_GROUPS_KEY).map((g) => ({ ...g, options: Array.isArray(g.options) ? g.options : [] }))
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.name.localeCompare(b.name))
}
export function getRecipeRevisions(): RecipeRevision[] {
  return readList<RecipeRevision>(RECIPE_REVISIONS_KEY)
}
export function subscribeMenu(callback: () => void) {
  if (typeof window === "undefined") return () => undefined
  window.addEventListener(MENU_EVENT, callback)
  window.addEventListener(PRODUCT_EVENT, callback)
  return () => { window.removeEventListener(MENU_EVENT, callback); window.removeEventListener(PRODUCT_EVENT, callback) }
}

/** The groups a product offers, in its order (archived groups are left out: they ask nothing). */
export function groupsForProduct(product: Pick<Product, "modifierGroupIds">, groups: ModifierGroup[] = getModifierGroups()): ModifierGroup[] {
  const byId = new Map(groups.map((g) => [g.id, g]))
  return (product.modifierGroupIds ?? []).map((id) => byId.get(id)).filter((g): g is ModifierGroup => !!g && !g.archived)
}
/** Whether tapping the product must open the options sheet (it has groups, or it is a recipe drink with options). */
export function needsOptions(product: Pick<Product, "modifierGroupIds">, groups?: ModifierGroup[]): boolean {
  return groupsForProduct(product, groups).length > 0
}

export function recipeOf(product: Pick<Product, "recipeRev">, revisions: RecipeRevision[] = getRecipeRevisions()): RecipeRevision | null {
  return product.recipeRev ? revisions.find((r) => r.id === product.recipeRev) ?? null : null
}
export function revisionsOf(product: Pick<Product, "syncId">, revisions: RecipeRevision[] = getRecipeRevisions()): RecipeRevision[] {
  return revisions.filter((r) => r.productSyncId === product.syncId).sort((a, b) => String(b.createdAt ?? "").localeCompare(String(a.createdAt ?? "")))
}

const stockMilliOf = (products: Product[]) => {
  const bySync = new Map(products.filter((p) => p.syncId).map((p) => [p.syncId!, p]))
  return (syncId: string) => {
    const p = bySync.get(syncId)
    return p && !p.archived && (p.stockPolicy ?? "tracked") === "tracked" ? Math.max(0, Math.round(Number(p.stock) * 1000)) : 0
  }
}

/**
 * Servings a drink can still be made (with the options given; none = what every serving needs) from the
 * ingredients in stock here. null = not a recipe drink; 0 = unavailable (or no recipe saved yet).
 */
export function servingsFor(product: Product, optionIds: string[] = [], products: Product[] = getProductsSync(), revisions?: RecipeRevision[]): number | null {
  if (product.stockPolicy !== "recipe") return null
  const recipe = recipeOf(product, revisions)
  if (!recipe) return 0
  return servingsAvailable(recipe, stockMilliOf(products), optionIds)
}

export type CafeLine = { productId: number; quantity: number; stockPolicy?: string; recipeRev?: string | null; modifiers?: Array<{ optionId: string }> }
/** What the recipe lines of a cart consume, per ingredient (thousandths); unknown revisions consume nothing here. */
export function cartConsumption(lines: CafeLine[], products: Product[] = getProductsSync(), revisions: RecipeRevision[] = getRecipeRevisions()): Map<string, number> {
  const out = new Map<string, number>()
  for (const l of lines) {
    if (l.stockPolicy !== "recipe") continue
    const product = products.find((p) => p.id === l.productId)
    const recipe = l.recipeRev ? revisions.find((r) => r.id === l.recipeRev) ?? null : product ? recipeOf(product, revisions) : null
    if (!recipe) continue
    for (const c of recipeConsumption(recipe, (l.modifiers ?? []).map((m) => m.optionId), l.quantity) ?? []) out.set(c.ingredientSyncId, (out.get(c.ingredientSyncId) ?? 0) + c.milli)
  }
  return out
}
export type Shortage = { ingredient: string; needed: number; inStock: number; unit: string }
/** The first ingredient the cart's drinks need more of than this register has in stock (null = it fits). */
export function cartShortage(lines: CafeLine[], products: Product[] = getProductsSync(), revisions?: RecipeRevision[]): Shortage | null {
  const have = stockMilliOf(products)
  for (const [syncId, milli] of cartConsumption(lines, products, revisions)) {
    if (milli > have(syncId)) {
      const p = products.find((x) => x.syncId === syncId)
      return { ingredient: p?.name ?? syncId, needed: fromMilli(milli), inStock: fromMilli(have(syncId)), unit: p?.stockUnit ?? "unit" }
    }
  }
  return null
}

/** The sale-line facts of a configured drink: options snapshot, unit price, the recipe and what it consumes. */
export function configuredLine(product: Product, selection: Selection[], note: string, quantity: number) {
  const groups = groupsForProduct(product)
  const modifiers: LineModifier[] = snapshotModifiers(groups, selection)
  const unitPrice = priceWithModifiers(product.price, modifiers)
  const recipe = product.stockPolicy === "recipe" ? recipeOf(product) : null
  const consumption: Consumption[] = recipe ? recipeConsumption(recipe, modifiers.map((m) => m.optionId), quantity) ?? [] : []
  return {
    modifiers, unitPrice, basePrice: Number(product.price), note: note.trim(),
    recipeRev: recipe?.id ?? null, consumption, lineKey: lineConfigKey(product.id, modifiers, note, unitPrice),
  }
}
export { defaultSelection }

/** A recipe line's consumption as the sale payload carries it (the server recomputes from its own copy). */
export function consumptionPayload(consumption: Consumption[]) {
  return consumption.map((c) => ({ ingredientSyncId: c.ingredientSyncId, quantity: fromMilli(c.milli) }))
}
/** The cart's ingredient quantities as checkout journal lines (lots by FEFO and stock, like packaged items). */
export function ingredientCheckoutLines(lines: CafeLine[], products: Product[] = getProductsSync()) {
  const lots: Array<{ productId: number; productName: string; barcode: string; quantity: number; fallbackUnitCost: number }> = []
  const stock: Array<{ productId: number; quantity: number }> = []
  for (const [syncId, milli] of cartConsumption(lines, products)) {
    const p = products.find((x) => x.syncId === syncId)
    if (!p || (p.stockPolicy ?? "tracked") !== "tracked" || milli <= 0) continue
    const quantity = fromMilli(milli)
    lots.push({ productId: p.id, productName: p.name, barcode: p.barcode ?? "", quantity, fallbackUnitCost: Number(p.cost) || 0 })
    stock.push({ productId: p.id, quantity })
  }
  return { lots, stock }
}

// ─── Managing the menu (inventory.manage) ──────────────────────────────────────────────────────────

function assertCanManageMenu(what: string) {
  if (!userCan("inventory.manage")) throw new PermissionError(`${what} needs the Manage inventory permission.`)
}

/** Save a modifier group (new or changed). Options left out are archived, never removed. Throws on invalid input. */
export function saveModifierGroup(input: ModifierGroup): ModifierGroup {
  assertCanWrite("save modifier group")
  assertCanManageMenu("Changing the menu's options")
  const all = getModifierGroups()
  const prior = all.find((g) => g.id === input.id)
  const options = [
    ...input.options.map((o, i) => ({ ...o, name: o.name.trim(), nameAr: (o.nameAr ?? "").trim(), priceDelta: Number(o.priceDelta) || 0, sortOrder: o.sortOrder ?? i })),
    ...(prior?.options ?? []).filter((o) => !input.options.some((x) => x.id === o.id)).map((o) => ({ ...o, archived: true })),
  ]
  const group: ModifierGroup = { ...input, name: input.name.trim(), nameAr: (input.nameAr ?? "").trim(), options, revision: (prior?.revision ?? 0) + 1 }
  const problems = input.archived ? checkGroup(group).filter((p) => p !== "no-options") : checkGroup(group)
  if (problems.length) throw new MenuSetupError(problems.join(","))
  writeList(MODIFIER_GROUPS_KEY, [...all.filter((g) => g.id !== group.id), group])
  enqueueSyncOperation({ entity: "modifier-group", action: prior ? "update" : "create", summary: `Menu options "${group.name}" saved.`, payload: group })
  return group
}
export function newModifierGroup(): ModifierGroup {
  return { id: `mg-${createId()}`, name: "", nameAr: "", required: false, minSelect: 0, maxSelect: 1, sortOrder: getModifierGroups().length, options: [{ id: `mo-${createId()}`, name: "", nameAr: "", priceDelta: 0 }] }
}
export const newOptionId = () => `mo-${createId()}`

export class MenuSetupError extends Error {
  codes: string
  constructor(codes: string) { super(`MENU_SETUP: ${codes}`); this.name = "MenuSetupError"; this.codes = codes }
}

/** Save a new recipe revision for a drink and make it current. Throws MenuSetupError with the problems. */
export function saveRecipe(product: Product, input: { yield: number; lines: RecipeLine[]; note?: string }): RecipeRevision {
  assertCanWrite("save recipe")
  assertCanManageMenu("Changing a recipe")
  if (!product.syncId) throw new MenuSetupError("ingredient")
  const products = getProductsSync()
  const isIngredient = (sid: string) => products.some((p) => p.syncId === sid && !p.archived && (p.stockPolicy ?? "tracked") === "tracked")
  const lines = input.lines.map((l) => ({ ingredientSyncId: l.ingredientSyncId, quantity: String(l.quantity).trim(), ...(l.when?.length ? { when: l.when } : {}), ...(l.unless?.length ? { unless: l.unless } : {}) }))
  const id = `rcp-${createId()}`
  const problems = checkRecipe({ id, yield: input.yield, lines }, isIngredient, product.syncId)
  if (problems.length) throw new MenuSetupError([...new Set(problems.map((p) => p.code))].join(","))
  const user = getCurrentUser()
  const revision: RecipeRevision = { id, productSyncId: product.syncId, yield: input.yield, lines, note: (input.note ?? "").trim(), parentRev: product.recipeRev ?? null, createdAt: new Date().toISOString(), createdByName: user?.name ?? null }
  writeList(RECIPE_REVISIONS_KEY, [...getRecipeRevisions(), revision])
  // the drink's pointer here (the server moves its own when the revision arrives)
  const stored = readList<Product>(PRODUCTS_KEY).map((p) => (p.syncId === product.syncId ? { ...p, recipeRev: id } : p))
  window.localStorage.setItem(PRODUCTS_KEY, JSON.stringify(stored))
  window.dispatchEvent(new Event(PRODUCT_EVENT))
  enqueueSyncOperation({ entity: "recipe", action: "create", summary: `Recipe of ${product.name} saved.`, payload: { ...revision, productName: product.name, createdById: user?.id ?? null } })
  return revision
}

/** Per-serving quantities of a recipe for display (thousandths → stock units), with their conditions. */
export function describeServing(recipe: RecipeDef, optionIds: string[]): Array<{ ingredientSyncId: string; quantity: number }> {
  return perServing(recipe, optionIds).map((c) => ({ ingredientSyncId: c.ingredientSyncId, quantity: fromMilli(c.milli) }))
}
export { toMilli }

// ─── Remake / waste (inventory.adjust applies it; otherwise the server may hold it for review) ──

export type WasteInput = { product: Product; quantity: number; reason: "Remake" | "Waste"; note: string; selection?: Selection[] }
export async function recordWaste(input: WasteInput) {
  assertCanWrite("record waste")
  if (toMilli(input.quantity) === null || input.quantity <= 0) throw new MenuSetupError("quantity")
  const user = getCurrentUser()
  const modifiers = input.selection ? snapshotModifiers(groupsForProduct(input.product), input.selection) : []
  const id = `waste-${createId()}`
  await enqueueSyncOperation({
    entity: "inventory", action: "waste",
    summary: `${input.reason}: ${input.quantity} × ${input.product.name}`,
    payload: {
      id, productId: input.product.id, productSyncId: input.product.syncId, productName: input.product.name, quantity: input.quantity,
      reason: input.reason, note: input.note.trim(), modifiers, ...(input.product.stockPolicy === "recipe" && input.product.recipeRev ? { recipeRev: input.product.recipeRev } : {}),
      createdById: user?.id ?? null, createdByName: user?.name ?? null, createdAt: new Date().toISOString(),
    },
  })
  return id
}

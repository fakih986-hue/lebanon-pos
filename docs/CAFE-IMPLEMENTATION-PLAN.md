# Café implementation plan

**Date:** 2026-10-29 · based on [CAFE-COMPATIBILITY-AUDIT.md](CAFE-COMPATIBILITY-AUDIT.md) and [CAFE-FEATURE-TEST-MATRIX.md](CAFE-FEATURE-TEST-MATRIX.md).
Nothing here is implemented. Each sprint needs approval before work starts; deployment and EXE release are separate approvals.

**Principles**
- Smallest model that makes a café correct; no restaurant complexity by default.
- Existing stores (mini-markets) must behave exactly as today unless they opt in.
- Every fix starts by flipping the matching `it.fails` probe in `cafe-audit.test.ts` / `cafe-device.test.ts` to `it`.
- Real Postgres for every money/stock/concurrency claim; rounding unchanged; Midnight Gold tokens only; en/ar parity.
- Upgrade order for any sync-shape change: cloud → hubs → tills.

## Sprint 0 — Platform security (must-have, all stores, do first)

Not café-specific; affects production today.

| Item | Change | Acceptance criteria |
|---|---|---|
| S1 cross-store read | `/api/products`, `/api/customers`, `/api/sales` always use `req.auth.tenantId`; a different `?tenantId=` → 403 | 3 CA probes flip; owner/admin tooling unaffected |
| S2 PIN hashes | pull returns staff PIN hashes only to a device/hub sync identity, never to a staff token; customer PINs never; decide offline-verifier design | CA probe flips; paired till still unlocks offline; hub still verifies; installer test |
| S5 authz gaps | reports require `reports.view` (+ cost fields need new `reports.cost`); device pairing/revoke needs `settings.manage`; driver create/update needs `delivery.manage` + `staff.manage`; diagnostics require localhost or admin; public image requires store scope | CA probes flip; Manager/Admin flows unchanged |

**Dependencies:** none. **Migration:** none. **Compatibility:** S2 changes the pull payload — ship with a hub-first window; older tills that already cached hashes keep working offline until they upgrade. **Tests:** CA probes, existing 366 API + 399 desktop, one installer test (hub + paired till offline unlock).

## Sprint 1 — Barcode-free and untracked menu items (must-have, first café sprint)

**Goal:** a café can create Espresso/Cappuccino/Nescafé with no barcode and sell them with a scanned Pepsi in one order, online and offline, with correct sync, stock and refunds.

**Scope**
1. **Barcode optional (C1).**
   - Device: `normalizeBarcode("") → null`; product create/update send `null`; editor drops the required rule (`ProductEditorDrawer.tsx:59`) and shows "No barcode" as a normal state; search/scan unaffected.
   - Server: product create/update normalise blank barcode to `NULL`; aliases stay unique per store (app check).
   - Migration: `UPDATE "Product" SET barcode = NULL WHERE barcode = ''` (idempotent, ≤1 row per store).
   - SaleItem/RefundItem/lot `barcode` columns stay `String` and keep receiving `""` for barcode-less lines (no schema change there).
2. **Stock policy (C2).**
   - `Product.stockPolicy` enum `tracked | untracked` (default `tracked`; migration adds the column with default — existing stores unchanged). Shared type + editor control ("Track stock" switch, off for drinks), shown in product list as a badge.
   - Till: stock gate in `POSPage.addProductToSale` and in `checkoutLocalSale` applies to tracked items only; untracked lines get no lot allocation and no local stock decrement.
   - Server: `decrementProductStock` / lot consumption skipped for untracked lines; still enforced for tracked lines in the same order; cost snapshot from `product.cost`.
   - Receiving/counts/low-stock/reorder/expiry ignore untracked items.
3. **Refund disposition (C3, minimal).** Refund of an untracked line never restores stock; tracked lines keep today's exact lot restoration.
4. **Feedback (C4).** Out-of-stock tap shows a visible inline message; translate the 4 POS strings.

**Acceptance criteria**
- [ ] UI: create 3 drinks with no barcode; all appear, searchable by name, with a "No barcode" badge, none with a fabricated code.
- [ ] Device → server: all 3 sync; no `Failed` op; server rows have `barcode IS NULL`.
- [ ] One order: Espresso ×2 (untracked, stock 0) + Pepsi ×1 (tracked, 10) → server `ok`; Pepsi 9; Espresso stock untouched; sale lines carry correct price/cost snapshots.
- [ ] Same order offline, then reconnect → applied once (lost-ack + retry test).
- [ ] Tracked item with stock 0 is still refused on till and server.
- [ ] Refund Espresso ×1 → money refunded, stock unchanged; refund Pepsi ×1 → stock 10, lot restored.
- [ ] Existing products default to `tracked`; mini-market suites unchanged (366 API / 399 desktop + new).
- [ ] en/ar parity; Midnight Gold tokens only; tablet and phone layouts checked.

**Tests:** flip C1/C2/C3 probes (CA, CD); new real-Postgres tests for mixed order, offline retry, hub→cloud forward, refund disposition; desktop unit tests for editor/cart gate; UI walk-through screenshots; installer smoke test on a disposable store.
**Recovery cases:** retry after lost response, restart between local commit and push, rejected tracked line inside a mixed order (must stay a visible money conflict, never silently dropped).
**Compatibility & rollout:** cloud first (schema + server), then hubs, then tills. An older till sending a drink sale to a new server works (server treats unknown policy as tracked → today's behaviour). A new till must not sell untracked items to an old hub → gate the switch behind the hub's reported version.
**Estimate:** 1 sprint (≈1–1.5 weeks).

## Sprint 2 — Trusted staff attribution and server-side pricing (must-have)

- Every sale/refund/void/discount/expense/movement records `actorId` from the unlocked session (device), plus `deviceId`; server stores both and labels them "device-asserted".
- Server reprices sale lines from the catalogue; a different price requires `sales.price_override` on the pushing account **and** an override reason; recorded per line (`listPrice`, `overrideReason`, `approvedById`). Product create/update/delete require `inventory.manage`.
- Cost/profit fields gated by a new `reports.cost` permission (UI + API); Cashier preset excludes it.
- Optional (PD): per-employee online tokens so the server authenticates the actor when online.

**Acceptance:** S3/S4 probes flip; Manager override accepted and audited; Cashier sees no cost/margin anywhere (route + component tests); old tills: phase 1 flags mismatches, phase 2 enforces.
**Migration:** additive columns on Sale/SaleItem/Refund. **Compatibility:** flag-then-enforce over one release.

## Sprint 3 — Modifiers and per-line notes (must-have for a café menu)

**Recommendation from code:** keep **variants** for things that are genuinely different products with their own price and (later) recipe — size (Small/Medium/Large) and Single/Double. Add **modifier groups** for options layered on any drink: milk (whole/skim/oat), sugar (none/1/2), hot/iced, extra shot (+$), syrup (+$), toppings, free-text note. This avoids dozens of duplicated products.

- Model: `ModifierGroup {id, name, nameAr, required, min, max, sortOrder}`, `ModifierOption {id, groupId, name, nameAr, priceDelta, available}`, product↔group link; `SaleItem.modifiers Json` snapshot `[{groupId, optionId, name, nameAr, priceDelta}]` + `note`.
- Cart: identical product + identical modifier set + note merge; otherwise separate lines. Line price = base + Σ deltas (server recomputes in Sprint 2 rules).
- Picker: one sheet, required groups first, defaults pre-selected, 48 px targets, "repeat last" button.
- Receipt/refund: modifiers printed under the line; refunds use the line's snapshot.

**Acceptance:** espresso + oat milk + extra shot priced correctly; two cappuccinos with different milk = 2 lines; historical receipts unchanged after menu edits; Arabic labels; refund of one modifier line capped correctly.

## Sprint 4 — Preparation ticket and order state (must-have, minimal)

Minimal café flow: **pay first, then prepare** (takeaway counter).
- On sale commit, lines of products flagged `needsPreparation` create a prep ticket (order number, lines + modifiers + note, staff, time).
- Prep list screen (tablet-friendly) on the hub: states `new → ready → collected`, plus `cancelled` with reason (requires `sales.void` for paid orders → goes through void/refund).
- Optional printed ticket (browser print, 58/80 mm) until ESC/POS exists.
- Tickets live on the hub (shared by tills on the LAN), sync to cloud for reporting.

**Optional later (not imposed):** pay-later tabs/tables, partial fulfilment, remake tracking, KDS bumping by station.

## Sprint 5 — Ingredients and recipes (optional / phase 2)

- `stockPolicy = recipe`: product consumes ingredients; `Ingredient` = product with `sellable=false` and a base unit (`g`, `ml`, `unit`); purchase units with conversion (1 kg = 1000 g); `RecipeLine {productId, ingredientId, quantity, unit, variant/modifier condition}`; recipe versions with effective dates.
- **Consumption point:** at sale commit (same transaction as the sale on the server; once per sale id → idempotent across retries/offline/hub/cloud). Cancellation before preparation = void (restores ingredients); after preparation = waste movement. Refund never restores ingredients (disposition `waste`/`none`).
- Ingredient lots/expiry via existing InventoryBatch with decimal quantities (needs `Decimal` precision review: `stock Float` today).
- Wastage reasons: spill, remake, staff drink, expired — stock adjustments with café reason codes.
- Opening inventory, receiving in pack units, counts in base units, reconciliation report (theoretical vs counted usage).
- Availability: optional "low ingredient" warning; never block a sale without a permission-controlled override (PD).

## Other tracks (scheduled separately)

| Track | Priority | Notes |
|---|---|---|
| Shift / daily-close / count durability journals | must-have before commercial release (existing blocker) | `STOCK-ACCOUNTING-REVIEW.md:334` |
| Cash rounding policy + dual-currency drawer counts | PD (owner) | `CASH-ROUNDING-POLICY-PROPOSAL.md:203-215` |
| Shared held orders / tabs across tills | optional | hub-owned order entity |
| Split tender | optional | multi-row SaleTender |
| ESC/POS printing, cash-drawer kick, prep printer per device | should-have | Electron IPC; device-level settings |
| Remove dead settings / simple-mode or wire them | cleanup | |

## Café configuration (target)

| Setting | Scope | Notes |
|---|---|---|
| Product stock policy (tracked/untracked/recipe) | per product | default tracked |
| Modifier groups and options | store | Sprint 3 |
| Needs preparation + prep destination | per product / per device | Sprint 4 |
| Receipt printer, paper width, prep printer | device | exists (receipt) / new (prep) |
| Currency, rate, rounding | store | rounding pending decision |
| Tax inclusive/exclusive | store | today `vatRate` added on top; PD for inclusive pricing |
| Staff role presets for café (Cashier, Barista = Cashier without `sales.checkout`? or Cashier with prep view) | store | no new roles needed: add `prep.view` permission |
| Shift rules | store | existing |

No "café mode" that only changes labels: every café behaviour above is a real setting on products, devices or permissions.

## Role / permission matrix (proposed, minimal)

| Responsibility | Preset | Key permissions |
|---|---|---|
| Cashier / order taker | Cashier | `sales.checkout`, `sales.reprint`, `inventory.view` (without cost), `prep.view` |
| Barista | Cashier (or custom) | `prep.view`, `prep.update`; no checkout if not needed |
| Supervisor / manager | Manager | + `sales.discount`, `sales.price_override`, `sales.refund`, `sales.void`, `shifts.manage`, `cash.manage`, `reports.view`, `reports.cost`, `inventory.manage` |
| Store Admin | Admin (exactly one) | all, incl. `staff.manage`, `settings.manage` |
| Platform owner / support | owner portal (`__admin__`) | tenant admin, PIN reset, Admin transfer; no store data access through store routes |

New permissions: `prep.view`, `prep.update`, `reports.cost`. No new roles.

## Recommended first café sprint

**Sprint 0 + Sprint 1 together** (security fixes are small and independent; Sprint 1 is the café blocker). After both, the verdict can move to **"ready for basic café use with restrictions"**: takeaway sales of untracked drinks and tracked packaged goods, cash/card, shifts, refunds — with no modifiers (use variants and the sale note), no prep tickets, no recipes, and staff attribution documented as device-asserted.

## Café menu, modifiers, recipes and ingredient stock — design (2026-11-01, implemented on `dev/staff-auth-approvals`)

This replaces the Sprint 3 and Sprint 5 sketches above. There are no preparation states, no shared tabs, no kitchen
screen, and no rounding change.

### Product kinds (existing abstractions only)

| Kind | `stockPolicy` | `sellable` | Stock and lots | Sold at the POS |
|---|---|---|---|---|
| Packaged item (Pepsi, chips) | `tracked` | true | its own lots, its own unit | yes (barcode optional) |
| Prepared drink using ingredients | `recipe` (new value) | true | none of its own; its recipe consumes ingredient lots | yes |
| Untracked prepared item | `untracked` | true | none | yes |
| Ingredient (beans, milk, syrup, cups) | `tracked` | **false** | its own lots in its stock unit | no (hidden from POS, Simple POS and delivery) |

- Barcodes stay optional for every kind.
- A drink is sellable because its ingredients are in stock, never because of a fake quantity: the drink's own `stock`
  stays 0. Availability = the servings its unconditional recipe lines can still make from open stock.
- Variants stay for genuinely different products. Modifier groups cover sizes, milk, sugar, shots and ice, so there
  is no catalogue product per combination.

### Units and precision

- Stock units: `unit`, `g`, `ml`. The stock unit is the base unit of the ingredient, its lots, counts, adjustments,
  waste and low-stock threshold.
- Purchase units convert only within one dimension: `kg→g ×1000`, `g→g`, `L→ml ×1000`, `ml→ml`, `pack→unit ×n`
  (n a whole number ≥ 1), `unit→unit`. Anything else (e.g. kg→ml) is refused before saving.
- Quantities are exact to 0.001 of the stock unit. Recipe quantities with more decimals are refused. A consumption
  (line quantity × sold quantity ÷ yield) is computed in integer thousandths and rounded half-up once. Lot and
  product quantities are written with a rounded SQL update, so repeated decrements cannot drift.
- Money: the receiving row keeps the invoice price exactly (`purchasePrice` per purchase unit). Valuation
  (`unitCost` per stock unit, 4 dp) is derived from it. Ingredient cost is computed with exact decimals from the
  invoice price of each lot actually consumed, then rounded to 4 dp once per line.

### Modifier groups

- `ModifierGroup`: stable id minted by the creator, EN/AR names, required, min/max, sort, archived, revision.
  Its options (stable ids; EN/AR names; price delta; default; available; archived) live inside it.
- Products list their groups in order (`modifierGroupIds`).
- Rules: a required group needs at least max(1, min); single choice = max 1; defaults pre-select. Archived or
  unavailable options cannot be chosen; they still exist, so old sales and refunds display them.
- Sale lines keep an immutable snapshot `modifiers[]` (group and option ids, names, price delta), `basePrice` and a
  preparation `note`. Line price = base + Σ deltas, in exact 4 dp money.
- Cart lines merge only when product, options, note and unit price are the same; otherwise they are separate lines.

### Recipes

- `RecipeRevision` rows are immutable. Each has an id minted once by whoever saves it, the product, a yield, a note,
  the attributed person, and lines `{ingredient syncId, quantity in stock units, when[], unless[] }`.
  - `when`: the line applies only if all those options are selected (size- or milk-dependent quantities, extra shot).
  - `unless`: the line is skipped if any of those options is selected (substitution: milk unless oat).
- The product points at its current revision (`recipeRev`). Saving a recipe adds a revision and moves the pointer;
  it never edits an old one.
- Sale lines carry `recipeRev` and the consumption the register computed. The authoritative server recomputes it
  from its own copy of that revision and records `consumption[]` (ingredient, quantity, the lots used with their
  cost) and a `costStatus` on the line: `known`, `partial`, `unknown`, or a real zero.

### Consumption and returns

- Ingredients are consumed in the transaction that commits the sale: same operation id, once, FEFO, with lots ordered
  by expiry, received date, then id. That ordering is deterministic, so a hub and the cloud consume the same lots.
- On the register, the drink's ingredient quantities join the existing checkout journal (lots, stock and movements),
  so an interrupted checkout that never committed is compensated exactly once by the existing recovery.
- A refund or void of a prepared drink returns money only. Recipe lines never restore ingredients; untracked lines
  never restore anything. Packaged lines keep the existing lot restoration.
- Remake and waste: a new permission-controlled stock event (`inventory/waste`, needs `inventory.adjust`; anyone else
  is held for review in an enforcing store). A drink with its options consumes its current recipe. One stock
  adjustment per ingredient (reason `Remake` or `Waste`), cost from the actual lots.
- Ingredient spills, expiry and counts use the existing adjustment and count flows, in stock units.

### Server authority, offline and mixed versions

- The authoritative server (the store's hub, or the cloud for a direct store) checks the following:
  - product identity, and that the product is sellable;
  - options belong to the product's groups and satisfy the rules;
  - unit price ≥ base + Σ known deltas, otherwise `sales.price_override` or a manager approval is needed (approvals
    bind to the whole line including options, because options are material fields of the command);
  - the recipe revision and the ingredient quantities;
  - actor and approval, as today;
  - the operation id, as today.
- Live checkout through a hub (`wt-`) is refused before payment when options are invalid or an ingredient is short.
- A queued sale (offline, or a direct register) is never refused for its options or price:
  - Invalid options are recorded on the line as `modifierConflict` and audited.
  - A revision the server does not know yet: the sale is held (`RECIPE_HELD:`) and retried. Nothing is applied. The
    register keeps it with the other held sales. If the revision never arrives, a manager with `inventory.manage`
    resolves the line on the register: either "made with the recipe recorded here" or "made with no ingredients
    recorded". The decision is audited, and every server then applies the same thing.
  - Today's recipe is never substituted silently.
- Ingredient shortfall on a queued sale: two registers that are both fully offline can consume the same scarce
  ingredient. Stock never goes negative, so the existing rule applies: the sale is not applied and is held for
  review (`INGREDIENT_SHORT:`, Held work, category stock). A manager counts or receives the ingredient, then applies
  it. The customer is never asked to pay again. There are no offline reservations.
- New sync schema 6 (registers and hubs):
  - Older registers do not receive recipe drinks or ingredients in their pulls, and cannot sell them.
  - Making a product a recipe drink is refused while a register or hub older than schema 6 still trades (the existing
    upgrade gate, threshold 6).
  - The cloud must be upgraded first.

### Authorization (existing permissions)

| Action | Permission |
|---|---|
| Menu, modifier groups, products, recipes | `inventory.manage` |
| Ingredient receiving | `inventory.receive` |
| Waste, remakes, counts | `inventory.adjust` |
| Price below base + options, sale at cost | `sales.price_override` (or manager approval) |
| Refunds | `sales.refund` |

Cashiers choose options with `sales.checkout` only. Checkout cannot edit recipes or costs. Cost and profit fields,
including `consumption` costs and lot invoice prices, are removed for staff without `reports.cost`.

### Delivery in hub stores (closing the topology boundary)

- Delivery changes stock at the cloud, so in a hub store it is refused at every boundary:
  - new customer orders (`DELIVERY_UNAVAILABLE`, before anything is recorded or paid);
  - stock-changing status changes by staff and drivers;
  - the delivery menu, which says delivery is unavailable.
- Recipe, untracked and ingredient products are not offered for delivery in any store.
- A delivery order's stock is taken once and given back at most once; an existing double decrement on
  Confirmed→OutForDelivery is fixed.
- Orders accepted before the store became a hub store are closed through an explicit, audited manager decision, with
  no cloud stock change.
- Readiness blocks changing to a hub store while delivery orders are open.

### Acceptance (2026-11-02, dev candidate `dev-06e545c`, never published)

Evidence and the requirement matrix: [SPRINT-2-ACCEPTANCE.md](SPRINT-2-ACCEPTANCE.md), "Batch: café drink modifiers,
recipes and ingredient stock". In short:

- A full café day passed on the final package (hub topology, loopback test cloud), from receiving through close and resume.
  - Hub and cloud agree line by line.
  - Lots are identical and waste is the same on both sides.
  - An offline sale kept its recipe revision.
- Policies chosen:
  - an offline shortfall is held for review under the existing negative-stock policy (never lost, never charged twice);
  - drink refunds and voids give no ingredients back; remakes and waste are recorded explicitly.
- Known limits:
  - offline ingredient oversell (held, not prevented);
  - older registers (schema < 6) do not see recipe drinks or ingredients, so upgrade the cloud first, then the hub, then
    the registers;
  - server-composed sentences stay English in Arabic.

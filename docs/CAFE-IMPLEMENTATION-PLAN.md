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

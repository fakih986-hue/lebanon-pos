# Café feature and test matrix

**Date:** 2026-10-29 · HEAD `7df7c58`. Companion to [CAFE-COMPATIBILITY-AUDIT.md](CAFE-COMPATIBILITY-AUDIT.md).

**Status values:** `passed` (exercised today, behaved correctly) · `failed` (exercised today, defect confirmed) · `blocked` (could not be exercised: hardware/environment) · `not tested` (exists, not exercised in this study) · `not implemented` (no code exists).
**Classification:** E = existing and working · D = existing but defective · P = partial · M = missing · PD = product decision required.

**Test methods:**
- **CA** — `apps/api/__tests__/cafe-audit.test.ts`: real API, real Postgres scratch DB, two disposable stores, staff tokens from the real login endpoint. 21 checks: 7 pass, 14 `it.fails` (confirmed defects).
- **CD** — `apps/api/__tests__/cafe-device.test.ts`: real desktop services + real API + real Postgres. 6 checks: 3 pass, 3 `it.fails`.
- **UI** — browser pane, desktop SPA (Vite) against the guarded local cloud (`scripts/it-cloud.mjs`), disposable store `cafecstt9`.
- **SUITE** — existing suites re-run today: desktop 399/399, API 366/366 (scratch DB).
- **CODE** — code inspection only (no execution) — never counted as tested.

## Inventory summary

| Area | Count | Source |
|---|---|---|
| Desktop routes | 14 + fallback (`/`, `/dashboard`, `/products`, `/stock`, `/sales`, `/customers`, `/accounting`, `/suppliers`, `/staff`, `/settings`, `/delivery`, `/delivery/drivers`, `/products/new`, `/products/count`→`/stock`) | `apps/desktop/src/routes/index.tsx:176-341` |
| Desktop dialogs/drawers | ~35 (POS: CartPanel/CartDrawer, PaymentReview, SaleComplete, VariantPicker, QuickPOSMode, ShiftSheet, CashDrawerPanel, ExpensePanel, KeyboardShortcuts; Products: details/editor drawers, BulkImport, CatalogCleanup, Alerts; Receiving recovery; Lots/StockControl/OpeningInventory/LedgerReconciliation; Supplier/Order/Payment drawers; Customer/Payment drawers; Receipt drawer, MoneyConflicts, Insights; CloseDay, CashFlow, Expenses, ShiftControl, History, RegisterReconciliation; Settings Rate/FirstSetup/ReceiptPrinter; ChangePin) | desktop inventory |
| Device mutation services | 17 modules, ~60 exported mutations | `apps/desktop/src/features/pos/services/*` |
| API endpoints | ~85 (auth 5, sync 8, setup 9, admin ~12, delivery ~22, images 7, reports 5, inventory 3, device 6, dashboard 1, list 3, health 1) | `apps/api/src/routes/*`, `app.ts` |
| Sync entities | 18 (sale, refund, product, customer, debt, expense, daily-close, supplier, purchase-order, supplier-payment, staff, shift, inventory, settings, delivery-order, cash-movement, held-sale + deletions) | `sync.ts:69-100, 1856-1879` |
| Permissions / roles | 19 permissions; presets Admin, Manager, Cashier, Driver | `security.service.ts:18-72,145` |

## A. Staff, access and identity

| Feature / workflow | Role | Entry points | Persistence / sync | Method | Expected | Observed | Evidence | Status | Class |
|---|---|---|---|---|---|---|---|---|---|
| Staff sign in with own PIN (online) | all | `auth.ts:108`, `LoginScreen.tsx` | JWT with tokenVersion | CA, UI | own token | works | CA `login()` for 3 roles; UI unlock 1501 | passed | E |
| Offline PIN = last verified only | all | `security.service.ts unlockWithPin` | localStorage users | SUITE | old PIN refused offline after reset seen | as expected | `device-durability` PIN reset suite | passed | E |
| Cashier cannot refund via sync | Cashier | `permissions.ts:87` | push | CA | refused | "You don't have permission to create refund" | CA | passed | E |
| Cashier cannot change roles/settings via sync | Cashier | `applyStaffWrite`, settings | push | CA | refused | refused | CA | passed | E |
| Cashier cannot change product price/cost | Cashier | product push, no server rule | push | CA | refused | **accepted** | CA probe | failed | D |
| Server enforces catalogue price / price override | Cashier | `sync.ts:1276-1282` | Sale | CA | reject $0.01 Pepsi | **accepted** | CA probe | failed | D |
| Sale attributed to actual cashier (id) | Cashier | `sales.service.ts:415` | Sale.cashier | CD | `cashierId` of unlocked user | **name only** | CD evidence | failed | D |
| Cashier cannot record a sale as another person | Cashier | `sync.ts:1279` | Sale | CA | refused | **accepted** | CA probe | failed | D |
| Shift opener must be allowed to open | any | `recordedActorRule` | Shift | CA | driver-only opener refused | refused | CA | passed | E |
| Shift opened on device attributed to unlocked user | Cashier | `openShift` | Shift.openedById | CD | cashier id | cashier id | CD evidence | passed | E |
| Cost/profit hidden from Cashier | Cashier | reports routes, ProductTable | — | CA, CODE | 403 / hidden | **200**; columns visible behind `inventory.view` | CA probe; `ProductTable.tsx:17-19` | failed | D |
| Cashier cannot read colleagues' PIN hashes | Cashier | `sync.ts:595` | pull | CA | no hashes | **all hashes** | CA probe | failed | D |
| Cashier cannot approve devices | Cashier | `device.ts:29` | Device | CA | 403 | **200** | CA probe | failed | D |
| Cashier cannot create driver logins | Cashier | `delivery.ts:117` | StaffUser | CA | 403 | **201** | CA probe | failed | D |
| Last Admin cannot be removed; atomic transfer | Admin/owner | `applyStaffWrite`, `transferStoreAdmin` | StaffUser | SUITE | per v1.0.50 | as expected | `staff-release`, `one-admin` | passed | E |
| PIN reset / deactivation / revocation propagate | owner | admin routes, pull | tokenVersion | SUITE | sessions revoked | as expected | `staff-release`, `staff-stale` | passed | E |
| Pending offline work survives revocation | Cashier | queue | SyncOperation | SUITE (Oct installer test) | kept | kept | 1.0.50 installer report | passed (Oct) | E |
| Lock / switch user / restart keeps cart | Cashier | POSPage state | **React state only** | CODE | cart persisted | cart is not persisted (lost on reload) | `POSPage.tsx:94` | not tested | P |
| Shift handover between employees | Cashier→Cashier | ShiftSheet, `canCloseShift` | Shift | CODE | documented flow | close requires opener or `shifts.manage` | `security.service.ts:908-913` | not tested | P |

## B. Products and optional barcodes

| Feature / workflow | Role | Entry points | Persistence / sync | Method | Expected | Observed | Evidence | Status | Class |
|---|---|---|---|---|---|---|---|---|---|
| Create drink with no barcode in UI | Manager | `ProductEditorDrawer.tsx:59` | Product | UI | allowed | **"Enter or generate a barcode."** | `evidence/cafe/01-…jpg` | failed | D |
| Several products with `barcode = NULL` (server) | — | `sync.ts:1059` | Product | CA | distinct | 3 created | CA | passed | E |
| Several products with `barcode = ""` (what the till sends) | — | `product.service.ts:590`, unique index | Product | CA, CD | distinct | **2nd fails `Unique constraint (tenantId, barcode)`; stays Failed** | CA, CD evidence | failed | D |
| Stable identity (`syncId`) separate from numeric id | — | `product.ts:5-15`, `@@unique([tenantId, syncId])` | Product | CODE, SUITE | yes | yes | sync suites | passed | E |
| Barcode alias uniqueness | Manager | `product.service.ts:593-604` | app-level only | SUITE | unique per store | app-level check; no DB constraint | existing alias tests | passed | P |
| Archived product keeps history | Manager | `archiveProduct` | `archived` flag | CODE | history kept | delete = archive on server | `sync.ts` product delete | not tested | E |
| Drink without barcode found/sold/refunded/synced | Cashier | POS → checkout → sync | Sale | UI, CD | works | **cannot be created (UI); blocked at stock; rejected by server** | UI 02/03, CD | failed | D |
| Untracked item not blocked by stock | Cashier | `POSPage.tsx:359`, `inventory.ts:7-18` | — | UI, CD, CA | sells | **blocked (UI); rejected (server) after local completion** | CD, CA | failed | M |
| Packaged goods obey stock and FEFO/expiry | Cashier | `consumeInventoryBatches`, server FEFO | InventoryBatch | SUITE, CA | decremented | Pepsi 10→9 | CA; `refund-integrity` | passed | E |
| Missing image/category/supplier/lot doesn't crash checkout | Cashier | POS | — | CA (no image/supplier/lot) | sells | sells | CA mixed order | passed | E |
| Product types (tracked/untracked/ingredient/recipe) | — | — | — | — | — | — | — | not implemented | M |

## C. Drink menu and modifiers

| Feature | Status | Class | Notes |
|---|---|---|---|
| Single/double, small/large via variants | not tested (exists) | P | `parentId`/`variantName`, VariantPicker `POSPage.tsx:351-353`; each variant is a separate stock-tracked product → inherits C1/C2 |
| Option groups (milk, sugar, hot/iced, extra shot, toppings), required/optional, min/max, defaults, price adjustments | not implemented | M | no model |
| Per-line preparation note | not implemented | M | sale-level note only |
| Same drink, different modifiers = separate lines | not implemented | M | cart merges by product id |
| Historical snapshot of modifiers/prices | partial | P | SaleItem snapshots name/price/cost; nothing for options |
| Modifiers on cart / receipt / prep ticket | not implemented | M | |
| Arabic labels / long names | passed (layout) | E | product names render in RTL; POS chrome partly untranslated (C4) |
| Fast repeat ordering | not tested | P | Favorites bar + Quick mode exist |

## D. Ingredients, recipes and costs

| Feature | Status | Class |
|---|---|---|
| Recipes / BOM, ingredients in g/ml/units, purchase-unit conversion, yield, versioning | not implemented | M |
| Size/modifier-dependent consumption | not implemented | M |
| Ingredient lots/expiry | not implemented (lots exist for products) | M |
| Sale-time cost snapshot | passed for products (SaleItem.cost) | E |
| Wastage / staff drinks / remakes | partial — stock adjustment with reason exists (`recordStockAdjustment`); no café reasons | P |
| Consumption once across retries/offline/hub/cloud | passed for product stock (sync idempotency suites) | E |

## E. Order taking and preparation

| Feature | Status | Class | Notes |
|---|---|---|---|
| Quick takeaway sale | passed (packaged / placeholder-stock drink) | P | blocked for real drinks by C1/C2 |
| Held cart restore on same device | not tested | E | `heldSale.service.ts` |
| Held cart retrieved by another till/user | **not implemented** | M | sync op has no server effect (`sync.ts:1808`), nothing pulls it |
| Shared open tab / table order / add to existing order | not implemented | M | |
| Order numbers & staff ownership | partial | P | sale numbers not unique by design; attribution by name (S4) |
| Preparation ticket/screen, states new→preparing→ready→collected, cancel reasons, remakes | not implemented | M | only delivery orders have statuses |

## F. POS and checkout

| Feature | Method | Status | Class | Notes |
|---|---|---|---|---|
| Tap product / scan packaged item / mixed order | CA, UI | passed (tracked items) | E | drinks blocked (C2) |
| Quantity change, remove line, clear-cart confirmation, notes | CODE | not tested | E | |
| Discounts (sale level) need `sales.discount` (pushing account) | CODE | not tested | P | only sale-level; bypassable via unitPrice (S3) |
| Cash/card/wallet/debt | SUITE | passed | E | one tender per sale; no split |
| Double tap / repeated Enter / lost response after commit / reload | SUITE | passed | E | `device-durability`, `sync-dedupe` |
| Next-customer scan focus | CODE | not tested | E | `useBarcodeScanner.ts:56-65` refocuses |
| Rounding (cash payable rounded up to 5 000 LBP) | CODE / docs | not tested (unchanged by request) | PD | `CASH-ROUNDING-RECONCILIATION.md:107-108`; drawer closes over by rounding |
| Full POS vs Simple POS | UI, CODE | partial | D | "Simple mode" flag unused; Quick mode is a local toggle |

## G. Shifts, cash and accounting

| Feature | Method | Status | Class |
|---|---|---|---|
| Opening float, own vs other's shift close rule | SUITE, CD, UI | passed | E |
| Cash in/out, expenses permission-checked (device + server, named actor) | SUITE | passed | E |
| X/Z agreement; concurrent Z close (1 of 10 wins) | SUITE (`z-report-close`) | passed | E |
| Card/wallet/debt do not move expected cash | docs + SUITE | passed | E |
| Interrupted close / restart; pending offline ops at close | — | not tested (documented blocker) | D |
| USD and LBP physical balances counted separately | — | not implemented (plan only) | M / PD |

## H. Refunds, voids, cancellations

| Feature | Method | Status | Class |
|---|---|---|---|
| Full / repeated partial, per-line caps, original rate, lot restore, concurrency, idempotency | SUITE (`refund-integrity`) | passed | E |
| Two lines of same product, different price | SUITE (lineId) | passed | E |
| Refund permission (pushing account) | CA | passed | E |
| Prepared drink refund does not restore stock | CA | **failed** (stock +1) | D |
| Financial vs physical disposition | — | not implemented | M |
| Rejected offline refunds visible; conflict settlement | SUITE | passed | E |

## I. Receiving, suppliers, counts

| Feature | Method | Status | Class |
|---|---|---|---|
| Packaged receiving, lots, recovery, retries, store switch | SUITE (existing receiving/recovery tests) | passed | E |
| Ingredient purchase with pack→unit conversion | — | not implemented | M |
| Existing product without barcode in receiving | — | not tested (blocked by C1) | D |
| Stock count completion durability | — | not tested (documented blocker) | D |

## J. Offline, sync, tenant isolation

| Feature | Method | Status | Class |
|---|---|---|---|
| Durable queue, lost ack, duplicate op, reused op id with altered payload | SUITE (`sync-dedupe`, `sync-stress`, `device-durability`) | passed | E |
| Restart race (late answer cannot overwrite settled op) | SUITE (`syncRestartRace`) | passed | E |
| Sync pull scoped to token store | CA | passed | E |
| `/api/products|customers|sales?tenantId=` cross-store | CA | **failed** | D |
| Unauthenticated diagnostics | CA | **failed** | D |
| Public image by bare product id | CA | **failed** | D |
| Installed hub + LAN till, café flows | — | not tested this study (staff/offline tested 2026-10-19/20) | — |
| Mixed 1.0.49/1.0.50 for sales | — | not tested | — |

## K. Hardware and printing

| Feature | Status | Class |
|---|---|---|
| Keyboard-wedge / Bluetooth scanner | blocked (no hardware) | E (software path exists) |
| Camera scanning | not tested | E |
| 58/80 mm receipt via browser print | not tested in hardware; CSS exists | P |
| Prep tickets, ESC/POS, cash-drawer kick | not implemented | M |
| Sale success independent of print failure | CODE: print is after commit in a separate window | not tested | E |

## L. Design and usability

| Check | Method | Status |
|---|---|---|
| Desktop 1024, tablet 768, phone 375 without horizontal overflow | UI (`scrollWidth == clientWidth`) | passed |
| Arabic RTL | UI | passed (layout); failed (4 untranslated POS strings) |
| Out-of-stock tap feedback | UI | failed (no visible message) |
| Staff identity and shift visible in top bar | UI | passed |
| Dark/light, offline fonts | not re-tested (prior design QA) | not tested |

## M. Settings and onboarding

| Check | Status | Class |
|---|---|---|
| Every setting mapped to a consumer | done (CODE) | — |
| Dead settings: `whatsAppDriverEnabled`, `assignMode`, `assignTimeout`, `defaultDriverId`, simple-mode flag | found | D |
| Store-wide vs device settings | partial: receipt printer and rate meta are per device; everything in `AppSettings` is store-wide | P |
| Café configuration (product types, modifiers, prep destinations) | not implemented | M |

# Café compatibility audit — Titan POS

**Date:** 2026-10-29 · **Scope:** a small café selling prepared drinks (no barcode) and packaged goods (scanned) in the same order. Gaming stations, hourly billing and PC control are out of scope.
**Status of this document:** findings and evidence only. Nothing in the product was changed by this study. Companion documents: [CAFE-FEATURE-TEST-MATRIX.md](CAFE-FEATURE-TEST-MATRIX.md), [CAFE-IMPLEMENTATION-PLAN.md](CAFE-IMPLEMENTATION-PLAN.md).

## Status update (2026-10-29, after Sprint 0 and Sprint 1 — local only, not deployed)

| Finding | Status | Where |
|---|---|---|
| S1 cross-store read, S2 PIN verifiers, S3 catalogue/price authorization, S5 gaps | **Fixed locally** | [SPRINT-0-SECURITY.md](SPRINT-0-SECURITY.md) |
| Pre-existing: a full pull wiped every till's offline PIN verifiers | **Found and fixed** in Sprint 0 | same |
| C1 barcode-free products, C2 untracked drinks, C3 drink refunds, C4 feedback and Arabic labels | **Fixed locally** | [SPRINT-1-CAFE.md](SPRINT-1-CAFE.md) |
| Barcode-free products duplicated after a pull; device dropped the line's stock-policy snapshot | **Found during Sprint 1 and fixed** | same |
| S4 authenticated staff attribution | Open (Sprint 2) — still an expected-failure probe | plan |
| Modifiers, preparation tickets, recipes, shared tabs | Not built (Sprints 3–5) | plan |

**Verdict after Sprint 0 + 1 (once deployed): ready for basic café use with restrictions** — takeaway sales of barcode-free made-to-order drinks next to scanned packaged goods, cash/card, shifts, refunds. Restrictions: no modifiers (use variants and the sale note), no preparation tickets, staff attribution is device-asserted, hubs must be on the new version before selling untracked items through them, and physical printers/scanners/drawers remain unvalidated.

The findings below are the original audit (before these sprints).

## 0. Verified baseline

| Item | Evidence |
|---|---|
| Live checkout | `D:\Claude project\6.3.2026\v4\lebanonpos`, branch `master`, HEAD `7df7c58` = `origin/master`. Only untracked folders dirty (`.claude/skills`, `.superdesign`, `docs/design/qa/*`, `apps/api/till`, stray `1)`); left untouched. |
| Old checkout | `D:\Claude project\lebanonpos` at `af009a4` (unrelated, stale). Not used. |
| Latest release | GitHub `v1.0.50` (Latest, tag at `7df7c58`, 2026-10-19 22:16 UTC). |
| Deployed revision | Production (`pos.titan-suite.net`) serves `assets/index-BQvOf4kG.js` + `index-1znPWlJx.css`, byte-identical names (content hashes) to a clean build of `7df7c58`. Railway CLI is logged out today, so the deployment record itself was not re-read. |
| Builds | `tsc -b` (desktop), `tsc -p .` (owner), `tsc --noEmit -p .` (api): all exit 0. |
| Existing tests | Desktop 399/399 pass. API 366/366 pass against the local scratch database `lebanonpos_refund_it`. |
| Test isolation | All real-database tests used the local scratch database; the UI walk-through used the fail-closed launcher `apps/api/scripts/it-cloud.mjs` (allowlisted scratch DB, no sync bridge, no `apps/api/.env`). No production URL, credential or record was used or touched. |

## 1. Executive assessment

**Verdict: NOT READY for café use until four blockers are fixed.** Two are café-specific (a prepared drink cannot be created or sold correctly), two are platform security defects that affect every store in production today and should be fixed first regardless of the café.

The parts a café would rely on most — shifts, cash drawer, refunds with line identity, lot-tracked packaged stock, offline queue durability, one-admin and PIN-reset rules — are real, tested and work. The product is built as a **retail mini-market POS**: every sellable item is assumed to be a stock-counted, barcoded product. A café's core item (a drink made to order) breaks three of those assumptions at once.

| # | Blocker | Severity | Café-specific? |
|---|---|---|---|
| **C1** | A product cannot be created without a barcode in the UI; when the till sends several barcode-less products, only the first one ever reaches the server | Critical | Yes |
| **C2** | Every sold item must have stock ≥ quantity, on the till and on the server. A drink with no stock count cannot be added to the cart; if it is, the server **rejects the whole order after the till took the money** | Critical | Yes |
| **S1** | Any signed-in staff member of store A can read store B's products, customers and sales by adding `?tenantId=` | Critical | No — all stores |
| **S2** | Any signed-in staff member (a Cashier) can download every colleague's PIN hash through sync pull (4–6 digit PINs are brute-forced offline in seconds) | Critical | No — all stores |

Today a café could only operate by **fabricating barcodes** for drinks and **receiving a fake stock quantity** (e.g. 10 000 espressos). That works mechanically but violates the brief (no fabricated barcodes), produces meaningless stock and cost reports, and refunds silently add drinks back to stock.

## 2. What a café can do today (verified)

- Sell scanned packaged goods with FEFO lot consumption, expiry and cost per lot (existing refund-integrity / stock tests, re-run today).
- Sell a **drink that has been given a barcode and a placeholder stock** in the same order as a scanned Pepsi — the server accepts it and decrements both (`cafe-audit.test.ts` "a packaged item … placeholder stock also sells").
- Open/close shifts with an opening float, cash in/out, expenses, X/Z reports with a concurrency-safe Z close (existing `z-report-close`, `shift-cash-permissions` suites).
- Refunds: full and repeated partial, per-line caps, original exchange rate, lot restoration, void-after-refund refused (existing `refund-integrity` suite, 366/366 today).
- Staff: personal PINs, roles Admin/Manager/Cashier/Driver, 19 permissions, one active Admin, atomic Admin transfer, PIN reset propagation, stale-edit protection (v1.0.50 work; `staff-release`, `staff-stale`, `one-admin` suites).
- Offline: durable queue, journaled checkout/void/refund/adjustment, lost-acknowledgement and restart recovery (`device-durability`, `sync-dedupe`, `sync-stress`).
- English/Arabic with RTL, dark/light, desktop/tablet/phone layouts without horizontal overflow (UI walk-through, §6).
- Variants (parent/child products) with a picker in the POS — usable for "single/double" or "small/large" as separate sellable children.

## 3. Confirmed defects

Reproductions are in `apps/api/__tests__/cafe-audit.test.ts` (server, two disposable stores, staff signed in through the real login endpoint) and `apps/api/__tests__/cafe-device.test.ts` (real desktop services + real API + real Postgres). In both files `it.fails(...)` marks a confirmed defect: the test passes while the defect exists and turns red when it is fixed. Run with a scratch `DATABASE_URL` only.

### C1 — Products without a barcode (Critical, café blocker)

- **Where:** `apps/desktop/src/features/pos/components/backoffice/ProductEditorDrawer.tsx:59` (`if (mode === "create" && !b) e.barcode = t("inv.err.barcode")`); `apps/desktop/src/features/pos/services/product.service.ts:590-640` stores and sends `barcode: ""`; `apps/api/prisma/schema.prisma:196,216` (`barcode String?`, `@@unique([tenantId, barcode])`); server create `apps/api/src/routes/sync.ts:1059-1062` stores `""` as-is.
- **Trigger:** create "Espresso" with no barcode in Products → Add product. Or create two barcode-less products on a till (bulk import, receiving follow-ups).
- **Expected:** a product's identity is its `syncId`; barcode optional; any number of products without one.
- **Actual:**
  - UI refuses: "Enter or generate a barcode." (screenshot `evidence/cafe/01-add-product-requires-barcode.jpg`).
  - Through the service (`cafe-device.test.ts`): Espresso syncs; Cappuccino stays `Failed` forever with `Unique constraint failed on the fields: (tenantId, barcode)` — empty string is a real value for the unique index (NULL would not collide).
  - Server-direct (`cafe-audit.test.ts`): three products with `barcode: null` are fine; two with `""` collide.
- **Impact:** a café cannot represent its menu honestly. The second barcode-less product never reaches the hub/cloud, so its sales are later rejected (C2 path) or mis-resolved.
- **Fix:** normalise empty/blank barcode to `NULL` on device and server (create and update), relax the editor rule, migrate existing `""` rows to `NULL` (at most one per store can exist today). Keep alias uniqueness per store in application code; consider a store-wide alias table later.
- **Verify:** flip the two `it.fails` probes; UI create of 3 barcode-less drinks; hub→cloud sync; search/sell/refund each; existing barcode tests.

### C2 — Untracked / made-to-order items are blocked by stock (Critical, café blocker)

- **Where:** till `apps/desktop/src/features/pos/pages/POSPage.tsx:359-363` (`if (product.stock <= 0) … out_of_stock; return`); server `apps/api/src/lib/inventory.ts:7-18` (`updateMany where stock >= qty`, else `Insufficient stock`); classified as a non-retryable rejection in `sync.ts`. No `trackStock` / product-type field exists anywhere (`schema.prisma` Product model).
- **Trigger:** sell an Espresso created with opening stock 0.
- **Actual:**
  - UI: the tile shows "Out of stock"; tapping it does nothing (no toast, cart stays empty) — `evidence/cafe/02-…jpg`, `03-…jpg`.
  - Device service path (`cafe-device.test.ts`): `checkoutLocalSale` **completes locally** (cash taken, receipt possible), then the server **rejects the entire sale** — including the in-stock Pepsi line — with `Insufficient stock for "Espresso": 0 available, 1 required`. The till now holds a sale the server will never have: a money conflict a manager must settle.
  - Server-direct: same rejection.
- **Impact:** prepared drinks cannot be sold without fake stock; any path that bypasses the UI gate turns into rejected money.
- **Fix:** introduce a product **stock policy** (`tracked` | `untracked`; later `recipe`), default `tracked` for existing products. Untracked items skip the stock gate on till and server, write no product stock and no lot allocation, and keep a cost snapshot from `product.cost`. Server must still enforce stock for tracked items.
- **Verify:** flip `it.fails` probes; drink + Pepsi order synced; Pepsi stock −1, drink stock untouched; offline sale then reconnect; refund of drink does not touch stock.

### S1 — Cross-store read via `?tenantId=` (Critical, all stores)

- **Where:** `apps/api/src/app.ts:89` (`/api/products`), `:119` (`/api/customers`), `:148` (`/api/sales`): `const tenantId = (req.query.tenantId as string) || req.auth!.tenantId`.
- **Trigger:** store A's Cashier token, `GET /api/products?tenantId=<store B id>`.
- **Actual:** HTTP 200 with store B's product ("B secret blend"), customer and sale rows (`cafe-audit.test.ts`, three `it.fails` probes; evidence log `200 | 1 rows`).
- **Impact:** any staff member of any store who learns or guesses another store's id reads its catalogue, customers (names, phones) and sales. Tenant ids appear in setup diagnostics (S5) and on devices.
- **Fix:** always use `req.auth.tenantId`; reject a mismatching query `tenantId` with 403 (support access belongs on `/api/admin/*`).
- **Verify:** flip probes; check every route for `req.query.tenantId` / `req.body.tenantId` (inventory below lists the remaining public delivery endpoints that take a tenant id by design).

### S2 — PIN hashes exposed to every signed-in staff member (Critical, all stores)

- **Where:** `apps/api/src/routes/sync.ts:595` (`staffUser.findMany` without `select`) and `/pull/full/users`; `GET /api/sync/pull` has no role check.
- **Trigger:** a Cashier signs in and calls `GET /api/sync/pull`.
- **Actual:** 200, `users[]` includes every staff member's `pin` hash, `pinVersion`, `tokenVersion`, permissions (`cafe-audit.test.ts` probe). Customer `pin` hashes are also included.
- **Impact:** a 4–6 digit PIN space is exhausted offline in seconds even with bcrypt; a cashier can recover the Admin's PIN and act as Admin. This undermines every staff-attribution and permission control.
- **Fix:** design decision needed (tills verify PINs offline today). Minimum: send PIN hashes only to an authenticated **device/hub** sync identity, never to a staff token; strip customer PINs; raise PIN length for Admin/Manager; add online lockout. Longer term: per-device offline verifier.
- **Verify:** probe flips; offline unlock still works on a paired till; hub still verifies.

### S3 — Server trusts prices and lets a cashier change catalogue prices (High)

- **Where:** sale create spreads the client payload `sync.ts:1276-1282` (no repricing; `unitPrice`, totals, cost, profit from the client); `requiredPermissionForOp` (`apps/api/src/lib/permissions.ts:76-99`) has no rule for `product` and none for price overrides (`sales.price_override` exists but is never enforced).
- **Actual (probes):** a Cashier's sale of Pepsi at $0.01 → `ok`; a Cashier's `product/update` setting price 0.1 and cost 0.01 → `ok`.
- **Impact:** an employee can under-ring sales or reprice the catalogue; margins and cost reports become untrustworthy.
- **Fix:** require `inventory.manage` for product create/update/delete on the server; reject (or flag for approval) lines whose price differs from the catalogue unless the pusher holds `sales.price_override`; record override reason/approver per line.
- **Verify:** probes flip; Manager override still accepted and audited.

### S4 — Staff attribution is a name string, not an authenticated identity (High)

- **Where:** device sale `cashier: currentUser.name` (`apps/desktop/src/features/pos/services/sales.service.ts:415`, refunds `:760`) — no `cashierId` on the device sale; server accepts any `cashier`/`cashierId` (`sync.ts:1279`); the pushing account is the store/hub token, not the employee (`permissions.ts:51-59` says so explicitly).
- **Actual:** device sale carries only `cashier: "Rana (cashier)"` (`cafe-device.test.ts`); a Cashier can push a sale naming the Owner (`cafe-audit.test.ts`). Shift `openedById`, cash-movement and expense `recordedById` are checked against the named person's permissions (works: driver-only opener refused), but still client-asserted.
- **Impact:** reports "per employee" are only as honest as the till; handover disputes cannot be settled from data.
- **Fix:** always record `cashierId`/`actorId` from the unlocked session; the server stores the device id + named actor and, where an employee token exists, the authenticated actor. Document clearly that offline attribution is device-asserted. See plan Sprint 2.

### S5 — Other authorization gaps found by probe (High/Medium)

| Gap | Where | Probe result |
|---|---|---|
| Cashier reads margin/cost/debt reports | `apps/api/src/routes/reports.ts:45-466` (requireAuth only) | `/api/reports/margin` → 200 |
| Cashier approves new devices | `apps/api/src/routes/device.ts:29` | `/api/device/generate-code` → 200 |
| Cashier creates a driver login for the store | `apps/api/src/routes/delivery.ts:117` | `/api/delivery/drivers` → 201 |
| Unauthenticated diagnostics (tenant id, counts) | `apps/api/src/routes/setup.ts:518` | 200 without token |
| Public product image by bare id | `apps/api/src/routes/delivery.ts:933` | served for another store's product |
| Cost/margin visible to Cashier in back office | `ProductTable.tsx:17-19,138,243` behind `inventory.view` (Cashier preset has it) | code inspection |

### C3 — Refunding a prepared drink returns it to stock (Medium)

- **Where:** refund handler restores lots/stock for every refunded line (`sync.ts:1300-1433`).
- **Actual:** refund of 1 Espresso → product stock +1 (`cafe-audit.test.ts` passes on this assertion).
- **Impact:** with placeholder stock the error is invisible; with real ingredients (future) it would be wrong. A financial refund and a physical return are not separated.
- **Fix:** refund lines carry a disposition (`restock` | `waste` | `none`); default `none` for untracked/recipe items, `restock` for packaged; waste recorded as a movement.

### C4 — Other café-relevant defects (Low/Medium)

| Defect | Where | Impact |
|---|---|---|
| Tapping an out-of-stock tile gives no visible feedback | `POSPage.tsx:359-363` sets only the scanner status line | staff think the screen froze |
| POS strings not translated in Arabic: "All Items", "Favorites", "Scanner ready.", "Star products to pin…" | `POSPage.tsx:233`, `components/FavoritesBar.tsx:30` | mixed-language register (`evidence/cafe/06-pos-arabic-rtl.jpg`) |
| "Simple mode" setting is dead code; the Cashier "always simple" rule is not applied | `security.service.ts:915-945` (no UI consumer) | misleading; Quick mode is a separate, unpersisted toggle |
| Delivery/assignment settings saved but never read (`whatsAppDriverEnabled`, `assignMode`, `assignTimeout`, `defaultDriverId`) | `settings.service.ts` / `SettingsPage.tsx` | dead settings |
| Held sales are device-local; the sync op has no server effect and nothing pulls them | `heldSale.service.ts`, `sync.ts:1808` | an open tab cannot move to another till or survive a device change |

## 4. Missing capabilities (not defects — not built)

| Capability | State | Notes |
|---|---|---|
| Product types (tracked / untracked / ingredient / recipe) | Missing | see C2 |
| Modifiers (milk, sugar, extra shot, size, hot/iced, notes) | Missing | Variants exist; no option groups, no per-line note, no per-line modifiers on SaleItem |
| Recipes / ingredients / units of measure / conversions | Missing | `stock Float` only; no unit field |
| Preparation tickets / screen / order states | Missing | Only delivery orders have `Preparing` |
| Shared open orders / tabs / tables | Missing | held sales are local only |
| Line-level discount, override reason/approver | Missing | sale-level `discountTotal` only |
| Split tender (several methods in one sale) | Missing | one `SaleTender` per sale |
| Thermal printing (ESC/POS), cash-drawer kick, prep printer | Missing | browser `window.print()` with 58/80 mm CSS only |
| Shift / daily-close / stock-count durability (journals) | Open blocker (documented in `STOCK-ACCOUNTING-REVIEW.md:334`) | not re-tested in this study |
| Cash rounding policy | Pending owner decision (`CASH-ROUNDING-POLICY-PROPOSAL.md:203-215`) | rounding left unchanged |

## 5. Staff and security model (as built)

- **Identity chain:** cloud (owner portal, staff rows, bcrypt PINs) → Electron hub (local Postgres mirror, pulls staff incl. hashes) → LAN till (SPA served by hub; caches users incl. hashes in localStorage; verifies PIN online first, offline against the last verified PIN version) → offline PIN cache.
- **Two identities are mixed:** the **sync identity** (store/hub/device token — what the server authenticates) and the **acting employee** (named in the record — client-asserted). Server permission checks run on the sync identity; four record fields (shift opener/closer, cash-movement and expense recorder) are additionally checked against the named person. Sale/refund cashier is not checked.
- **Agreements:** UI route gates and service checks agree for refunds, voids, cash movements, expenses, shifts, supplier edits, staff changes. **Disagreements:** product create/update, supplier create, purchase orders, supplier payments, debt payments, stock counts, adjustments, daily close have no service-level permission check on the device (UI gate only) and, except daily close/supplier paths, no server rule either.
- **v1.0.50 guarantees (verified in October and re-run today):** one active Admin; Admin cannot be demoted/deactivated from a device; atomic transfer; PIN reset and access changes revoke sessions; stale offline edits rejected visibly; pending business operations survive revocation.
- **Offline limits:** a till offline accepts only the last PIN verified on it; revocation reaches it only when it reconnects; attribution offline is device-asserted.

## 6. Screens reviewed (Midnight Gold)

Disposable store on the guarded local cloud, desktop SPA in the browser pane:
`01-add-product-requires-barcode.jpg`, `02-pos-drink-out-of-stock.jpg`, `03-pos-tap-drink-no-effect.jpg`, `04-pos-tablet-768.jpg`, `05-pos-phone-375.jpg`, `06-pos-arabic-rtl.jpg` (all in `docs/evidence/cafe/`). No horizontal overflow at 375 / 768 / 1024 px; RTL mirrors correctly; category chips scroll on phone; the Pay bar is reachable on tablet/phone. Screenshots show layout, not business correctness — the correctness claims above rest on the test files.

## 7. Untested or blocked

- **Blocked (no hardware):** keyboard-wedge/Bluetooth scanners, thermal printers (58/80 mm), cash drawer, real touch screens. Browser print renders are not printer validation.
- **Not re-tested in this study:** installed Electron hub + paired LAN till for café flows (the October 1.0.50 installer test covered staff/auth/offline only); shift/daily-close/count durability under interruption (documented open blocker); dual-currency drawer counting (plan only); store switching with pending journals; mixed 1.0.49/1.0.50 clients for sales.
- **Not testable (not implemented):** modifiers, recipes, preparation flow, shared tabs, split tender, line discounts.

## 8. Existing-store and mixed-version risks

- Normalising `""` barcodes to `NULL` is a data migration; at most one `""` row per store exists today, so it is safe and reversible.
- Adding a stock policy must default existing products to `tracked` so mini-market stores are unchanged.
- Fixing S2 changes what tills receive on pull: hubs and tills must upgrade together or offline unlock breaks; ship as hub-first with a compatibility window.
- Fixing S3 (server repricing) can reject sales from older tills that apply local price edits; roll out as "flag, then enforce".
- Old clients (≤1.0.49) do not send `roleVersion`; their staff access edits are already refused (by design since 1.0.50).

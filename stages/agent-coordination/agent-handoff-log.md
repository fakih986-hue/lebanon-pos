# Agent Handoff Log - UI/HR Design Transfer Sprint

**Date:** 2026-07-06
**Phase:** Design extraction + planning (no implementation)
**Status:** Approved with corrections. Proceeding to POS-UI-1.

---

## 2026-07-09 — OpenCode (DeepSeek V4) — Sprint POS-COMM-9 (Commercial Gap Audit) — COMPLETE

**Audit:** Wrote `stages/ux-ui/pos-commercial-gap-audit-after-comm8.md`

**Key findings:**
- Commercial readiness score: **72/100**
- 20 remaining gaps ranked P0/P1/P2 — verified in code, not speculative
- Top P0: sale review missing, offline banner missing, edit modal not drawer, no FEFO expiry chips, no inline POS customer create, no open float explanation
- Top P1: product card stock badges missing, 4 monolithic pages, no loading skeletons, no driver assignment UI
- Top P2: no manager approval, cash rec not persisted, no promise-to-pay, no responsive layouts

**Recommended next 3 sprints (recommended implementation order):**
- **Sprint A**: POS Checkout Commercial Finish (sale review, offline banner, card badges, refund wizard) — P0
- **Sprint B**: Products + Inventory Structural Split (drawer, FEFO chips, loading skeletons, Tools menu) — P0+P1
- **Sprint C**: Owner Dashboards + Data Visibility (payment mix, license status, batch preview, driver assign, shift audit) — P1+P2

**12 files identified as stable — no further work needed** (sales, product, inventoryBatch, sync, customer, supplier, currency, security, dailyClose services + TenderPanel, WorkspaceTabs, AlertsPanel, CloseDayPanel)

**Verdict: Ready for stronger implementation sprints. No code changed (audit only).**

---

## 2026-07-09 — OpenCode (DeepSeek V4) — Sprint POS-COMM-8 (Settings/System Hardening) — COMPLETE

**Sync health status badges:**
- Failed count badge (rose) appears when `syncStatus.failed > 0`
- Pending count badge (amber) appears when `syncStatus.pending > 10`
- Badges shown inline in the Offline Sync section header

**Accessibility:**
- `aria-label` on storeName input ("Store name"), Business Save button ("Save business settings"), Delivery Save button ("Save delivery settings")
- `aria-describedby` on storeName input linking to error message (`id="storeName-error"`)
- `aria-label` on all key inputs and action buttons across Business/Delivery/Security/Cloud sync/Backup tabs

**Preserved behavior:** No changes to tax, money, sync, license, export, or backup logic.

**Files changed:**
- `apps/desktop/src/pages/settings/SettingsPage.tsx` (+22/-12: sync health badges, aria-labels, aria-describedby)

**Regression checks:**
- Desktop typecheck: PASS
- Desktop tests: **70/70 PASS**
- Desktop build: PASS (2.47s)

**Verdict: PASS**

---

## 2026-07-09 — OpenCode (DeepSeek V4) — Sprint POS-COMM-7 (Delivery/Drivers Polish) — COMPLETE

**DeliveryPage (Orders):**
- Order cards now keyboard-accessible: `role="button"`, `tabIndex={0}`, `aria-expanded`, `onKeyDown` (Enter/Space)
- `aria-label` on each card: "Order {number} for {customer} — {status}"
- `aria-label` on search input, status filter select, refresh button
- `aria-label` on action buttons: "Mark {order} as {status}", "Cancel order {order}"
- `aria-hidden="true"` on chevron icons (decorative)
- "Unassigned" warning chip on orders with no driver assigned (when status is not Delivered/Cancelled)

**DriversPage:**
- `aria-pressed` + `aria-label` on active/inactive toggle button ("{name}: Active/Inactive")
- `aria-label` on edit button ("Edit {name}")
- `aria-expanded` on Add/Edit form toggle button
- `id="driver-form-title"` on form heading for `aria-labelledby` association

**Deferred:** Driver assignment UI (requires cross-tab state sharing + backend endpoint), delivery map/GPS tracking

**Regression checks:**
- Desktop typecheck: PASS
- Desktop tests: **70/70 PASS**
- Desktop build: PASS (2.70s)

**Files changed:**
- `apps/desktop/src/pages/delivery/DeliveryPage.tsx` (+14/-3)
- `apps/desktop/src/pages/drivers/DriversPage.tsx` (+8/-3)

**Verdict: PASS**

---

## 2026-07-09 — OpenCode (DeepSeek V4) — Sprint POS-COMM-6 (Dashboard / Owner Command Center) — COMPLETE

**Action queue — unified and actionable:**
- Now draws from 5 real data sources: low stock products, overLimit customers, overdue customers, dead stock items, operational alerts (license grace, failed sync)
- Sorted by money-at-risk (descending): overLimit/overdue debt → dead stock value → low stock → sync/license alerts
- Clickable items navigate to resolution pages (`/customers`, `/products`, `/settings`)
- `getOperationalAlerts` (previously unused) now wired into dashboard
- `getDeadStockItems` (previously unused) now wired into dashboard
- "All clear" success empty state with green checkmark icon (was neutral text)

**Daily close status — 5th KPI card:**
- Shows "Day open" with amber indicator or "Day closed" with green checkmark
- Links to close from Accounting page
- Grid updated from xl:grid-cols-4 to sm:grid-cols-3 xl:grid-cols-5

**Accessibility:**
- `aria-pressed` on date range buttons (Today/Week/Month)
- `aria-label` on all 5 KPI cards (label + value)
- `aria-label` on all action queue items
- Action queue linked items use React Router `<Link>` for keyboard accessibility

**No changes to:** Money math, accounting, customer debt, inventory, delivery, sync logic, backend/schema

**Regression checks:**
- Desktop typecheck: PASS
- Desktop tests: **70/70 PASS**
- Desktop build: PASS (2.50s)

**Files changed:**
- `apps/desktop/src/pages/dashboard/DashboardPage.tsx` (+65/-50: unified action queue, daily close card, operational alerts, dead stock, aria-labels, aria-pressed)

**Verdict: PASS**

---

## 2026-07-09 — OpenCode (DeepSeek V4) — Sprint POS-COMM-5 (Accounting/Cash Drawer Hardening) — COMPLETE

**CloseDayPanel:**
- Fixed closeNote threading: `closeNote` now passed from CloseDayPanel through `onCloseDay(note)` callback to AccountingPage's `confirmCloseDay()`, which sends it to `closeBusinessDay()`. Previously hardcoded as `note: ""`.
- `aria-label` on cash reconciliation input: "Counted cash in drawer"
- `role="status" aria-live="polite"` on cash reconciliation result banner — screen readers announce balanced/over/short
- `aria-label` on WhatsApp ("Share daily summary via WhatsApp") and Print ("Print daily report") buttons
- `aria-label` on Close/Reclose button

**ExpenseForm:**
- `aria-label` on vendor input ("Vendor name")
- `aria-describedby="vendor-error"` linking error text to input
- `role="group" aria-label="Expense category"` on category buttons
- `role="group" aria-label="Payment method"` on payment method buttons
- `aria-pressed` on payment method buttons

**SalesPage:**
- `aria-pressed` on payment filter buttons (All/Cash/Card/Wallet/Debt)
- `aria-pressed` on status filter buttons (All/Completed/Voided/Debt)

**No changes to:**
- Money math (`getAccountingSummary`, `closeBusinessDay`), daily close logic, cash drawer calculations, sync/storage, backend/schema

**Regression checks:**
- Desktop typecheck: PASS
- Desktop tests: **70/70 PASS**
- Desktop build: PASS (2.33s)

**Files changed:**
- `apps/desktop/src/pages/accounting/AccountingPage.tsx` (+3/-2: closeNote state, fix confirmCloseDay)
- `apps/desktop/src/pages/accounting/components/CloseDayPanel.tsx` (+10/-2: aria-labels, note callback, aria-live)
- `apps/desktop/src/pages/accounting/components/ExpenseForm.tsx` (+8/-0: aria-describedby, role=group, aria-pressed)
- `apps/desktop/src/pages/sales/SalesPage.tsx` (+2/-0: aria-pressed on filter buttons)

**Deferred:** Opening float tracking, cash reconciliation persistence, payment method KPI breakdown — require data model changes

**Verdict: PASS**

---

## 2026-07-09 — OpenCode (DeepSeek V4) — Sprint POS-COMM-4 (Supplier/Receiving Polish) — COMPLETE

**SuppliersPage:**
- Archive/restore buttons on each row (uses existing `archiveSupplier/restoreSupplier` service functions)
- "Show archived" toggle in accounts section header
- Hard delete still available via X button with confirm dialog
- `aria-label` on "+ Add supplier" button
- `aria-pressed` on payment method toggle buttons (Cash/Card/Bank Transfer/Wallet)

**ProductReceivePage:**
- `aria-label` on all toolbar buttons: "Add receiving row", "Paste rows from spreadsheet", "Save and receive all ready rows"
- `aria-label` on row action buttons: "Generate barcode for row", "Scan barcode via camera", "Duplicate row", "Remove row" (was only `title` before)
- `aria-label` on sidebar: "Select supplier" on supplier dropdown, "Save and receive batch" on Save, "Clear all receiving rows" on Clear
- `aria-pressed` on payment method toggle buttons (Account/Cash/Card/Bank/Wallet)
- Fixed duplicate `title` attribute on Remove button

**No changes to:**
- Inventory math, stock movement rules, sync/storage behavior, POS checkout, backend/schema
- Receiving math (`receiveProducts`, `receiveInventoryBatches`, `receiveAndRecord` all unchanged)

**Regression checks:**
- Desktop typecheck: PASS
- Desktop tests: **70/70 PASS**
- Desktop build: PASS (2.63s)
- No console errors, no duplicate title warnings

**Files changed:**
- `apps/desktop/src/pages/suppliers/SuppliersPage.tsx` (+42 lines: archive/restore, archive toggle, aria-labels)
- `apps/desktop/src/pages/products/ProductReceivePage.tsx` (+16 lines: aria-labels on toolbar/rows/sidebar, fixed duplicate title)

**Verdict: PASS**

---

## 2026-07-09 — OpenCode (DeepSeek V4) — Sprint POS-COMM-3 (Customer Debt Polish) — COMPLETE

**Implemented per approved plan with PASS WITH CONSTRAINTS verdict.**

**Phase A — Customer list/status badges:**
- Sort controls: clickable headers for Name (↑↓), Balance (↓), Last Activity (↓)
- Aging bands: clickable 0–30/30–60/60–90/90+ filter the table; active band highlighted with ring; "Filter: Xd" chip shows active filter with ✕ dismiss
- Archive toggle: "Show archived" checkbox above table; `archiveCustomer()`/`restoreCustomer()` buttons on each row (uses existing service functions)
- Risk/debt badges: "overdue" (rose), "over limit" (amber), "near limit" (amber, balance > 80% of creditLimit), "good" (emerald, no debt)
- Credit limit progress bar: visual bar in balance column, fills brand→amber→rose as balance approaches/exceeds credit limit

**Phase B — Profile/statement polish:**
- Bank Transfer and Refund Credit payment methods added (types already supported in `DebtPayment.method`)
- Overpayment warning: toast `"Amount capped to $X (outstanding balance)."` shown when payment exceeds balance
- `aria-pressed` on payment method toggle buttons
- `aria-label` on WhatsApp, Edit, Archive/Restore, Download, Print, Delete action buttons

**Phase C — POS debt picker upgrade:**
- Replaced raw `<select>` with searchable combobox (name/phone filter, Enter selects first match)
- Balance+risk chip shown in dropdown options
- Credit-limit exceeded explanation: `"Sale blocked — customer would exceed $X credit limit by $Y"` (prominent rose banner below credit limit row)
- `aria-label` on customer search input

**Phase D — Verification:**
- Desktop typecheck: PASS
- Desktop tests: **70/70 PASS** (13 cashChange + 57 core)
- Desktop build: PASS (2.76s)

**Deferred to follow-up (no P2 features per constraints):**
- Inline New Customer in POS tender — requires POSPage surgery for `addCustomer` dispatch; documented as follow-up
- Payment edit/void, branded statements, duplicate merge, promise-to-pay — explicitly out of scope

**Files changed:**
- `apps/desktop/src/pages/customers/CustomersPage.tsx` (+95 lines: sort, aging filters, archive toggle, risk badges, credit bar, overpayment warning, Bank Transfer/Refund Credit, aria-labels)
- `apps/desktop/src/features/pos/components/TenderPanel.tsx` (+35 lines: searchable combobox, balance-in-options, credit-limit explanation, useState/useMemo imports)

**Verdict: PASS**

---

## 2026-07-09 — OpenCode (DeepSeek V4) — Sprint POS-COMM-3 (Customer Debt Polish Plan) — PLAN ONLY

**Status: AWAITING REVIEW — No Code Implemented**

Wrote implementation plan to `stages/ux-ui/pos-comm-3-customer-debt-plan.md`.

**Plan summary:**
- 4 phases (A: customer list/badges, B: profile/statement labels, C: POS debt picker clarity, D: accessibility)
- 22 tasks across `CustomersPage.tsx`, `TenderPanel.tsx`, `customer.service.ts`
- P0 fixes: searchable POS customer picker, inline customer creation, credit limit explanation text, overpayment warning
- P1 fixes: archive/restore UI, sort/filter, credit limit progress bar
- P2 fixes: Bank Transfer/Refund Credit payment methods, accessibility

**Explicit non-goals:** No ledger math changes, no debt balance changes, no checkout logic changes, no storage/sync changes, no POS tender math changes.

**Risk:** `TenderPanel.tsx` is highest-risk — shared by CartBody and QuickPOSMode. Keep customer picker callback shape identical.

**Next step:** Approve plan, then implement Phase A through D sequentially.

---

## 2026-07-09 — OpenCode (DeepSeek V4) — Sprint POS-BUG-1 (Exact LBP Tender Fix) — COMPLETE

**Bug:** Exact LBP button underpaid ~50% of sales, blocking checkout.
- `roundLbp` uses `Math.round` (round-to-nearest), which rounds DOWN for values where `mod 5000 < 2500`.
- Example: $2.31 = 206,745 LBP, `roundLbp` → 205,000 (1,745 LBP short).
- `cashTenderValid` converted LBP→USD for comparison, losing LBP-side precision.

**Fix (3 changes):**
1. `currency.ts`: Added `ceilLbp(value, nearest=5000)` — always rounds UP. Used by Exact LBP fill.
2. `POSPage.tsx:fillExactTender`: Changed LBP path from `roundLbp(totalLbp)` to `ceilLbp(totalLbp)`.
3. `POSPage.tsx:cashTenderValid`: Made LBP-aware — pure-LBP tenders now compare `paidLbp >= totalLbp` directly, mirroring `computeCashChange` design. Mixed/USD tenders unchanged.

**Preserved:** `roundLbp` unchanged (still used for quick-cash chips where rounding is fine). USD exact path unchanged. Mixed tender unchanged. Change logic unchanged.

**Tests added (8 new):**
- `cashChange.test.ts`: 8 new tests (was 5, now 13)
  - `roundLbp` behavior tests (3: rounds down, ties, exact)
  - `ceilLbp` behavior tests (3: covers total, just over, tiny values, invariant that ceil >= raw for 9 values)
  - Exact LBP scenario tests (5: $2.31 underpay vs new, $0.02 small, $3.00 exact, pure-LBP paid >= total, mixed tender still works)

**Regression checks:**
- Desktop typecheck: PASS
- Desktop tests: **70/70 PASS** (13 cashChange + 57 core)
- Desktop build: PASS (2.73s)

**Files changed:**
- `apps/desktop/src/features/pos/lib/currency.ts` (+7: `ceilLbp` function)
- `apps/desktop/src/features/pos/pages/POSPage.tsx` (+2: `ceilLbp` import, LBP-aware `cashTenderValid`)
- `apps/desktop/src/__tests__/cashChange.test.ts` (+82: 8 new regression tests)

**Verdict: PASS**

---

## 2026-07-09 — OpenCode (DeepSeek V4) — Sprint POS-COMM-2 (Product/Inventory Polish) — COMPLETE

**Tab naming verified — already renamed from earlier sprint:**
- "Control" → "Stock control" ✓ (already in productViews)
- "Lots" → "Batches" ✓ (already in productViews)
- "Setup" → "Add product" ✓ (already in productViews)

**Product table polish:**
- Added "No barcode" amber badge to ProductTable rows when product has no barcode — appears alongside stock status chip.
- Stock status badges (Active/Low/Out) already present — verified working.

**Accessibility improvements:**
- `WorkspaceTabs`: added `aria-pressed={selected}` and `aria-label` to all tab buttons.
- Lots filter buttons: added `aria-pressed` and `aria-label` ("Filter: all/open/consumed/expired lots").
- Edit Product modal: added `aria-label="Close edit modal"` to ✕ close button.

**No changes to:**
- Product data logic, stock deduction, receiving, sync, storage, backend/API/schema.
- Cart/checkout behavior, inventory math, FEFO, batch consumption.

**Regression checks:**
- API typecheck: PASS
- Desktop typecheck: PASS
- Desktop tests: **62/62 PASS**
- Desktop build: PASS (2.33s)

**Files changed:**
- `apps/desktop/src/features/pos/components/ProductTable.tsx` (+6 lines: No barcode badge)
- `apps/desktop/src/components/ui/WorkspaceTabs.tsx` (+2 lines: aria-pressed + aria-label)
- `apps/desktop/src/pages/products/ProductsPage.tsx` (+3 lines: Lots filter aria-labels, modal close aria-label)

**Verdict: PASS**

---

## 2026-07-09 — OpenCode (DeepSeek V4) — Sprint POS-HARDEN-1 (Commercial Hardening) — COMPLETE

**Verified (no issues found):**
- Fable POS-UX-F1 Phase 1 changes intact: Card tile in QuickPOS+CartBody, scan-error escalation with `scanError` 1.2s flash, "Clean"→"Clear sale" i18n, dynamic "Pay $X" button, cart steppers 36px.
- Fable POS-UX-F2 Phase 2 changes intact: `TenderPanel.tsx` extracted as single tender engine (density full/quick), held sales pill shelf, toast route-aware positioning, LastSaleBanner present.
- Checkout flows verified by code audit — no broken paths:
  - Product tap adds item ✓
  - Barcode scan adds/increments ✓
  - Quantity increase/decrease/remove ✓
  - Clear Sale cancel preserves cart ✓
  - Clear Sale confirm empties cart ✓
  - Cash exact USD/LBP works ✓
  - Card/Wallet checkout paths ✓
  - Debt requires customer (enforced, line 275) ✓
  - Hold/resume/discard held sale ✓
  - Failed checkout preserves cart (try/catch + flag rollback) ✓
  - Offline/sync rejection shows error (event listener) ✓
- Accessibility verified: `aria-pressed` on payment tiles, `aria-label` on held-sale discard, icon+text buttons (not icon-only), Escape closes review overlay.
- Commercial error states: unknown barcode (role-based message), out-of-stock, stock cap reached, underpaid cash, credit limit exceeded, no-customer-for-debt, sync rejection — all show clear cashier-facing text.

**Fixed:**
- `null.id` audit bug at `security.service.ts:767`: `recordAuditEvent` now checks `if (!user) return undefined` before accessing `user.id`, `user.name`, `user.role`. Prevents `TypeError: Cannot read properties of null` on failed unlock with empty user store. 12 call sites validated — the 7 vulnerable ones (lines 455, 480, 515, 522, 573, 827, 894 in lock/unlock/shift paths) are now safe.
- QuickPOSMode hardcoded `"Clear"` label → `t("pos.clear_sale")`.

**Regression checks:**
- API typecheck: PASS (0 errors)
- Desktop typecheck: PASS (0 errors)
- Desktop tests: **62/62 PASS**
- Desktop build: PASS (2.62s)

**Files changed:**
- `apps/desktop/src/features/pos/services/security.service.ts` (+4 lines: null guard in recordAuditEvent)
- `apps/desktop/src/features/pos/components/QuickPOSMode.tsx` (+1/-1: hardcoded "Clear" → i18n)

**Remaining commercial risks:** None identified. POS checkout is verified safe after Fable Phase 1+2 changes.

**Verdict: PASS**

*Note: Fable Phase 3 (drawer, products/customers/dashboard polish) awaits approval. Do not start without explicit instruction.*

---

## 2026-07-09 — Fable — Sprint POS-UX-F2 (Tender Unification, Phase 2) — COMPLETE

- New `TenderPanel.tsx`: the single tender engine (payment row, cash inputs + quick-cash chips + exact + change/still-due, debt picker), density "full" | "quick". Consumed by CartBody and QuickPOSMode — one payment UX standard. Pure presentation; POSPage keeps all state/money math. QuickPOS Enter-flow (USD→LBP→review) preserved via onUsdEnter/onLbpEnter.
- Held sales: pill shelf above cart items (tap=resume, ✕=discard); collapsible section removed.
- Toast routing: bottom-center on POS route (verified pixel-centered), top-end elsewhere (Toast.tsx position prop + routes/index.tsx).
- LastSaleBanner: already present in main POS — verified, no change.
- Dead imports cleaned in CartBody/QuickPOSMode.
- Live verification: quick-mode 250k LL tender → change $2.77 / 248,210 LBP (exact-LBP fix intact), hold→pill→resume round-trip, Pay $X label, 4 tiles both modes. tsc clean, 62/62 vitest.
- Phase 3 (drawer, products/customers/dashboard polish) awaits approval.

## 2026-07-09 — Fable — Sprint POS-UX-F1 (Premium Visual Foundation, Phase 1) — COMPLETE

- Card payment method now visible in BOTH QuickPOS (`QuickPOSMode.tsx`, grid-cols-4) and main POS (`CartBody.tsx`); active tile = gold `--brand` + `--brand-contrast` text + aria-pressed. Removed per-method emerald/violet/amber active classes (design law: no method colors in tender UI).
- Scan-bar error escalation: `scanError` transient state (1.2s) in POSPage flows to both scan bars — danger border + danger-soft ring on unknown barcode / out-of-stock / stock-cap. Pairs with existing error buzz.
- "Clean" → "Clear sale" (i18n values EN+AR); new `pos.pay` key; checkout button now "Pay $X" (Debt keeps "Record Debt — $X").
- Topbar version chip removed; cart steppers 28→36px w/ aria-labels; icon-only buttons (camera/clear/more) labeled.
- Verified live in browser: add-to-cart, qty +/-, Card select, cash change calc, Clear Sale confirm + cancel-preserves-cart, error flash rgb(248,113,113). tsc clean, 62/62 vitest.
- No behavior changes: money math / checkout / sync / stock untouched.
- Docs: fable-implementation-checklist.md Phase 1 marked complete.
- NEXT: Phase 2 (TenderPanel extraction) awaits approval. Note for OpenCode: pre-existing null-guard bug — failed unlock on empty user store throws at security.service.ts:627 recordAuditEvent (null.id); harmless but noisy, worth a guard.

## What Was Done

### 1. Titan HR Design System Extraction
- Read `globals.css` (441 lines) - all tokens, themes, animations
- Read `shared.tsx` - Card, PageHeader, StatusBadge, StatCard, Modal, ConfirmDialog, EmptyState, PageError, ModuleTile
- Read `forms.tsx` - Button, Input, Select, IconButton, SearchInput, DatePicker
- Read `dashboard-layout.tsx` - Full shell (sidebar, header, content, mobile)
- Read `data-table.tsx` - DataTable with search, sort, pagination, CSV
- Read `icons.tsx` - SVG icon system, skeleton loading
- Read `money.tsx` - Currency formatting
- Read `toast.tsx` - Toast notification system
- Read `dashboard/page.tsx` - Dashboard home with widget board
- Read `widgets.tsx` - Widget system (KPI, charts, work queue)
- Read `employees/page.tsx` (first 200 lines) - Employee list layout pattern
- Read `page.tsx` (login) - Login page layout

### 2. POS Design System Audit
- Read `apps/desktop/src/index.css` (full) - All tokens, overrides, component styles
- Read `apps/admin/src/index.css` (full) - Admin token system
- Read `apps/ordering/src/index.css` - Ordering overrides
- Read `apps/driver/src/index.css` - Driver overrides
- Read 15+ POS component files for pattern analysis
- Documented all hardcoded colors, token gaps, and inconsistencies

### 3. Deliverables Produced
- **`stages/agent-reviews/ui-hr-design-transfer/plan.md`** - Complete 10-section design transfer plan:
  1. Titan HR Design DNA (full token catalog)
  2. What to copy directly vs adapt vs keep POS-specific
  3. POS Design Target (desired feeling for each screen)
  4. Page-by-page application plan (7 sprints)
  5. Component migration plan (12 components)
  6. Token plan (final state for all scales)
  7. Implementation phasing (7 sprints, time estimates are rough/untrusted)
  8. Verification plan (per-sprint + final QA)
  9. Open questions / risks
  10. Risk summary

---

## Key Findings

### Gap Size
- **Small gap**: Token architecture, button system, table system, modal system, card system, chips - POS is already ~80% aligned with Titan HR design quality
- **Medium gap**: Typography scale (POS has no scale tokens), spacing tokens (uses raw Tailwind), focus-visible (recently added in previous work)
- **Large gap**: Component consistency across apps (4 separate CSS files), RTL support (partial), admin/ordering/driver token systems diverged

### What POS Already Has / Previously Improved
Previous design sprints have already significantly upgraded POS quality:
- Refined warm ivory palette + gold brand tokens (`--page-bg: #F7F5F1`)
- Elevation scale (`elev-1` through `elev-4`)
- Button press effects (`scale(0.975)`)
- Focus-visible for keyboard users
- Card hover lift, input hover states
- Modal system with animations
- Toast system with semantic borders
- Skeleton shimmer
- Categories tab, underline WorkspaceTabs
- ProductsPage redesign with HR layout patterns

### What Remains (7 Sprints - Time Estimates Are Rough/Untrusted)
The plan breaks remaining work into 7 sprints:
1. Tokens + primitives (additive, no breaking changes)
2. Shell/nav/login/settings
3. Dashboard + reports
4. Products/inventory/customers tables
5. Main POS sales screen - **HIGH RISK, must verify with real sales-flow smoke test**
6. Receipts/invoices/print views
7. Final QA pass

---

## Design Decisions Made

1. **Keep gold brand** - POS uses `#9C6F14` deep gold, NOT HR's `#5b45d4` violet. This plan targets Titan HR design LANGUAGE (patterns, scale tokens, interaction behaviors), not HR's violet brand color. Gold accent stays unless product owner explicitly wants identical HR violet branding.
2. **Keep always-dark sidebar** - POS tradition, does not need to follow HR's light-sidebar-in-light-mode.
3. **Keep touch targets large** - POS checkout product tiles stay 62px minimum (HR's 44px rows are too small for touch).
4. **Keep receipt/print independent** - Print is a different medium.
5. **No shared UI package yet** - HR and POS are separate products. Future: extract `@titan/ui` with theme support.
6. **Additive token migration** - Add new scale tokens, do not remove existing ones. No breaking changes.

---

## Approvals
- [x] Design team: confirm gold brand vs violet accent - **GOLD KEPT**
- [x] Product owner: confirm sprint priority order
- [x] Engineering: POS-UI-5 risk acknowledged, requires smoke test
- [ ] DevOps: schedule Railway deployment

---

## Implementation Started
- [x] Corrections applied to plan + handoff files
- [ ] POS-UI-1: Tokens + Primitives - in progress
- [ ] POS-UI-2: Shell + Nav + Login + Settings
- [ ] POS-UI-3 through POS-UI-7: pending

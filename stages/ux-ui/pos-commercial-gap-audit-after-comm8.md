# POS Commercial Gap Audit — After POS-COMM-1 through POS-COMM-8

**Date:** 2026-07-09
**Auditor:** OpenCode (DeepSeek V4)
**Preceded by:** Sprints 23-27 (product/inventory/receiving/crash), POS-UX-F1+F2 (Fable visual foundation), POS-HARDEN-1 (checkout safety), POS-BUG-1 (Exact LBP fix), POS-COMM-1 through POS-COMM-8 (8 commercial polish sprints)

---

## Executive Verdict

### Commercial Readiness Score: **72/100**

The POS is **operationally safe and technically sound** — checkout is atomic, inventory is hardened, sync is idempotent, crash risks are patched. The codebase can handle real Lebanese store volumes.

However, the **frontend still looks and feels like a dev build** to a shop owner. The POS-COMM sprints delivered accessibility and light polish (aria-labels, status badges, navigation links) — but did **not** deliver the deeper structural or visual polish that distinguishes a commercial product from a functional prototype.

### Why 72 and not 85+:

| Strength | Score impact |
|----------|--------------|
| Checkout atomic + idempotent | Strong + |
| Inventory safety (archive, refund restore, receiving batch order) | Strong + |
| Sync/offline hardened (license, recovery, idempotency) | Strong + |
| All crash risks patched (null guards, escapeHtml, items arrays) | Strong + |
| 70/70 tests, typecheck green, build clean | Strong + |
| Accessibility improved (aria-labels on most screens) | Moderate + |
| 6 screens still use inline edit modals, not drawers | Weak - |
| 4 screens are ~1000+ line monoliths | Weak - |
| 0 screens have responsive layouts (tablet, touch) | Weak - |
| 0 screens have loading skeletons or proper error states | Weak - |
| Product cards lack stock/expiry visibility | Weak - |
| No payment method breakdown anywhere except sales filter | Weak - |
| No refund/return wizard — partial work only | Weak - |
| No shift close discrepancy explanation | Weak - |
| No batch expiry/FEFO visual chips | Weak - |
| Fable Phase 3 (drawers, tools menu, batches expiry chips) all unchecked | Weak - |

---

## Top 20 Remaining Commercial Gaps

### P0 — Visible to Owner / Cashier Daily

| # | Screen | Issue | User Impact | Evidence | Fix | Risk | UI-Only? |
|---|--------|-------|-------------|----------|-----|------|----------|
| 1 | **POS checkout** | No sale review summary before completing — cashier can't see items, tender, change, and customer in one place | Cashier completes wrong sale, can't verify | `completeSale` in POSPage.tsx:566 — no preview/review step; payment goes directly to completion | Add review overlay (QuickPOS already has one at QuickPOSMode.tsx:120 — extract and share with main POS) | Low (add, don't change) | Yes |
| 2 | **POS checkout** | No offline/unsynced banner when sync is down — cashier doesn't know sales are local-only | Silent data loss risk if device breaks before sync | `getOperationalAlerts` exists but only consumed on dashboard; POSPage never shows sync status | Show `Offline` amber pill in POS header when `syncStatus.online === false` | Low | Yes |
| 3 | **ProductsPage** | Edit Product is an inline modal, not a drawer — breaks the tab workflow (Fable Phase 3) | Owner can't see Catalog + Edit simultaneously | `ProductsPage.tsx:1300-1356` — `modal-overlay` with `modal-card`, stops event propagation. 40 state variables. | Extract to right drawer (Fable Phase 3 item) — `components/ui/Drawer.tsx` + `ProductEditDrawer.tsx` | Medium (file extraction) | Yes |
| 4 | **ProductsPage** | Batches tab has no FEFO sort toggle or expiry countdown chips (Fable Phase 3) | Owner can't see which batches expire soon | `ProductsPage.tsx:810-845` — batches listed by `receivedAt desc` only. No sort toggle, no expiry visual | Add FEFO sort toggle + expiry chips (>30d green, ≤30d amber, ≤7d red) | Low | Yes |
| 5 | **Customer debt** | No inline customer creation from POS tender — force-leaves sale (top-100 #35, #36) | Cashier must abandon cart to add customer | `TenderPanel.tsx:240-289` — shows `<Link to="/customers">` when no customers exist | Add mini Customer form (name+phone) inline in TenderPanel with `addCustomer()` call + auto-select | Medium (POSPage integration) | Mostly UI, need `addCustomer` wiring |
| 6 | **Accounting** | No shift close discrepancy explanation — cashier sees difference but doesn't know why | Manager rejects counted cash as theft when it's opening float | `CloseDayPanel.tsx:130-180` — `expected = cashNet` with NO opening float. Variance is `counted - cashNet` | Add opening float field OR explanation text: "Expected cash = cash sales − cash refunds − cash expenses − cash supplier payments. Does not include opening float." | Low | Yes (add text) |
| 7 | **Dashboard** | No payment method breakdown (Cash/Card/Wallet/Debt) visible — owner can't see revenue mix at a glance | Owner must go to Sales page to understand payment mix | `DashboardPage.tsx:165-169` — `paymentMix` computed but NOT displayed in any KPI card or chart | Add small "Payment Mix" line or stacked bar under revenue KPI card, reusing existing `paymentMix` data | Low | Yes |
| 8 | **SalesPage** | Refund/void UX is fragile — partial refund requires exact quantity entry, no wizard, no reason required | Cashier over-refunds or forgets reason | `SalesPage.tsx:235-280` — refund items built manually, batchAllocations preserved but flow is raw | Add refund wizard: select items → enter qty → choose reason → confirm → restore stock (Sprint 23 logic already safe) | Low | Yes |

### P1 — Commercial Polish That Changes Perception

| # | Screen | Issue | User Impact | Evidence | Fix | Risk | UI-Only? |
|---|--------|-------|-------------|----------|-----|------|----------|
| 9 | **POS product grid** | Product cards don't show stock status, expiry, or low-stock warning — cashier sells out-of-stock unknowingly | Lost sales, angry customers | `POSPage.tsx:337-341` — oos check exists but only after scan. Card rendering doesn't show stock status. | Add stock badge (Out/Low/OK) + "No barcode" badge to product cards in grid view | Low | Yes |
| 10 | **ProductsPage** | "Generate Images" + "Bulk Edit" are prominent toolbar buttons — should be behind "⋯ Tools" menu (Fable Phase 3) | Cluttered toolbar for daily use | `ProductsPage.tsx:1010-1030` — "New Product", "Bulk Edit", "Export CSV" buttons in toolbar | Move Generate Images + Bulk Edit behind a dropdown Tools menu; keep New Product + Export CSV visible | Low | Yes |
| 11 | **ProductsPage** | 1260+ line monolith — Catalog, Categories, Alerts, Control, Lots, Setup all in one file (top-100 #31) | Any change risks breaking another tab | `ProductsPage.tsx` — entire file is one export default function with ~40 state variables | Split into sub-components per tab: CatalogTab, LotsTab, AlertsTab, ControlTab, SetupTab, CategoriesTab | Medium (file splitting, no behavior change) | Yes |
| 12 | **StaffPage** | No shifts/audit view — Staff page only shows team list, not shift history or audit trail (top-100 #33) | Owner can't audit staff activity | `StaffPage.tsx` presumably exists but never examined in POS-COMM sprints | Add Shifts tab showing open/closed shifts + Audit tab showing recent audit events | Medium (new UI, existing data) | Yes |
| 13 | **SettingsPage** | License status not visible — owner doesn't know if store is in grace/suspended/active | Sudden checkout block without warning | `getOperationalAlerts` returns license info but Settings page doesn't show it | Add License card in Cloud sync or Security tab showing status + grace days | Low | Yes |
| 14 | **All tables** | No loading skeletons — tables flash empty then populate (top-100 #75) | Feels broken/janky to owner | Customer/sales/product tables all render `[]` first, then populate via subscription | Add 3-row skeleton placeholders during initial load on all table pages | Low | Yes |
| 15 | **ProductReceivePage** | No batch/expiry preview before save — user can't verify lots before committing | Wrong expiry dates silently enter inventory | `ProductReceivePage.tsx:389-673` — rows have expiry input but no summary/preview of batches that will be created | Add "Review" step before save showing: products to create/update, batches to create, total cost, supplier linkage | Low | Yes |
| 16 | **DeliveryPage** | No driver assignment UI — `assignedTo` field exists in type but no UI to assign (top-100 #60) | Owner must use separate API tool to assign drivers | `DeliveryPage.tsx:213-226` — Expand shows status update + cancel only. No assign dropdown. | Add driver select dropdown in expanded order view using `drivers` data from DriversPage | Low | Yes |

### P2 — Deeper UX That Completes the Picture

| # | Screen | Issue | User Impact | Evidence | Fix | Risk | UI-Only? |
|---|--------|-------|-------------|----------|-----|------|----------|
| 17 | **POS checkout** | No manager approval flow for below-cost sales or discounts | Cashier can override prices without oversight | `POSPage.tsx:426` — `setItemPrice()` enforces cost check but only for discount permission | Add manager PIN prompt when price < cost (requires `unlockWithPin` integration) | Medium (security flow) | No (needs auth check) |
| 18 | **Accounting** | Cash drawer reconciliation not persisted — counted cash + variance lost on unmount | Owner must recount every time they open the page | `CloseDayPanel.tsx:22-23` — `countedCash` is local `useState`. Never saved to `DailyClose` type. | Add `countedCash` + `variance` + `openingFloat` fields to `DailyClose` type; save in `closeBusinessDay()` | High (schema change) | No (data model change) |
| 19 | **Customer debt** | No promise-to-pay / partial payment plan tracking (Fable Phase 3 item) | Owner can't record installment agreements | `customer.service.ts` — no promise-to-pay model. Debt is binary: owed/paid. | Add `PromiseToPay` type with installments; show in customer ledger | High (new data model) | No (new storage + sync) |
| 20 | **All screens** | No responsive/tablet layout — POS assumes 1024px+ monitor (top-100 #61-64) | Can't run on tablet for manager tasks | No `@media` queries in any POS page; layouts use fixed `xl:grid-cols` breakpoints only | Add tablet breakpoints for manager pages (Products, Customers, Sales, Accounting, Dashboard) using existing Tailwind responsive classes | Medium (CSS only) | Yes |

---

## What Was Already Fixed (Do NOT Re-do)

| Sprint | Fixed |
|--------|-------|
| Sprint 23 | product archive, stock safety, refund idempotency, batch restore |
| Sprint 24 | quick views/sort/filters, quick-create modal, lots tab search, receiving paste |
| Sprint 25 | receiving→supplier/PO/payment, `receiveAndRecord`, payment idempotency |
| Sprint 26 | write-offs, reconciliation tools, alert action buttons |
| Sprint 27 | crash fixes (escapeHtml, sale/refund items null guards, quickMode default true) |
| POS-UX-F1 | Card in QuickPOS, scan-error escalation, Clear sale, Pay $X, cart steppers, Topbar chip |
| POS-UX-F2 | TenderPanel extraction, held sales pill shelf, toast routing, LastSaleBanner |
| POS-HARDEN-1 | null.id guard, i18n Clear label, verified checkout safety |
| POS-BUG-1 | Exact LBP tender fix (`ceilLbp` + LBP-aware `cashTenderValid`) |
| POS-COMM-2 | product table no-barcode badge, WorkspaceTabs+ Lots aria |
| POS-COMM-3 | customer sort/aging/archive, risk badges, POS picker upgrade, overpayment warning |
| POS-COMM-4 | supplier archive toggle, receiving aria-labels |
| POS-COMM-5 | accounting closeNote fix + aria-live, expense form a11y, sales filter aria-pressed |
| POS-COMM-6 | dashboard action queue (5 sources), daily close card, operational alerts |
| POS-COMM-7 | delivery aria-labels + aria-expanded, unassigned warning, drivers aria-pressed |
| POS-COMM-8 | settings sync health badges, aria-labels on inputs, aria-describedby |

---

## Recommended Next 3 Implementation Sprints

### Sprint A — POS Checkout Commercial Finish (P0 + P1 items)
**Scope:** Sale review, offline banner, product card stock badges, refund wizard
**Files:** `POSPage.tsx`, `QuickPOSMode.tsx` (extract review), `POS product grid components`, `SalesPage.tsx` (refund wizard)
**Do NOT touch:** checkout atomicity, money math, sync, inventory deduction, TenderPanel extraction
**Verification:** typecheck, 70+ tests, build, POS smoke

### Sprint B — Products + Inventory Structural Split (P0 + P1 items)
**Scope:** ProductsPage→sub-components, product edit modal→drawer, FEFO expiry chips, loading skeletons, Generate Images + Bulk Edit behind Tools menu
**Files:** `ProductsPage.tsx` (split into 6+ files), `components/ui/Drawer.tsx`, `ProductTable.tsx`
**Do NOT touch:** product data logic, stock deduction, receiving, archive/restore
**Verification:** typecheck, tests, build, product workflow smoke

### Sprint C — Owner Dashboards + Data Visibility (P1 + P2 items)
**Scope:** Payment mix on dashboard, license status in settings, batch/expiry receiving preview, driver assignment UI, shift audit tab
**Files:** `DashboardPage.tsx`, `SettingsPage.tsx`, `ProductReceivePage.tsx`, `DeliveryPage.tsx`, `StaffPage.tsx`
**Do NOT touch:** money math, accounting, daily close, sync
**Verification:** typecheck, tests, build, dashboard + delivery smoke

---

## Files That Need No Further Work (Stable)

| File | Reason |
|------|--------|
| `sales.service.ts` | Atomic, guarded, tested |
| `product.service.ts` | Hardened in Sprints 23-27 |
| `inventoryBatch.service.ts` | FEFO correct, movements recorded |
| `sync.service.ts` | Idempotent, license-gated |
| `customer.service.ts` | FIFO aging correct, tested |
| `supplier.service.ts` | ReceiveAndRecord safe, payment idempotent |
| `currency.ts` | `ceilLbp` fixed, `computeCashChange` correct |
| `security.service.ts` | null.id guard fixed, simple mode intact |
| `dailyClose.service.ts` | Dedup by dateKey working |
| `TenderPanel.tsx` | Extracted, shared, accessible |
| `WorkspaceTabs.tsx` | aria-pressed + aria-label |
| `AlertsPanel.tsx` | Action buttons wired |
| `CloseDayPanel.tsx` | aria-live on cash rec |

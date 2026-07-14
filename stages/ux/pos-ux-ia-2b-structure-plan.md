# POS-UX-IA-2B — Products / Stock / Settings Structure Split (PLAN)

**Date:** 2026-07-14
**Status:** planning pass — **no code yet**
**Builds on:** IA-2 plan + shipped IA-2A (labels/signposts). Guardrail: no stock/sync/tender/tax/refund/receive/ledger **logic**; prefer moving/reframing components; keep route compatibility.

---

## 1. Current structure (exact)

### ProductsPage (`src/pages/products/ProductsPage.tsx`, ~1300 lines)
One page, one route `/products`, six views via `WorkspaceTabs` (`ProductWorkspaceView = Catalog | Categories | Alerts | Control | Lots | Setup`):

| View (value) | Label | Lines | Renders |
|---|---|---|---|
| Catalog | "Catalog" | 1181 | `ProductTable`, `ProductEditDrawer`, `ProductQuickCreate`, Tools menu, Export CSV |
| Categories | "Categories" | 1280 | category rename form |
| Alerts | "Alerts" | 921 | `AlertsPanel` (reorder + expiry) |
| **Control** | "Stock control" | 936–1040 | **`StockControlPanel`** (adjust form + stock-count + recent adjustments) → then client "Run Scan" reconciliation `<section>` → **`LedgerReconciliationPanel`** (Initialize + Repair) + the IA-2A signpost |
| **Lots** | "Batches" | 824–920 | inline batches table + filter tabs |
| Setup | "Add product" | 1041 | `ProductSetupForm` |

**Key coupling:** `StockControlPanel` (line 946) is wired with **~20 props** from ProductsPage state — `adjustmentProduct/Id`, `adjustmentMode`, `adjustmentQuantity`, `adjustmentReason`, `adjustmentBatchId`, `adjustmentNote`, `selectedProductBatches`, `recentAdjustments`, `activeStockCount`, `countProductId`, `countedQuantity`, `countSearch`, `countLines`, and handlers `onSaveStockAdjustment`, `onBeginStockCount`, `onSaveCountLine`, etc. `LedgerReconciliationPanel` is **self-contained** (fetches its own data). "Recent movements" = the recent-adjustments cards inside `StockControlPanel`.
- **Add/receive entry points:** Products→Setup ("Add product", in-page create) and the sidebar **Receive stock** (`/products/new`, the `ProductReceivePage`). Two separate creation surfaces.

### SettingsPage (`src/pages/settings/SettingsPage.tsx`, 1912 lines)
One page, one route `/settings`, `SettingsWorkspace = Business | Delivery | Cloud sync | Security | Backup | About` (6 tabs). Complexity is concentrated in **Cloud sync**, which spans **6 conditional render blocks** (1106, 1218, 1354 [STORE_HUB only], 1420, 1595, 1731):
- Connection mode + server URL (Store Hub / Connect to Hub / Direct Railway)
- Hub status + LAN/BIND_HOST toggle (confirmed) + LAN IP
- Pairing code + paired devices list (rename/**revoke**, confirmed)
- Offline sync queue (counts, Sync now, Retry failed, diagnostics)
- Cloud connection (super-admin unlock → tenant/key/admin) + License card
Other tabs: **Business** (615: store info, tax/currency/rate, register, receipt), **Delivery** (845: store delivery config), **Security** (930: read-only cards), **Backup** (1755, shared render with Security: Recovery Card + **Danger zone** export/restore, confirmed IA-1A), **About** (992: version/update).

### Accounting / Staff shift overlap
| Control | Location | Component | Role gate |
|---|---|---|---|
| Open/close shift (primary) | Accounting → **Shift** tab | `ShiftControlPanel` (self-contained, uses `openShift`/`closeShift`/`computeShiftCashBreakdown`) | tab shown when `shifts.manage`; page route `accounting.manage` → **Manager + Admin** |
| Open/close shift (duplicate) | Staff → **Shifts** tab | inline in `StaffPage` (openShift/closeShift + cash-count + close modal) | page route `staff.manage` → **Admin only** |
| Shift history / cash reconciliation | both | Accounting register-reconciliation panel; Staff shift list | as above |

IA-2A added a banner making Accounting canonical and framing Staff→Shifts as history; **both control sets still functional** (nothing removed).

---

## 2. Proposed structure

### Sidebar (STOCK group after IA-2A rename)
```
SELL     POS · Sales
STOCK    Products        (/products  → Catalog · Categories · Alerts · Add product)
         Receive stock   (/products/new)
         Stock & Batches (/stock  NEW → Adjust & count · Batches · Reconciliation)   [needs approval: new item+route]
         Suppliers
PEOPLE   Customers · Staff
MONEY    Dashboard · Accounting (incl. Shift = canonical open/close)
SYSTEM   Settings        (Store · Devices & Sync · Data & Backup · About)
```

### Products → catalog focus
Keep **Catalog / Categories / Alerts / Add product**. Move **Control + Lots + Reconciliation** out to the new Stock destination.

### New "Stock & Batches" (`/stock`)
- **Adjust & count** — `StockControlPanel` (adjust form + stock count + recent movements).
- **Batches** — the lots table (moved from Products→Lots).
- **Reconciliation** — `LedgerReconciliationPanel` (Initialize + Repair), surfaced as its own tab.

### Settings → 4 scannable groups
- **Store** — Business + (read-only Security summary) + Delivery config.
- **Devices & Sync** — connection mode, hub/LAN, pairing/devices, offline queue (the current "Cloud sync" mega-section, relabelled + sub-headed), cloud connection.
- **Data & Backup** — Recovery Card + **Danger zone** (export/restore).
- **About** — version/update.

---

## 3. What is safe to implement now (no new route, no logic, no perms)

- **S1 — Settings relabel + sub-headers:** rename tab **"Cloud sync" → "Devices & Sync"**; add clear sub-section headers (Connection / Hub & LAN / Paired devices / Sync queue / Cloud account) so the mega-tab scans well. Keep behavior. (Label + presentational grouping.)
- **S2 — Products tab clarity:** the IA-2A signpost is in; optionally rename the **"Stock control"** tab label to **"Adjust & count"** and keep Batches/reconciliation signpost. Label-only.
- **S3 — Component extraction (internal, no route change):** extract the Control-view contents into a self-contained `StockWorkspace` component (moving the ~20 stock-control state vars + handlers into it or a `useStockControl()` hook), still mounted inside ProductsPage exactly where it is today. This is pure refactor (no behavior/route change) and **de-risks the later move**.
- **S4 — Danger-zone consistency:** confirm export/restore under the labelled Danger zone (done IA-1A); apply the same treatment to any other destructive settings action grouping (labels only).

## 4. What needs approval

- **A1 — New sidebar item + new route `/stock`** (+ mount the extracted `StockWorkspace` there; `/products` drops Control/Lots/Reconciliation). Adds a nav item and a route.
- **A2 — Route alias / compatibility:** keep `/products` working; decide whether the Control/Lots views 301→ `/stock` or simply disappear from Products' tab bar. (Recommend: keep `/products` valid; move only the tabs.)
- **A3 — Remove duplicate shift controls from Staff → Shifts** (leave history only). This is "removing working shift controls" → per the rules I will **not** do it without this explicit approval. (Both sets use the same service; removal is UI-only, low logic risk, but it's a workflow change.)
- **A4 — Suppliers permission/placement** (`accounting.manage` → `inventory.manage`, move under STOCK). Permission change — explicitly deferred by this sprint; listed for completeness.
- **A5 — Settings into separately-routed sub-pages** (vs one page with 4 tabs). Bigger; optional.

## 5. File / component impact list

| Change | Files touched | Type |
|---|---|---|
| S1 Settings relabel + sub-headers | `SettingsPage.tsx`; i18n `desktop.settings.*` (if keyed) | label + JSX headers |
| S2 Products tab label | `ProductsPage.tsx` (tab def) | label |
| S3 Extract StockWorkspace | **new** `features/pos/components/StockWorkspace.tsx` (or `hooks/useStockControl.ts`); `ProductsPage.tsx` (move state/handlers + render) | refactor (no logic) |
| A1/A2 New /stock route + page | **new** `pages/stock/StockPage.tsx`; `routes/index.tsx` (add route + `RequirePermission inventory.manage`); `Sidebar.tsx` (add item); `ProductsPage.tsx` (remove Control/Lots/Reconciliation views + their state, now in StockPage) | move + new route |
| A3 Staff shift reduction | `StaffPage.tsx` (remove open/close controls from Shifts tab, keep history) | remove UI (approval) |
| A4 Suppliers gate | `Sidebar.tsx`, `routes/index.tsx` (permission), grouping | permission (deferred) |
| A5 Settings routed sub-pages | `routes/index.tsx`, split `SettingsPage.tsx` into 4 | move + routes |

Unchanged (no touch): `routes/sync.ts`, `lib/ledger.ts`, `inventoryBatch.service`, `sales.service`, `security.service` (perms), `shift.service`, `cloudSync.ts`, schema/migrations — **zero business-logic files**.

## 6. Risk list

- **R1 (highest) — StockControlPanel prop-threading.** ~20 props tie it to ProductsPage state. Moving to `/stock` requires relocating that state + handlers (S3 first, as an isolated refactor, then A1 move). Mitigation: extract to `StockWorkspace`/`useStockControl` and verify parity in-place before moving the route.
- **R2 — Route/muscle-memory.** Managers know Products→Stock control. Moving to `/stock` changes the path. Mitigation: keep the IA-2A signpost, keep `/products` valid, add the new sidebar item so it's discoverable.
- **R3 — Shift-control removal (A3).** Removing Staff's open/close could disrupt an Admin who opens tills there. Mitigation: needs explicit approval; the Accounting path already covers Managers+Admins; keep history in Staff.
- **R4 — Settings Cloud-sync section is stateful** (connection mode, pairing, super-admin unlock timers). Relabel + sub-headers (S1) are safe; a full routed split (A5) must preserve those effects/timers — higher risk, later.
- **R5 — i18n coverage.** New labels/headers should have en+ar entries where the codebase uses keys (nav/groups are keyed; many section headers are hardcoded — match the surrounding pattern).

## 7. Recommended implementation phases

- **IA-2B.1 (safe, ship first):** S1 (Settings "Devices & Sync" relabel + sub-headers), S2 (Products tab label), S4 (danger-zone consistency). Label/presentation only; no route, no logic. Desktop typecheck/tests/build.
- **IA-2B.2 (refactor, low risk):** S3 — extract `StockWorkspace`/`useStockControl`, still mounted in ProductsPage. Verify stock control/count/reconciliation behave identically in place. No route change.
- **IA-2B.3 (approval):** A1/A2 — add `/stock` route + sidebar "Stock & Batches", move the extracted workspace, keep `/products` valid. Real navigation split.
- **IA-2B.4 (approval, separate):** A3 (Staff shift reduction), A4 (Suppliers gate), A5 (Settings routed sub-pages) — each its own reviewed change.

## Acceptance (this pass)
No code implemented. Exact current structure, proposed structure, file/component impact list, risk list, and phased plan delivered. Awaiting review to authorize IA-2B.1 (and the A-items individually).

# Titan POS Desktop — Experience Inventory

Scope: `apps/desktop/src` (~39.3k lines TS/TSX/CSS) plus theme/i18n providers in `packages/shared/src`.
Compiled 2026-10-16 from the code (read-only audit). Basis for the Midnight Gold design makeover.

Identity: `ThemeProvider.tsx` — "Midnight Gold is dark-first" (default dark). `AGENTS.md` previously described a green/emerald brand; that is obsolete.

---

## 1. Routes (`routes/index.tsx`, all wrapped in `<Shell>` → `<RequirePermission>`)

| Path | Page | Permission | Sidebar group / label |
|---|---|---|---|
| `/` | `features/pos/pages/POSPage.tsx` | `sales.checkout` | Register / POS |
| `/sales` | `pages/sales/SalesPage.tsx` | `reports.view` | Register / Sales |
| `/customers` | `CustomersPage` | `customers.manage` | Register / Customers |
| `/products` | `ProductsPage` | `inventory.view` | Inventory / Products |
| `/products/new` | `ProductReceivePage` | `inventory.receive` | Inventory / Receiving |
| `/stock` | `StockPage` | `inventory.view` | Inventory / Stock & Batches |
| `/products/count` | → `/stock` | — | — |
| `/suppliers` | `SuppliersPage` | `suppliers.manage` | Inventory / Suppliers |
| `/dashboard` | `DashboardPage` | `reports.view` | Finance / Dashboard |
| `/accounting` | `AccountingPage` | `accounting.manage` | Finance / Accounting |
| `/delivery` | `DeliveryPage` | `delivery.manage` | Operations / Delivery |
| `/delivery/drivers` | `DriversPage` | `delivery.manage` | not in sidebar (also a Delivery tab) |
| `/staff` | `StaffPage` | `staff.manage` | Operations / Staff |
| `/settings` | `SettingsPage` | `settings.manage` | System / Settings |
| `*` | → `/` | — | — |

Sidebar groups: Register, Inventory, Finance, Operations, System. Mobile: `BottomNav` horizontal strip. `pages/NotFoundPage.tsx` is unused. Topbar titles: `pageCopy` in `components/layout/Topbar.tsx`.

**Outside the router (`Shell`):**
- **Lock / login:** `!isSessionUnlocked()` → `pages/auth/LoginScreen.tsx` replaces the shell. Auto-lock after 10 min (`AUTO_LOCK_MS`); Topbar lock button. Staff card grid (display only), PIN dots + `Numpad`, shake on error, "Switch store", "New device / add store" Connect modal (3 connection modes, URL, subdomain, PIN, pairing code, full pull + reload), auto hub sync (retries every 10 s up to 3 min), `?dev` bypass. `ChangePinModal` is **unreachable** (`setChangePinUser` only ever set to `null`).
- **Post-unlock intro:** `components/TitanIntro.tsx`, 2.8 s full-screen animation on every unlock (including after auto-lock).
- **Suspended overlay:** inline `SuspendedOverlay`, `z-50`, raw slate/rose, hard-coded English; reads the legacy `isSuspended` flag (15-day grace) while the license lease uses `offlineGraceDays` (default 7).
- **First setup:** `FirstSetupWizard` (+ `FirstSetupScan`, `FirstSetupImport`), reachable only from Settings → Backup/Security → System. The Dashboard first-run prompt lands on the wrong Settings tab.
- **Global overlays:** `ToastContainer`, `ActivityFeed`, `ErrorBoundary`, framer-motion page transition.

---

## 2. Pages & tabs

| Page (lines) | Tabs | Panels / drawers / modals | Primary actions |
|---|---|---|---|
| **POS** (1224) | none (Quick mode toggle) | `SyncBanner`, `LastSaleBanner`, `SearchToolbar`, `DepartmentTabs`, `FavoritesBar`, `ProductGrid`/skeleton/`EmptyState`, `CartPanel` rail, `CartDrawer` (<lg), mobile cart button, `ConfirmDialog`s, `VariantPicker`, `KeyboardShortcutsModal`, inline review overlay, `SaleCompleteOverlay`, `QuickPOSMode` | scan/search, add, hold/resume, clean, discount, sell at cost, tender, review, pay, print, WhatsApp |
| **Dashboard** (590) | today/week/month | first-run prompt, inline KPI row, payment mix, inline trend chart, top products, action queue, recent sales; own H1 | range switch |
| **Products** (1018) | Catalog, Categories, Alerts, Add product | `KpiCards`, Tools menu (images, bulk edit/import, cleanup), `ProductTable`, `AlertsPanel`, `ProductSetupForm`, `ProductQuickCreate`, `BulkImportModal`, `CatalogCleanupPanel`, `ProductEditDrawer`, confirms; own H1 | export, edit/delete, rename category (links use full reload) |
| **Receiving** (1048) | none | KPI chips; multi-row receive grid (scan, unknown-barcode decision, name nudge, picker, Open Food Facts, fields, expiry, image); aside: supplier/purchase, payment, summary, labels | add row, paste sheet, save batch, print labels |
| **Stock & Batches** (204) | Adjust & count, Batches, Opening inventory, Reconciliation | `StockControlPanel`, `BatchesPanel`, `OpeningInventoryPanel`, recon table, `LedgerReconciliationPanel`; own H1 | adjust, count, post, recon, init ledger |
| **Sales** (728) | Receipts, Insights (**tab values are translated labels → breaks in Arabic**) | `SalesKpiCards`, search/sort/group, `ReceiptList` + `ReceiptPreview`, mobile receipt drawer, `InsightsPanel`, confirms | print, refund, void |
| **Customers** (903) | Ledger, Pay debt | KPI, aging chips, archived toggle, cards + detail (balance, WhatsApp, credit bar, promise note, timeline), ad-hoc edit modal | add, pay, edit, archive |
| **Suppliers** (872) | Accounts, Orders, Pay supplier, Activity | lists, PO, payment form, activity | add, pay, archive |
| **Accounting** (314) | Close day, Expenses, Cash flow, History, Shift | KPI, `CloseDayPanel`, expenses, cash flow, `HistoryPanel` (rendered **twice**), `RegisterReconciliationPanel`, `ShiftControlPanel`, close-day confirm with override | close day, expense, shift |
| **Staff** (1321) | Team, Shifts, Audit | user cards, add-user with presets, edit-access `Drawer`, shift control (duplicate), audit | add user, edit access, reset PIN |
| **Delivery** (261) | Orders, Drivers | search/filter, order cards, confirm; **no scroll container** | advance status, cancel, assign |
| **Drivers** (184) | — | inline form, table | add/edit/toggle |
| **Settings** (1977) | Business, Delivery, Devices & Sync, Security, Backup, About | Business form + `RatePanel` (header wrongly reads "Offline sync"); connection mode, LAN, paired devices, offline queue, cloud account, license card; backup/restore/recovery card; updater states. **Devices & Sync and Backup render in the 360 px aside with an empty main column.** | save, sync, retry, diagnostics, backup/restore |

---

## 3. Shared UI

`components/ui`: `Button` (unused), `Drawer` (RTL-aware, Staff only), `WorkspaceTabs` (9 pages), `EmptyState` (POS, Delivery only), `StatCard` (unused), `MoneyText` (unused), `Numpad` (login only), `Skeleton` (unused), `Spinner`, `Toast` (uses undefined `--accent-*`), `ActivityFeed`.
`components/`: `ConfirmDialog` (`z-50`, undefined `animate-scale-in`/`--shadow-xl`), two `ErrorBoundary` implementations, `security/AccessDenied` (no call to action), `TitanLogo`, `TitanIntro`.
`components/layout`: `Sidebar` (collapsible 56/200 px; footer shift/sync/license pills), `Topbar`, `SyncStatus` (pill + dropdown + rejection toast), `NotificationCenter` (dark-only severity colors → poor light-mode contrast).
`features/pos/components` (45 files): POS core, cart/checkout (`CartPanel`, `CartDrawer`, `CartBody`, `CartItemCard`, `TenderPanel`, `CartRailWidgets`), products, stock, sales, accounting, settings, setup. Unused: `CustomerDebtPanel`, `DailyReportPanel`, `StaleRateBanner`.

---

## 4. Design tokens (`index.css`, 1375 lines; no theme files)

`[data-theme]` on `<html>` (ThemeProvider, default dark); `dir`/`lang` set by `I18nProvider`. Tailwind 4 without `@theme` → no token utilities.

| Token | Light | Dark |
|---|---|---|
| `--page-bg` | `#F7F5F1` | `#0B0E14` |
| `--surface` / `-2` / `-3` | `#FFF` / `#F6F4EF` / `#ECE8E1` | `#12161F` / `#171C27` / `#1E2430` |
| `--text` / `-2` / `-3` | `#1C1917` / `#57534E` / `#8C8578` | `#F4F6FA` / `#9AA4B8` / `#5F6B80` |
| `--brand` / `-hover` | `#9C6F14` / `#7E5A10` | `#D4A843` / `#E4BC5C` |
| `--brand-contrast` | `#FFF` | `#2C1F05` |
| status ok/warn/err/info | `#16a34a` `#b45309` `#dc2626` `#0e7aa5` | `#34D399` `#FBBF24` `#F87171` `#60A5FA` |

Radii 6/8/12; elevation `--elev-0..4`; type scale `--fs-caption` 11 → `--fs-total` 40; spacing `--sp-*`; z-scale `--z-*`; motion `--dur-*`.
**Adoption is low:** `--z-*` 0 uses, `--fs-*` 1, `--sp-*` 3, `--elev-*` 1, `--radius*` 1 — versus 771 arbitrary `text-[Npx]` (21 sizes, down to 8 px) and 1,397 inline style blocks.
**Undefined but referenced:** `--accent*`, `--shadow-xl`, `--danger-border`, `--rose-50/600`, `animate-scale-in`.
**Legacy theme shim:** ~200 lines of `!important` overrides; unshimmed classes leak raw color (e.g. `bg-emerald-100` ×14).
**RTL:** logical properties in Drawer/Toast/ActivityFeed/search; physical leftovers in QuickPOSMode (8), POSPage (5), SyncStatus (4), others. No Arabic font loaded; printed receipts have no `dir`/`lang`.
**Hard-coded color hotspots:** SettingsPage 466 raw palette classes, StaffPage 207, SuppliersPage 176, InsightsPanel 61, RegisterReconciliationPanel 58, ExpenseForm 57.

---

## 5. System states — where they surface today

- **Offline:** `SyncStatus` pill, `SyncBanner` (mode-specific copy), Settings queue, POS write-through failure text.
- **Pending:** `SyncStatus` amber pill; Sidebar "N pending" pill is **red** (pending is not an error).
- **Failed / dead (≥5 attempts):** "N stuck" pill + **"Clear stuck", which silently deletes all non-synced ops ≥5 attempts including Rejected**; `SyncBanner` retry; Settings queue; close-day warnings.
- **Rejected:** `sync:operation-rejected` → toast + POS status; Settings counter/list with per-item retry. **No resolution UI** (`retryRejectedSync`, `removeRejectedOperation` have no UI); topbar pill never counts rejected; CONNECT_TO_HUB banner misreads rejected as "not paired".
- **Recovery / backup:** Settings → Backup system card; login Connect modal backup/restore on pull failure. License `recovery` status has no UI.
- **Permission denied:** `AccessDenied` at route level (no CTA); inline text for discounts; sidebar hides items. Inconsistent: `CashDrawerPanel`/`ExpensePanel` not gated; `openShift` doesn't check `shifts.manage`.
- **License:** grace pill in Sidebar; Settings license card. Blocked writes surface only as generic error text. No global read-only banner; legacy SuspendedOverlay blocks UI even during grace; QuickPOS renders above it.
- **No open shift:** Topbar chip, Sidebar "Closed", POS status text pointing to Accounting although the cart rail can open a shift.
- **Empty states:** `EmptyState` only on POS/Delivery; ~15 ad-hoc dashed boxes elsewhere.
- **Loading:** `Spinner` (10 pages), POS skeleton, ad-hoc pulses; `ui/Skeleton` unused.
- **Errors:** `showToast` (mostly English), separate SyncStatus toast, two ErrorBoundary fallbacks.
- **Quick POS:** `QuickPOSMode.tsx` (620 lines), full-screen `z-[200]`, duplicated cart/discount/review logic; no persisted preference.
- **Arabic / RTL:** AR/EN toggle; dictionaries 1161 keys each; **poor coverage in large pages** (Settings 2 `t()` vs ~78 literals, Products 3 vs ~55, Receive 7 vs ~53, Customers 2 vs ~45, Suppliers 1 vs ~35; several panels 0).

---

## 6. POS flow

`POSPage` = product column (SyncBanner → LastSaleBanner → Quick/SearchToolbar → DepartmentTabs → FavoritesBar → ProductGrid → shortcut strip) + `CartPanel` rail (392/440 px) or `CartDrawer`. All money/tender math lives in POSPage (USD/LBP/Mixed, LBP payable ceil to 5,000, VAT, credit limit, sell at cost). Hotkeys Ctrl+F, F8, Esc, Shift+/; Enter on empty scan opens review.
`CartPanel`/`CartDrawer` duplicate header and held-sale pills (first 4 only, no overflow) and each receive ~55 props. `CartBody`: items, sell-at-cost, note + discount accordions, `TenderPanel`, totals, sticky "Pay $X". Review overlay inline (`z-[200]`); confirm label shows USD total, not rounded cash payable. Completion: `SaleCompleteOverlay` (3.5 s), two receipt print templates. Checkout failures surface only in `scannerStatus` text.

---

## 7. Pain points

**Monoliths (>600 lines):** SettingsPage 1977, StaffPage 1321, POSPage 1224, ProductReceivePage 1048, ProductsPage 1018, CustomersPage 903, SuppliersPage 872, SalesPage 728, LoginScreen 659, QuickPOSMode 620; services sync 1749, product 1183, security 1083; index.css 1375.

**Defects:** Sales tabs break in Arabic; QuickPOS dialogs render underneath it (z-50 under z-200); "Clear stuck" deletes Rejected ops; rejected ops invisible with no resolution; Accounting History rendered twice; Settings layout (empty main column, wrong header, duplicated card); unreachable PIN change; full-page reloads; Delivery/Drivers without scroll container; light-mode contrast in NotificationCenter; undefined tokens/animation.

**Duplication:** 4 modal patterns, 4 drawer implementations, 4 button systems, unused primitives (`MoneyText`, `StatCard`, `Skeleton`) while KPI cards are re-implemented 5+ times; POS markup duplicated across CartPanel/CartDrawer/QuickPOSMode; shift open/close in three places with inconsistent guidance; two ErrorBoundaries, two receipt templates, two suspension/grace models; inconsistent page chrome and padding; 21 arbitrary font sizes; green/red status colors mixed with gold brand.

**Cashier speed:** 2.8 s intro after every unlock.

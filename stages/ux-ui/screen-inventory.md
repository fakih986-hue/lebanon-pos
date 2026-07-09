# TITAN POS Screen Inventory

Date: 2026-07-09

Basis: direct inspection of the React/Vite POS project under `D:\Claude project\6.3.2026\v4\lebanonpos`.

## Desktop App Routes

| Area | Route / component | Purpose | Current design quality | UX risk | Redesign priority |
|---|---|---|---|---|---|
| Sell | `/` / `POSPage` | Main cashier checkout, barcode scan, cart, tender, debt, hold sale | Strongest screen, but over-complex | Critical | P0 |
| Sell | `QuickPOSMode` | Full-screen scanner-first cashier mode | High potential, strong speed concept | High: text artifacts, payment rail complexity, missing card option | P0 |
| Sell | `CartPanel` / `CartBody` / `CartDrawer` | Persistent cart, tender, discount, customer, held sales | Good structure, too dense | High | P0 |
| Sell | `SaleCompleteOverlay` | Post-sale confirmation and receipt actions | Useful | Medium | P1 |
| Sell | `LastSaleBanner` | Recent sale recall/receipt | Useful, potentially noisy | Medium | P1 |
| Sell | `KeyboardShortcutsModal` | Keyboard help | Good idea | Medium: discoverability weak | P1 |
| Sales | `/sales` / `SalesPage` | Receipts, refunds, insights, CSV export | Functional but manager-heavy | High | P1 |
| Sales | `ReceiptList` | Sales list | Functional | Medium | P1 |
| Sales | `ReceiptPreview` | Receipt detail/refund/void | Strong information value | High: refund safety and density | P1 |
| Inventory | `/products` / `ProductsPage` | Catalog, categories, alerts, stock control, lots, setup | Powerful but overloaded: 1272 lines | Critical | P0 |
| Inventory | `/products/new` / `ProductReceivePage` | Receiving and product creation | Important but too broad | High | P1 |
| Inventory | `/products/count` | Stock count via ProductsPage Control tab | Hidden route, unclear IA | High | P1 |
| Inventory | `ProductTable` | Product management table | Useful | Medium | P1 |
| Inventory | `ProductSetupForm` | Product setup metadata | Useful, form-heavy | High | P1 |
| Inventory | `ProductQuickCreate` | Fast product creation | Important for barcode workflow | High | P0 |
| Inventory | `StockControlPanel` | Adjustments/counting/reconciliation | Operationally important | High | P1 |
| Inventory | `AlertsPanel` | Low stock, expiry, dead stock, promo | Strong module idea | Medium | P1 |
| Customers | `/customers` / `CustomersPage` | Customer ledger, debt, profiles | Useful but very large: 905 lines | High | P1 |
| Customers | Customer debt panels | Debt tracking/payment | Commercially important in Lebanon | High | P0 |
| Dashboard | `/dashboard` / `DashboardPage` | Owner command center | Directionally strong | Medium | P1 |
| Accounting | `/accounting` / `AccountingPage` | Close day, expenses, cash flow, history | Solid business value | High: close-day safety | P1 |
| Suppliers | `/suppliers` / `SuppliersPage` | Supplier ledger, purchase orders, payments | Functional but visually older | Medium | P2 |
| Delivery | `/delivery` / `DeliveryPage` | Delivery order status management | Basic; not premium | Medium | P2 |
| Delivery | `/delivery/drivers` / `DriversPage` | Driver CRUD | Basic table/form | Medium | P2 |
| Staff | `/staff` / `StaffPage` | Users, roles, shifts, audit | Overloaded: 1010 lines | High | P1 |
| Settings | `/settings` / `SettingsPage` | Business profile, delivery, sync, security, backup | Overloaded: 1040 lines | High | P1 |
| Auth | `LoginScreen` | PIN/session/store login | Important, visually branded | High: first impression | P0 |
| Layout | `Sidebar` / `BottomNav` | Navigation | Good foundation, grouping not ideal for retail ops | High | P0 |
| Layout | `Topbar` | Page identity, shift, sync, notifications | Useful, version hardcoded | Medium | P1 |
| Layout | `SyncStatus` | Offline/sync queue and errors | Important differentiator | High | P0 |
| System | `SuspendedOverlay` | License suspension | Clear but harsh | Medium | P2 |
| Error | `AccessDenied`, `ErrorBoundary`, `NotFoundPage` | Access and failure states | Basic | Medium | P1 |

## Other Apps

| App | Screens found | Purpose | Current design quality | UX risk | Priority |
|---|---|---|---|---|---|
| Admin | Dashboard, Tenants, Products, Customers, Sales, Reports, Delivery, Drivers, Staff, Login | Platform/admin back office | Separate app; not audited deeply here | Medium | P2 |
| Ordering | Find Store, Login, Menu, Orders, Tracking | Customer ordering portal | Needs separate buyer UX audit | High | P2 |
| Driver | Find Store, Login, Orders, Order Detail | Driver mobile workflow | Needs mobile-first audit | High | P2 |
| Owner | main/index only found | Owner portal shell | Scope unclear | Medium | P3 |

## Biggest Inventory Findings

1. Main commercial screens exist, but several are large monoliths and hard to reason about.
2. The POS screen has a clear scanner-first concept, but it needs workflow simplification and visual hierarchy tightening.
3. The navigation labels are usable for developers/managers, but not yet optimal for cashiers and store operators.
4. Many screens still contain hardcoded Tailwind color classes and mojibake text artifacts.
5. Mobile/tablet support exists structurally, but premium POS tablet behavior is not fully designed.


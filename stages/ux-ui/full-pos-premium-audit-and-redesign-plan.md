# TITAN POS Premium UX/UI Audit And Redesign Plan

Date: 2026-07-09

Auditor: Codex

Scope: deep product/design audit of the TITAN POS frontend, primarily `apps/desktop`, with secondary inventory of admin, ordering, driver, and owner apps.

## 1. Executive Summary

TITAN POS is not a blank prototype. It already has important commercial foundations: offline/local-first architecture, barcode-first checkout, product/catalog modules, stock control, batches/lots, customers/debt, delivery, staff/shift management, accounting close-day, sync status, dark/light tokens, Arabic/RTL foundations, and multi-app surfaces.

The problem is that the product currently feels like a powerful internal tool rather than a polished commercial POS. The strongest part is the cashier engine concept. The weakest parts are workflow hierarchy, consistency, and excessive screen complexity.

The target should not be "more decorative." The target should be:

> Fast retail operating console: scanner-first, touch-safe, visually premium, low training, and brutally clear under pressure.

Current strict scores:

| Dimension | Score |
|---|---:|
| Overall UX | 68/100 |
| Overall UI | 70/100 |
| POS cashier efficiency | 76/100 |
| Touchscreen readiness | 67/100 |
| Mobile readiness | 59/100 |
| Enterprise design readiness | 64/100 |
| Accessibility | 61/100 |
| Premium brand feel | 70/100 |
| Production design readiness | 62/100 |

The app can become premium without rewriting everything. But the redesign must prioritize operational clarity before visual ornament.

## 2. Biggest UX/UI Problems

| Severity | Problem | Evidence | Why it matters | Fix |
|---|---|---|---|---|
| Critical | Mojibake/encoding artifacts leak into comments and visible text | `â`, `Â`, `Ã` found in UI files; examples in POS, Sidebar, Settings, Dashboard, Drivers | A premium product cannot show corrupted punctuation or glyphs | Run encoding cleanup and replace with ASCII or proper UTF-8 |
| Critical | Main modules are too monolithic | Products 1272 lines, Staff 1010, Settings 1040, Customers 905, POSPage/QuickPOS combined over 1500 lines | These screens are hard to audit, hard to improve, and easy to break | Split by workflow, not by visual sections |
| Critical | POS payment flow is fast but not yet cashier-proof | Quick mode has Cash/Wallet/Debt but not Card; clear/change/due states are split across panels | Cashiers need zero ambiguity for 8-hour operation | Unify tender flow into a dedicated payment panel |
| High | Navigation is manager/developer shaped, not retail-role shaped | Groups are Register/Finance/Inventory/Operations/System | Cashier, owner, inventory worker need clearer mental model | Replace with Sell, Stock, Customers, Operations, Online, System |
| High | Theme uses token overrides to force old Tailwind colors | CSS remaps emerald to brand in many places | Green loses semantic meaning; bronze gets overused | Use semantic tokens correctly, not global class hijacking |
| High | Product/inventory workflows are powerful but compressed | Catalog, categories, alerts, control, lots, setup in one page | Operators need different mental modes for selling vs stock control | Split into catalog, receiving, stock count, batches, reorder |
| High | Mobile/tablet support exists, but responsive behavior is not product-specific enough | Bottom nav and drawer exist; no formal POS monitor/tablet/mobile model | POS use differs by device: cashier terminal, tablet manager, phone driver | Define device-specific layouts |
| High | Accessibility is partial | Focus-visible exists globally; many icon-only/custom buttons lack complete labels/focus handling | Commercial POS must survive keyboard, touch, and low-vision use | Add modal traps, aria labels, row keyboard behavior |
| Medium | Visual density is uneven | POS is dense; Delivery/Drivers are basic; Settings/Staff still old Tailwind | Product feels stitched together | Apply one component system across all screens |
| Medium | Dashboard is useful but not decisive enough | It has KPIs/action queue, but no single "what needs action now" command center | Owners need immediate operational answers | Make alert queue the core of dashboard |

## 3. Screen Inventory

The detailed inventory is in `stages/ux-ui/screen-inventory.md`.

Most important redesign priorities:

1. POS screen and payment flow.
2. Navigation model.
3. Product/inventory module.
4. Customer/debt module.
5. Settings/staff monolith cleanup.
6. Dashboard command center.
7. Delivery/driver mobile flows.

## 4. Page-By-Page Audit

### POS (`/`)

Current quality: strongest product area, but complex.

Issues:

- Critical: corrupted text appears in user-adjacent copy (`Enter â€” Pay`, `Esc to edit Â· Enter to confirm`, close button glyphs).
- High: Quick mode uses a full-screen overlay with its own payment rail, while normal mode uses `CartPanel`; this creates two payment UX standards.
- High: Card payment is not shown in `QuickPOSMode` payment options even though `PaymentMethod` includes `Card`.
- High: `Clean` is unclear and unsafe. Use `Clear Sale`.
- High: scanner status is useful but too low in hierarchy for error conditions.
- Medium: keyboard shortcuts exist, but the cashier does not get an obvious mode map.
- Medium: product grid minimum tile width is good, but tile rules need hard design spec.

Ideal layout:

- Top register strip: store/register, shift, sync, cashier, offline state.
- Main scanner/search command bar: always focused, shows last scanned product and error.
- Product work area: categories/favorites/product grid.
- Right cart rail: cart items, customer, discounts, total.
- Bottom/right payment zone: tender and Pay button.
- Drawer only for secondary review/refund/held sale.

Click/tap targets:

| Flow | Target |
|---|---|
| Barcode cash sale | scan items -> exact tender -> Pay: 2 cashier actions after scan |
| Product tap sale | tap product -> Pay: 2 actions |
| Search sale | focus already active -> type -> Enter -> Pay: 3 actions |
| Quantity edit | tap qty -> +/- or direct input: 1-2 actions |
| Customer debt sale | customer lookup -> Debt -> Pay: 3 actions |
| Mixed payment | amount USD -> amount LBP -> Pay: 3 actions |
| Refund | find receipt -> Return items -> Confirm refund: 4-5 actions |
| Hold/recall | Hold -> Recall shelf -> select: 2 actions |
| Offline sale | no extra action; clear visible offline queue |

### Products / Inventory (`/products`, `/products/new`, `/products/count`)

Current quality: feature-rich but overloaded.

Issues:

- Critical: `ProductsPage` combines catalog, categories, alerts, stock control, batches, setup, bulk edit, product edit, image generation, variants, duplicate barcodes, stock count, receiving-related data.
- High: product creation is not sufficiently barcode-first.
- High: stock count route is hidden as `/products/count`, but nav label does not expose it.
- High: Batches/Lots exist but need stronger expiry/FEFO presentation.
- Medium: category management is present but not navigationally visible enough.

Ideal redesign:

- Products list: table with image, name, barcode, category, price, stock, status, actions.
- Product drawer: overview, pricing, barcodes, variants, stock, lots, history.
- Add product modal/wizard: barcode -> name -> category -> price/cost -> stock -> supplier -> save.
- Receiving: supplier -> scan/add items -> costs -> lot/expiry -> confirm.
- Stock count: session list -> counting screen -> variance review -> commit.
- Reorder: action queue by supplier with WhatsApp/order export.

### Customers / Debt (`/customers`)

Current quality: commercially important, needs simplification.

Issues:

- High: customer debt is one of the strongest local-market features but does not feel first-class enough in POS.
- High: fast customer creation should be available from POS.
- High: debt risk/credit limit must be visible before checkout, not only at block time.
- Medium: statement/export flow should be more explicit.

Ideal redesign:

- Customer list with balance, risk, last purchase, phone.
- Customer profile drawer: statement, payments, debt sales, notes, credit limit.
- POS customer picker: search by phone/name, create in 15 seconds, show debt warning.
- Debt payment: amount, method, reference, receipt/WhatsApp.

### Dashboard (`/dashboard`)

Current quality: solid foundation.

Issues:

- Medium: dashboard answers many questions, but action queue should dominate above the fold.
- Medium: stock/debt/sync/cash-close alerts need direct links.
- Low: charts are acceptable but not differentiated from generic SaaS.

Ideal dashboard:

- Row 1: Today sales, gross profit, cash expected, debt issued/collected.
- Row 2: Action queue: low stock, expiry, debt risk, sync errors, unclosed shift.
- Row 3: revenue trend and payment mix.
- Side rail: recent sales, top products, branch sync health.

### Sales (`/sales`)

Current quality: functional, manager-heavy.

Issues:

- High: refund/void actions must be wizard-like and safer.
- Medium: two-pane receipt preview is good on desktop, but mobile drawer needs stricter focus management.
- Medium: CSV export is useful but should include filtered-state summary.

Ideal redesign:

- Receipts table + preview drawer.
- Return wizard: select items, quantity, reason, refund method, stock action.
- Receipt actions: print, WhatsApp, refund, void, duplicate receipt.

### Accounting (`/accounting`)

Current quality: good operational module.

Issues:

- High: close-day must feel like a controlled checklist, not a normal form action.
- Medium: expenses and cash flow need clearer cash/card/bank separation.

Ideal redesign:

- Close day checklist: sales total, refunds, expenses, supplier payments, expected cash, counted cash, discrepancy, notes, close.
- Cash flow ledger with filters and export.

### Staff / Shifts (`/staff`)

Current quality: powerful but overloaded.

Issues:

- High: team, shifts, permissions, audit are one huge page.
- High: shift close needs a more guided cash-count workflow.
- Medium: role permissions are displayed but not easy to understand operationally.

Ideal redesign:

- Team page: users, roles, status.
- Shifts page: open shift, close shift, cash count, discrepancy.
- Audit page: filterable event list.

### Settings (`/settings`)

Current quality: important but overloaded and visually older.

Issues:

- High: business profile, cloud sync, security, backup, and delivery are all inside one 1040-line page.
- High: cloud sync uses technical terms that normal retailers will not understand.
- High: backup/recovery card is valuable but hidden in a technical settings area.

Ideal redesign:

- Settings landing page with cards: Business, Register, Payments, Sync, Backup, Delivery, Staff/Security.
- Sync setup wizard: local-only -> connect cloud -> test -> pull data -> healthy.
- Backup page with explicit last backup, restore test, export, recovery card.

### Delivery / Drivers

Current quality: basic.

Issues:

- Medium: delivery orders are a list, not a dispatch board.
- Medium: driver screens are CRUD/table-heavy and not touch/mobile optimized.
- Medium: status progression lacks ETA/assignment clarity.

Ideal redesign:

- Delivery kanban: Pending, Confirmed, Preparing, Out for Delivery, Delivered.
- Driver assignment panel.
- Driver mobile app: large status actions, map/address/call, payment collection.

## 5. POS Screen Deep Audit

### What is wrong now

1. Two checkout modes mean two payment UIs.
2. Payment rail mixes tender, method, due/change, and confirmation in one dense column.
3. Some critical copy is corrupted.
4. `Clear`, `Clean`, `Complete Sale`, `Debt` are not precise enough.
5. Offline/sync is present but not integrated into the cashier decision surface.
6. Out-of-stock and low-stock handling exists, but product cards need stronger visual states.
7. Hold sale is functional but not visually treated as a shelf/queue.

### What should change

- Make scanner-first mode the default, not an overlay that feels separate.
- Build one shared `PaymentPanel`.
- Use one `SaleReviewDialog`.
- Show `Pay $X` as the final action.
- Add `Return mode`.
- Add barcode-not-found manager path.
- Put sync/shift/register status inside the POS screen.

### Ideal POS layout

Desktop terminal:

```text
---------------------------------------------------------+
| Register strip: shift | cashier | sync | branch        |
+-----------------------------+---------------------------+
| Scanner / search command    | Cart / customer / total   |
+-----------------------------+---------------------------+
| Categories / favorites      | Cart items                |
| Product grid                | Tender / payment          |
|                             | Pay $X                    |
+-----------------------------+---------------------------+
```

Tablet:

- Scanner top.
- Product grid full width.
- Floating cart summary.
- Cart/payment drawer.

Phone:

- Not ideal for primary checkout except small/mobile sellers.
- Use Quick POS only: scan/search, cart drawer, payment drawer.

## 6. Navigation Audit

Current nav:

- Register: POS, Sales, Customers
- Inventory: Products, Receiving, Suppliers
- Finance: Dashboard, Accounting
- Operations: Delivery, Staff
- System: Settings

Issues:

- `Dashboard` under Finance is too narrow; it is an owner command center.
- `Customers` under Register is acceptable, but debt belongs under Customers.
- `Suppliers` under Inventory is acceptable, but supplier payments are finance-adjacent.
- `Receiving` should be `Stock Receiving`.
- `Sales` should expose receipts/returns/held sales more clearly.

Recommended nav:

| Group | Items |
|---|---|
| SELL | POS, Receipts, Returns, Held Sales |
| STOCK | Products, Stock Receiving, Stock Count, Batches/Lots, Reorder Alerts, Suppliers |
| CUSTOMERS | Customers, Customer Debt, Loyalty |
| OPERATIONS | Dashboard, Accounting, Staff, Shifts, Expenses |
| ONLINE | Delivery, Drivers, Online Orders |
| SYSTEM | Settings, Sync Center, Security, Company |

Use role-based defaults:

- Cashier: POS, Receipts, Customers, Shift.
- Manager: POS, Dashboard, Products, Stock Count, Customers, Staff.
- Owner/Admin: all modules.

## 7. Product / Inventory Audit

The product module should become the operational stock command center.

Required final screens:

- Product list.
- Product detail drawer.
- Add product wizard.
- Scan barcode to create product.
- Variant manager.
- Barcode aliases.
- Unit/weighted item support.
- Batch/expiry screen.
- Receiving screen.
- Stock count screen.
- Adjustment/damage flow.
- Transfer flow for multi-branch.
- Inventory history.
- Reorder queue.

Immediate design specification:

- Product row height: 56px table, 72px touch table.
- Product card: min 156px height, 16px padding, 14px bold name, 12px metadata, 18px price.
- Stock badge: In stock, Low, Out, Expiring, No barcode.
- Barcode field must be first in add-product flow.

## 8. Customer / Debt / Loyalty Audit

TITAN POS has strong local-market potential here.

Missing premium behavior:

- Fast customer lookup from POS by phone.
- Customer creation inline during sale.
- Credit limit warning before checkout.
- Statement view/export.
- Payment plan / partial debt payment.
- Loyalty-ready structure.
- Customer risk flags.

Recommended POS customer picker:

- Search input: phone/name.
- Top result selected with Enter.
- `New Customer` button.
- Debt chip: `Owes $X`.
- Risk chip: `Over limit`, `Near limit`, `Good`.

## 9. Dashboard Audit

The dashboard should answer:

- What happened today?
- What needs action now?
- Is cash correct?
- Are we profitable?
- What is low stock?
- What is expiring?
- Who owes money?
- Is sync healthy?

Recommended above-the-fold:

1. Today net paid.
2. Gross margin.
3. Expected cash.
4. Outstanding customer debt.
5. Action queue.

Action queue should be the main surface, not a side widget.

## 10. Payment UX Audit

Current payment types: Cash, Card, Wallet, Debt in types, but Quick mode only lists Cash, Wallet, Debt.

Required final payment panel:

- Method tiles: Cash, Card, Wallet, Customer Debt, Split.
- USD paid.
- LBP paid.
- Exact USD.
- Exact LBP.
- Common notes: 1, 5, 10, 20, 50, 100 USD; 100k, 250k, 500k, 1M LBP.
- Still due / Change due.
- Final action: `Pay $X`.
- Receipt choice after payment: Print, WhatsApp, No receipt.

Safety rules:

- Underpayment blocks.
- Overpayment shows exact change.
- Debt requires customer.
- Mixed payment shows converted total and exchange rate.
- Failed payment preserves cart.

## 11. Responsive Design Audit

| Device | Recommended behavior |
|---|---|
| 15-inch laptop | Normal POS with persistent cart rail; compact product grid |
| 22-inch POS monitor | Larger product cards, persistent cart, payment always visible |
| Touchscreen POS | 52px controls, no hover-only affordances, bigger category chips |
| Tablet | Product grid + cart drawer + bottom total bar |
| Mobile | Quick POS, manager review, driver/delivery, not full inventory admin |
| Customer display | Total/items/payment/change only; no admin nav |

Minimum touch target:

- Normal controls: 44px.
- POS primary payment controls: 52-64px.
- Product tile tappable area: full card.

## 12. Accessibility Audit

Current positives:

- Global focus-visible exists.
- Reduced motion exists.
- Some dialogs use `role=dialog`.
- Icon library is consistent in many places.

Gaps:

- Several icon-only buttons need labels.
- Modals/drawers need consistent focus trap.
- Table rows need keyboard support.
- Color is sometimes the only status cue.
- Toasts need ARIA live region.
- Custom segmented controls need keyboard navigation.

Exact fixes:

- Every icon-only button: `aria-label`.
- Every modal: focus first interactive, trap focus, Escape closes, restore focus.
- Toast container: `role=status` or `aria-live=polite`.
- Errors: visible text next to fields and summary at top.
- Tables: row `tabIndex=0`, Enter opens, Escape closes drawer.

## 13. Microcopy Audit

| Current text | Problem | Better text | Where |
|---|---|---|---|
| Clean | Ambiguous | Clear Sale | Cart/POS |
| Complete Sale | Not specific | Pay $X | POS payment |
| Debt | Too blunt/unclear | Customer Debt | Payment/customer surfaces |
| Receiving | Vague | Stock Receiving | Nav |
| Control | Vague tab | Stock Control | Products |
| Lots | Could confuse normal users | Batches / Lots | Products |
| No shift | OK but weak | Register closed / No shift open | Topbar |
| Sync now | OK | Sync now | Keep |
| Clear stuck | Technical | Remove failed sync items | Sync dropdown |
| Add Supplier | OK | Add Supplier | Keep |
| Pay supplier | OK | Record Supplier Payment | Suppliers |
| Close day | OK | Close Business Day | Accounting |
| New device? Connect to your store | Good | Keep | Login |

## 14. Component Design System Recommendations

Core components to formalize:

- `Button`: primary, secondary, danger, success, ghost, icon.
- `ScannerInput`: focused barcode/search input with scanner status.
- `ProductCard`: compact/image/list/favorite variants.
- `CartItem`: item, quantity, unit price, line total, remove.
- `PaymentTile`: payment method with selected state.
- `MoneyText`: already exists; enforce across all money.
- `DataTable`: sticky header, density, row actions, empty/loading states.
- `Drawer`: right side and bottom sheet variants.
- `Modal`: confirmation and form variants.
- `Toast`: success/error/warning/info with action.
- `StatusBadge`: synced/offline/low-stock/paid/debt.
- `ActionQueueItem`: dashboard alert/action.

Usage rules:

- Use bronze for brand and active state.
- Use green only for success/paid/online.
- Use red only for destructive/danger.
- Use amber only for warning/review.
- Never rely on color alone.

## 15. Premium Design Tokens

Recommended core:

```css
:root {
  --titan-black: #07090D;
  --titan-graphite: #11151D;
  --titan-surface: #151A23;
  --titan-surface-2: #1C222E;
  --titan-border: rgba(226, 232, 240, 0.10);
  --titan-border-strong: rgba(226, 232, 240, 0.18);
  --titan-gold: #D6A63A;
  --titan-gold-hover: #E2BC59;
  --titan-gold-soft: rgba(214,166,58,0.12);
  --titan-text: #F8FAFC;
  --titan-muted: #9AA4B8;
  --titan-faint: #64748B;
  --success: #22C55E;
  --danger: #EF4444;
  --warning: #F59E0B;
  --info: #38BDF8;
  --radius-sm: 6px;
  --radius-md: 8px;
  --radius-lg: 12px;
  --shadow-1: 0 1px 2px rgba(0,0,0,.28);
  --shadow-2: 0 8px 24px rgba(0,0,0,.34);
  --shadow-3: 0 20px 60px rgba(0,0,0,.45);
}
```

Recommendation: keep sidebar dark in both themes. It is a strong brand anchor and improves mode consistency.

## 16. Competitor Benchmark

Current competitor references used: Toast official POS page, Lightspeed official retail POS page, Shopify POS official page, Square/Clover current market references.

| Competitor | Patterns worth copying | Avoid | TITAN gap |
|---|---|---|---|
| Square | Mode-based POS, handheld-first simplicity, fast checkout | Over-generic small-business feel | TITAN needs simpler cashier flows and better mobile payment polish |
| Toast | All-in-one operations, service-model views, hardware/KDS/delivery ecosystem; Toast emphasizes orders, payments, inventory, staff, customers in one system and high-volume environments | Restaurant-first complexity for pure retail | TITAN needs clearer restaurant/cafe mode if serving cafes |
| Lightspeed | Deep inventory, supplier, multi-location, analytics | Higher learning curve | TITAN inventory is feature-rich but needs cleaner workflow |
| Shopify POS | Omnichannel selling, inventory across locations, staff permissions; Shopify highlights connected online/in-person commerce and inventory management | Cloud/e-commerce bias, weaker offline story | TITAN can win on offline/LAN sync, but needs online ordering polish |
| Clover | Hardware ecosystem and simple SMB interface | Hardware/vendor lock-in feel | TITAN needs device-ready layouts and customer display |
| Odoo POS | Integrated ERP modules | Generic UI and configuration complexity | TITAN can be more premium and retail-specific |
| Oracle MICROS | Enterprise hospitality, kitchen/display/device integration | Heavy enterprise complexity | TITAN needs enterprise trust without MICROS heaviness |
| NCR | Retail hardware, scanners, self-checkout, enterprise operations | Legacy/complex feel | TITAN needs clearer hardware/device story |
| Microsoft Dynamics Commerce | Enterprise omnichannel and back-office depth | Too complex for small stores | TITAN should keep low-training UX while adding owner controls |

Key benchmark conclusion:

TITAN's differentiator should be **offline-first Lebanese retail + dual-currency + debt + LAN sync + premium operational console**. Do not try to copy cloud-only Western POS assumptions.

## 17. Scores

| Category | Score | Reason |
|---|---:|---|
| Overall UX | 68 | Strong modules, but overloaded screens and inconsistent workflows |
| Overall UI | 70 | Good tokens and brand direction, but old Tailwind remnants and mojibake hurt trust |
| POS cashier efficiency | 76 | Scanner-first and quick mode are strong; payment needs simplification |
| Touchscreen readiness | 67 | Some 44px controls, but no complete terminal/tablet spec |
| Mobile readiness | 59 | Bottom nav/drawers exist, but mobile cashier/admin flows are not fully designed |
| Enterprise readiness | 64 | Offline/sync/accounting are strong; design governance weak |
| Accessibility | 61 | Basics exist; modal/table/custom control gaps remain |
| Premium brand feel | 70 | Black/bronze direction works; needs restraint and consistency |
| Production design readiness | 62 | Good foundation, not yet fully commercial-polished |

## 18. Redesign Roadmap

### Immediate: 1-2 days

| Item | Impact | Effort | Risk if ignored |
|---|---|---:|---|
| Encoding/mojibake cleanup | Very high | S | Product looks broken |
| POS microcopy cleanup | High | S | Cashier mistakes |
| Navigation label cleanup | High | S | Training friction |
| QuickPOS Card method fix | High | S | Payment mismatch |
| Button/input normalization pass | Medium | M | Visual inconsistency |

### Short term: 1-2 weeks

| Item | Impact | Effort | Risk |
|---|---|---:|---|
| POS payment panel redesign | Very high | M/L | Checkout errors |
| Product/inventory IA split | Very high | L | Inventory screens stay confusing |
| Customer debt POS flow | High | M | Local-market advantage underused |
| Dashboard action queue redesign | High | M | Owner dashboard stays passive |
| Modal/drawer accessibility pass | High | M | Keyboard/a11y failures |

### Medium term: 1-2 months

| Item | Impact | Effort | Risk |
|---|---|---:|---|
| Full product detail/receiving/stock count redesign | Very high | L | Inventory workflows remain expert-only |
| Delivery dispatch board | Medium | M | Delivery feels basic |
| Staff/shifts module split | Medium | M/L | Cash close remains fragile |
| Design system extraction | High | L | Inconsistency returns |
| Tablet/mobile dedicated layouts | High | L | Field usage weak |

### Long term

| Item | Impact | Effort | Risk |
|---|---|---:|---|
| Customer display | High | M | Hardware story incomplete |
| Kitchen/display/cafe mode | High for restaurants/cafes | L | Toast gap remains |
| Loyalty module | Medium | M/L | Customer retention gap |
| Multi-branch transfer UX | High | L | Multi-branch operations weak |
| Self-checkout/kiosk | Future differentiator | XL | Not needed for first release |

## 19. Top 100 UX/UI Improvements

See `stages/ux-ui/top-100-improvements.md`.

## 20. Final Verdict

TITAN POS has enough substance to become a serious commercial POS, but it is not yet at the premium design level requested. The best parts are the scanner-first POS concept, offline/sync model, dual-currency handling, inventory depth, customer debt, and operational dashboards. The weak parts are not a lack of features; they are clarity, consistency, and professional restraint.

Do not start with a global beauty pass. Start with:

1. POS payment/cashier workflow.
2. Encoding/microcopy cleanup.
3. Navigation model.
4. Product/inventory screen split.
5. Customer debt flow.

After that, a visual polish sprint will actually land on a stable structure instead of decorating complexity.


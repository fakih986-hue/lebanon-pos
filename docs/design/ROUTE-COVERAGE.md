# Route and workflow coverage: Midnight Gold v2

**Sources.**
- Routes come from `apps/desktop/src/routes/index.tsx` (via `EXPERIENCE-INVENTORY.md`).
- Previews are in `docs/design/prototypes/`. Each preview exists in English and Arabic (`.ar.html`), and the theme is set with `?theme=dark|light`.

**Status (2026-10-16).** One vertical slice is built in the app: application shell → register → payment review → receipt, plus Simple POS (`apps/desktop`, scoped under `.mg2` in `features/pos/register-v2.css`). Everything else exists as previews only and still runs the v1 UI. Where v1 already does the underlying job, the matrix says so in "v1 behaviour".

## The four levels

| Level | Meaning | How it is proven |
|---|---|---|
| **1. Static preview** | The screen and its states are drawn in v2, in EN and AR, dark and light, at desktop, tablet and phone sizes | Rendered offline. `qa/report.json` shows **204/204 clean**: exact viewports, no overflow, fonts loaded, labelled controls, rendered text at AA |
| **2. Interactions prototyped** | The flow can be clicked through: open a dialog, submit, see the error and recover | Only the slice below, which went straight to level 3. The static previews have working native controls (radios, chips, links, the focus order) but no flow logic |
| **3. Production implementation** | Built in `apps/desktop` with v2 tokens and components, connected to the existing services | **Register and Simple POS** (slice). Business logic unchanged: `POSPage` state, `completeSale`, services |
| **4. Runtime validation** | The built v2 screen is exercised in the running app | **Partial, for the slice only:** the Vite dev server in local dev mode, scripted in headless Chrome (`docs/design/qa-app.cjs`): keyboard, focus trap and focus return with real key presses, offline checkout, **offline restart and queued-sale recovery against the real API on the scratch database** (`docs/design/qa-offline-recovery.cjs`, 12/12), permissions, EN/AR, dark/light, phone and desktop. **Not yet:** the Electron hub, a LAN till, a real receipt printer, a real scanner, a touch device |

**Not covered by any of these levels: design approval.**
- The automated checks (rendering, contrast, Better Design review) find defects. They do not approve a design.
- **Approval is yours**, on the previews.

## Routes and surfaces

**Legend:** ✅ done · ◐ partial · ○ not done

| Current route | v2 home | Preview | 1 Static | 2 Interactions | 3 Production | 4 Runtime | States drawn | v1 behaviour today |
|---|---|---|---|---|---|---|---|---|
| `/` | Sell › Register | 01, 02 | ✅ | ✅ (built) | ✅ | ◐ | Synced, offline + waiting count, review overlay, cash rounding, change, low-stock feedback | Full checkout (v1 UI) |
| `/` Quick mode | Sell › Register, Simple mode | 08 | ✅ | ✅ (built) | ✅ | ◐ | Offline, waiting, undo last scan | QuickPOSMode overlay |
| `/sales` (Receipts tab) | Sell › Receipts | **10** | ✅ | ✅ (built) | ✅ | ◐ | Built (2026-10-17): filters, refunded / voided / on account / cash-rounded marks, receipt drawer (LBP at the sale's rate, rounding as recorded), returns capped per line, void, permission reasons, empty. `qa/accounts-review.html`. Refund and void also refused by the services and the API without the permission (2026-10-19) | Same REFUND-INTEGRITY-1 services; `MoneyConflictsPanel` kept as is |
| `/sales?tab=insights` | **Unmigrated.** Later group: Money › Dashboard & analytics | 05 | ○ | ○ | **○ v1 UI** | ○ | Not redesigned: the v1 `InsightsPanel` renders inside the v2 Receipts page, unchanged. Belongs with the dashboard/analytics design group, not with Receipts | Insights (v1) |
| `/customers` | Money › Customers & debt | **11** | ✅ | ✅ (built) | ✅ | ◐ | Built (2026-10-17): views, owed by age, details (aging, limit, statement with running balance, payments), receive payment with the over-balance error and allowed amount, storage-full error, archived, empty. `qa/accounts-review.html` | Same customer service (FIFO aging, payment ids) |
| `/products` | Stock › Products | 03 | ✅ | ○ | ○ | ○ | Waiting (capsule), Low / Out with icon and word, expiring lots | Products page |
| `/products/new` | Stock › Receiving | 04 | ✅ | ○ | ○ | ○ | Unknown-barcode decision; Save enabled, leads to the row that needs a decision | Receiving |
| `/stock` | Stock › Lots & counts | 03, **18** | ✅ | ○ | ○ | ○ | Reconciliation (matches / explained untracked returns / lot short), explanation drawer (how untracked stock sells), count in progress. **Post count dialog**. Stock moved during count. All match. Cashier counts, manager posts | Stock & batches, reconciliation |
| `/suppliers` | Stock › Suppliers | **12** | ✅ | ✅ (built) | ✅ | ◐ | Built (2026-10-17): accounts and purchase-order tabs, details with open orders, statement, purchase-order drawer, pay against an order or the balance, empty. **Edit supplier** (2026-10-19): same id, needs suppliers.manage (service and API). The drawer-impact and no-open-shift states of preview 12 are not built | Same supplier service |
| `/dashboard` | Money › Today | 05 | ✅ | ○ | ○ | ○ | Money conflict (capsule, banner, primary "Review & settle", Close disabled with its reason), overdue debt, drawer short | Dashboard |
| `/accounting` | Money › Today / Shift / Expenses / Reports | 05, **19** | ✅ | ○ | ○ | ○ | Close the day: steps, blind count of USD and LBP notes, shifts, pre-checks. **Review dialog** (short with required reason). Blocked by rejected refunds. Another register open. Unsent sales. Day closed + Z report. Cashier permission | Close day, expenses, cash flow |
| `/delivery` | Delivery › Orders | **13** | ✅ | ○ | ○ | ○ | Board: new, preparing, out, delivered. No driver, late. **Assign driver dialog**. Driver offline. Online orders paused. Empty. Driver permission | Delivery orders |
| `/delivery/drivers` | Delivery › Drivers (tab) | 13, **20** | ✅ | ○ | ○ | ○ | Drivers with status and cash to hand over, driver day. **Cash handover dialog**, **Add driver dialog**. Unpaired driver app. Empty. Money permission | Drivers |
| `/staff` | Admin › Team & permissions | **14** | ✅ | ○ | ○ | ○ | Team list, role × permission matrix. **Add person dialog**, where the person sets their own PIN. Last-owner error. **Reset PIN confirm**. Manager read-only | Staff, shifts, audit |
| `/settings` Business | Admin › Store settings | 09 | ✅ | ○ | ○ | ○ | Validation error; Save enabled, leads to the error; unsaved changes; permission note | Settings › Business |
| `/settings` Devices & sync | Admin › Devices & sync | 06 | ✅ | ○ | ○ | ○ | Rejected changes (money vs other; Retry and Discard separate), licence grace, waiting / retrying counts, paired devices | Settings › Cloud sync |
| `/settings` Backup | Admin › Backup & recovery | 07, **21** | ✅ | ○ | ○ | ○ | Backups list, schedule, new-PC guidance. **Restore confirm** (unsent changes sent first). Restoring. Backup from another store refused. Offline. Restored. Owners only | Settings › Backup |
| `/settings` About | Admin › About & updates | **15** | ✅ | ○ | ○ | ○ | Update ready with release notes, versions per device (hub before tills), downloading, failed, offline, up to date, cashier can't install | Settings › About (updater) |
| *(outside router)* Lock | Lock screen | **16** | ✅ | ○ | ○ | ○ | User picker, PIN pad. Wrong PIN with tries left. Lockout countdown with manager unlock. Offline. Read-only licence | LoginScreen |
| *(outside router)* First setup | First setup | **17** | ✅ | ○ | ○ | ○ | 5-step wizard, rate sanity error, VAT help. Import with row errors (import the rest). Offline. No products. Finished | FirstSetupWizard |
| *(outside router)* Suspended | Global read-only banner | 07 | ✅ | ○ | ○ | ○ | Read-only / licence blocked | SuspendedOverlay |
| *(any)* Permission denied | Centered panel + Switch user | 07, 10, 11, 13, 14, 15 | ✅ | ○ | ○ | ○ | Disabled control with a linked reason; blocked page panel | AccessDenied |
| *(any)* Empty / loading | `EmptyState` / skeletons | 07, 10–13, 17 | ✅ | ○ | ○ | ○ | Empty with one action; skeleton | ad hoc |

**Totals: 22 surfaces.**

| Level | ✅ | ◐ | ○ |
|---|---|---|---|
| Static preview | 22 | 0 | 0 |
| Interactions | 2 | 0 | 20 |
| Production | 2 | 0 | 20 |
| Runtime | 0 | 2 | 20 |

The application shell (topbar and status capsule) is restyled on every route as part of the slice; page contents outside the register are unchanged.

## Key workflows

| Workflow | Static | Interactions | Production (v2) | Runtime | Notes |
|---|---|---|---|---|---|
| Scan → cart → cash with LBP rounding → change → receipt | ✅ 01, 02, 08 | ✅ | ✅ | ◐ | Built and exercised: cash-payable money rule on the total, pay button, review and receipt; F2–F5 / F8 / Enter / Esc; focus back on the scan field after review and after a sale; offline sale queued; Cashier permissions |
| Refund part of a receipt (limits, original rate, method) | ✅ 10 | ✅ | ✅ | ◐ | Receipt drawer → returns → confirm; REFUND-INTEGRITY-1 services; sales.refund enforced in the service and the API |
| Rejected offline refund → manager settles | ✅ 05, 06, 07, 10 | ○ | ○ | ○ | v1 `MoneyConflictsPanel` implements the settlement |
| Record a customer payment | ✅ 11 | ✅ | ✅ | ◐ | Over-balance refused with the allowed amount; one payment per attempt |
| Receive a delivery with an unknown barcode | ✅ 04 | ○ | ○ | ○ | |
| Pay a supplier from the drawer | ✅ 12 | ◐ | ◐ | ◐ | Paying a supplier is built; showing the drawer impact and the no-open-shift case is not |
| Edit a supplier (same id; orders, payments, balance kept) | ○ | ✅ | ✅ | ◐ | Not in the previews; built 2026-10-19; real-Postgres retry test |
| Assign a delivery driver | ✅ 13 | ○ | ○ | ○ | |
| Add a person / reset a PIN | ✅ 14 | ○ | ○ | ○ | |
| Lock / unlock / lockout | ✅ 16 | ○ | ○ | ○ | |
| First setup | ✅ 17 | ○ | ○ | ○ | |
| Install an update | ✅ 15 | ○ | ○ | ○ | |
| Close the day | ✅ 19 | ○ | ○ | ○ | Blind count, review with required reason, blocks |
| Stock reconciliation | ✅ 18 | ○ | ○ | ○ | Includes untracked returns and how they sell |

## System-state coverage (design system §6)

| State | Where it is previewed |
|---|---|
| Licence blocked / read-only | 07, 16 |
| Money conflict | 05, 06, 07, 10 |
| Other rejected operations | 06, 07 |
| Recovery in progress / recovered | 07 |
| Offline | 02, 07, 08, 15, 16, 17 |
| Waiting to send | 03, 06, 07, 08, 10 |
| Licence grace | 06, 07 |
| No open shift | 07, 12 |
| All good | 01, 04, 09, 11–15 |
| Permission denied / disabled control | 07, 10, 11, 13, 14, 15 |
| Validation error / unsaved changes | 09, 10, 11, 17 |

## Lists on phones (decided per task)

| Page | Phone layout | Why |
|---|---|---|
| Receipts, Customers, Team, Drivers | **Cards** (`.cards-sm`) | Each row is one decision: open it, act on it |
| Products, Suppliers, Reconciliation, Backups | **Column prioritization** (`.prio`, `.col-opt` drops out) | People scan and compare one or two numbers (stock, balance, finding) |
| Receiving | **Horizontal scroll** | Data entry: every column is needed while typing a delivery |

## Still missing before migration

1. **Runtime validation of the slice** on the Electron hub, a LAN till, a receipt printer, a barcode scanner and a touch screen.
2. ~~Register strings~~: scanner statuses and the Cash Drawer are localized (EN/AR). The Record Expense widget in the empty cart rail is still English-only.
3. **Interaction prototypes / implementation** for the other 20 surfaces, after the slice is accepted.

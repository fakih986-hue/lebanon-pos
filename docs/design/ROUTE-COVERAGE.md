# Route and workflow coverage: Midnight Gold v2

**Sources.**
- Routes come from `apps/desktop/src/routes/index.tsx` (via `EXPERIENCE-INVENTORY.md`).
- Previews are in `docs/design/prototypes/`. Each preview exists in English and Arabic (`.ar.html`), and the theme is set with `?theme=dark|light`.

**Status (2026-10-16): the v2 design exists only as previews.** None of it has been built into the app yet. The production app still runs the v1 UI. Where v1 already does the underlying job, the matrix says so in "v1 behaviour".

## The four levels

| Level | Meaning | How it is proven |
|---|---|---|
| **1. Static preview** | The screen and its states are drawn in v2, in EN and AR, dark and light, at desktop, tablet and phone sizes | Rendered offline. `qa/report.json` shows **204/204 clean**: exact viewports, no overflow, fonts loaded, labelled controls, rendered text at AA |
| **2. Interactions prototyped** | The flow can be clicked through: open a dialog, submit, see the error and recover | Nothing at this level yet. The previews are static. Native controls work (radios, chips, links, the focus order), but there is no flow logic |
| **3. Production implementation** | Built in `apps/desktop` with v2 tokens and components | Not started for any surface |
| **4. Runtime validation** | The built v2 screen is tested in the running app: browser, hub, a real printer and device, EN/AR | Not started |

**Not covered by any of these levels: design approval.**
- The automated checks (rendering, contrast, Better Design review) find defects. They do not approve a design.
- **Approval is yours**, on the previews.

## Routes and surfaces

**Legend:** ✅ done · ◐ partial · ○ not done

| Current route | v2 home | Preview | 1 Static | 2 Interactions | 3 Production | 4 Runtime | States drawn | v1 behaviour today |
|---|---|---|---|---|---|---|---|---|
| `/` | Sell › Register | 01, 02 | ✅ | ○ | ○ | ○ | Synced, offline + waiting count, review overlay, cash rounding, change, low-stock feedback | Full checkout (v1 UI) |
| `/` Quick mode | Sell › Register, Simple mode | 08 | ✅ | ○ | ○ | ○ | Offline, waiting, undo last scan | QuickPOSMode overlay |
| `/sales` | Sell › Receipts | **10** | ✅ | ○ | ○ | ○ | Partly refunded, voided, on debt, waiting to send. **Refund dialog** with a per-line limit error, the original rate and cash rounding. Void disabled with its reason. Server-rejected refund. Empty search. Cashier without Refunds permission | Refunds and voids with REFUND-INTEGRITY-1 rules; `MoneyConflictsPanel` |
| `/customers` | Money › Customers & debt | **11** | ✅ | ○ | ○ | ○ | Statement with refund credits. **Record payment dialog** with an over-balance error and an "allowed amount" button. Over-limit warning at checkout. Empty. No Debt permission | Customers, ledger, pay debt |
| `/products` | Stock › Products | 03 | ✅ | ○ | ○ | ○ | Waiting (capsule), Low / Out with icon and word, expiring lots | Products page |
| `/products/new` | Stock › Receiving | 04 | ✅ | ○ | ○ | ○ | Unknown-barcode decision; Save enabled, leads to the row that needs a decision | Receiving |
| `/stock` | Stock › Lots & counts | 03 (lots in drawer) | ◐ | ○ | ○ | ○ | Expiry chips, "stock matches lots". Not drawn yet: the reconciliation view with `unallocated_return` | Stock & batches, reconciliation |
| `/suppliers` | Stock › Suppliers | **12** | ✅ | ○ | ○ | ○ | Statement. **Pay supplier dialog** that shows the drawer impact. Cash payment with no open shift. Empty. Archived supplier with a balance | Suppliers, POs, payments |
| `/dashboard` | Money › Today | 05 | ✅ | ○ | ○ | ○ | Money conflict (capsule, banner, primary "Review & settle", Close disabled with its reason), overdue debt, drawer short | Dashboard |
| `/accounting` | Money › Today / Shift / Expenses / Reports | 05 (tabs) | ◐ | ○ | ○ | ○ | Not drawn yet: the close-day flow | Close day, expenses, cash flow |
| `/delivery` | Delivery › Orders | **13** | ✅ | ○ | ○ | ○ | Board: new, preparing, out, delivered. No driver, late. **Assign driver dialog**. Driver offline. Online orders paused. Empty. Driver permission | Delivery orders |
| `/delivery/drivers` | Delivery › Drivers (tab) | 13 (tab and assign dialog) | ◐ | ○ | ○ | ○ | Driver availability in the assign dialog. Not drawn yet: the drivers list page | Drivers |
| `/staff` | Admin › Team & permissions | **14** | ✅ | ○ | ○ | ○ | Team list, role × permission matrix. **Add person dialog**, where the person sets their own PIN. Last-owner error. **Reset PIN confirm**. Manager read-only | Staff, shifts, audit |
| `/settings` Business | Admin › Store settings | 09 | ✅ | ○ | ○ | ○ | Validation error; Save enabled, leads to the error; unsaved changes; permission note | Settings › Business |
| `/settings` Devices & sync | Admin › Devices & sync | 06 | ✅ | ○ | ○ | ○ | Rejected changes (money vs other; Retry and Discard separate), licence grace, waiting / retrying counts, paired devices | Settings › Cloud sync |
| `/settings` Backup | Admin › Backup & recovery | 07 (recovery banner) | ◐ | ○ | ○ | ○ | Recovery progress. Not drawn yet: the backup page | Settings › Backup |
| `/settings` About | Admin › About & updates | **15** | ✅ | ○ | ○ | ○ | Update ready with release notes, versions per device (hub before tills), downloading, failed, offline, up to date, cashier can't install | Settings › About (updater) |
| *(outside router)* Lock | Lock screen | **16** | ✅ | ○ | ○ | ○ | User picker, PIN pad. Wrong PIN with tries left. Lockout countdown with manager unlock. Offline. Read-only licence | LoginScreen |
| *(outside router)* First setup | First setup | **17** | ✅ | ○ | ○ | ○ | 5-step wizard, rate sanity error, VAT help. Import with row errors (import the rest). Offline. No products. Finished | FirstSetupWizard |
| *(outside router)* Suspended | Global read-only banner | 07 | ✅ | ○ | ○ | ○ | Read-only / licence blocked | SuspendedOverlay |
| *(any)* Permission denied | Centered panel + Switch user | 07, 10, 11, 13, 14, 15 | ✅ | ○ | ○ | ○ | Disabled control with a linked reason; blocked page panel | AccessDenied |
| *(any)* Empty / loading | `EmptyState` / skeletons | 07, 10–13, 17 | ✅ | ○ | ○ | ○ | Empty with one action; skeleton | ad hoc |

**Totals: 22 surfaces.**

| Level | ✅ | ◐ | ○ |
|---|---|---|---|
| Static preview | 18 | 4 | 0 |
| Interactions | 0 | 0 | 22 |
| Production | 0 | 0 | 22 |
| Runtime | 0 | 0 | 22 |

## Key workflows

| Workflow | Static | Interactions | Production (v2) | Runtime | Notes |
|---|---|---|---|---|---|
| Scan → cart → cash with LBP rounding → change → receipt | ✅ 01, 02, 08 | ○ | ○ | ○ | The money display follows the cash-payable rule (DESIGN-SYSTEM §7) |
| Refund part of a receipt (limits, original rate, method) | ✅ 10 | ○ | ○ | ○ | The rules are implemented and tested in v1 (REFUND-INTEGRITY-1) |
| Rejected offline refund → manager settles | ✅ 05, 06, 07, 10 | ○ | ○ | ○ | v1 `MoneyConflictsPanel` implements the settlement |
| Record a customer payment | ✅ 11 | ○ | ○ | ○ | |
| Receive a delivery with an unknown barcode | ✅ 04 | ○ | ○ | ○ | |
| Pay a supplier from the drawer | ✅ 12 | ○ | ○ | ○ | |
| Assign a delivery driver | ✅ 13 | ○ | ○ | ○ | |
| Add a person / reset a PIN | ✅ 14 | ○ | ○ | ○ | |
| Lock / unlock / lockout | ✅ 16 | ○ | ○ | ○ | |
| First setup | ✅ 17 | ○ | ○ | ○ | |
| Install an update | ✅ 15 | ○ | ○ | ○ | |
| Close the day | ◐ 05 | ○ | ○ | ○ | Flow not drawn |
| Stock reconciliation | ◐ 03 | ○ | ○ | ○ | Not drawn |

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

## Still missing before migration

1. **Static (◐):**
   - lots and reconciliation view;
   - close-day flow;
   - drivers list;
   - backup page.
2. **Mobile list pattern.** On phones, list pages (10–12, 14) keep their table inside a horizontal scroller. A card-list variant for phones is designed in the system but not drawn.
3. **Level 2 interaction prototypes.** Recommended first: checkout with cash rounding, refund, and settle.

# Route coverage — Midnight Gold v2 prototypes

**Sources:** routes are from `apps/desktop/src/routes/index.tsx` (via `EXPERIENCE-INVENTORY.md`); prototypes are in `docs/design/prototypes/` (each in EN + AR; theme via `?theme=`).

**Legend**

| Mark | Meaning |
|---|---|
| ✅ | A prototype shows this route's main screen |
| ◐ | Partly shown (a tab, drawer, or pattern of it) |
| ○ | Not prototyped yet — will use the listed pattern; needs a preview before migration |

## Routes

| Current route | Today | v2 home (workspace › page) | Prototype | Coverage | System states shown |
|---|---|---|---|---|---|
| `/` | POS | Sell › Register | 01 Register checkout, 02 Payment review, 08 Simple POS | ✅ | Synced (01); **offline**, pending count, will-sync badge (02); offline + pending (08) |
| `/` (Quick mode) | QuickPOSMode overlay | Sell › Register in **Simple mode** (same register, no grid) | 08 Simple POS | ✅ | Offline, pending |
| `/sales` | Sales (receipts, insights, refund, void) | Sell › Receipts | — (pattern: 03 list + details drawer) | ○ | Money-conflict panel exists **in code** (`MoneyConflictsPanel`), not yet in the v2 visual |
| `/customers` | Customers (ledger, pay debt) | Money › Customers & debt | — (pattern: 03 list + drawer, 05 tiles) | ○ | — |
| `/products` | Products | Stock › Products | 03 Products & lots | ✅ | Pending (capsule), low / expiring / out-of-stock badges |
| `/products/new` | Receiving | Stock › Receiving | 04 Receiving | ✅ | Unknown-barcode decision, blocked save with reason |
| `/stock` | Stock & Batches (adjust/count, batches, opening, reconciliation) | Stock › Lots & counts | 03 (lots in product drawer) | ◐ | Expiry chips, "stock matches ledger" note. Reconciliation exceptions (incl. `unallocated_return`) not yet drawn |
| `/suppliers` | Suppliers | Stock › Suppliers | — (pattern: 03 list + drawer) | ○ | — |
| `/dashboard` | Dashboard | Money › Today | 05 Money today | ✅ | **Money conflict** (capsule + banner + queue item), drawer short, overdue debt |
| `/accounting` | Close day, expenses, cash flow, history, shift | Money › Today / Shift & drawer / Expenses / Reports | 05 (tabs + "Close the day" action) | ◐ | Shift-closed banner (07). Close-day flow not drawn |
| `/delivery` | Delivery orders | Delivery › Orders board | — | ○ | — |
| `/delivery/drivers` | Drivers | Delivery › Drivers (tab) | — | ○ | — |
| `/staff` | Team, shifts, audit | Admin › Team & permissions (shift → Money) | — | ○ | Permission-denied panel and disabled control pattern (07) |
| `/settings` Business | Settings › Business | Admin › Store settings | 09 Settings form | ✅ | Validation error, unsaved-changes bar, blocked save, permission note |
| `/settings` Devices & Sync | Settings › Cloud sync | Admin › Devices & sync | 06 Devices & sync | ✅ | **Rejected changes** (money vs other), **licence grace**, pending/retrying counts, paired devices |
| `/settings` Backup | Settings › Backup | Admin › Backup & recovery | — (07 recovery banner) | ◐ | Recovery progress banner |
| `/settings` About | Settings › About (updater) | Admin › About & updates | — | ○ | — |
| *(outside router)* Lock / login | LoginScreen | Lock screen (PIN pad) | — | ○ | — |
| *(outside router)* First setup | FirstSetupWizard | Admin › Store settings › Catalog setup | — | ○ | — |
| *(outside router)* Suspended | SuspendedOverlay | Global read-only banner | 07 | ✅ | **Read-only / license blocked** |
| *(any)* Permission denied | AccessDenied | Centered panel + Switch user | 07 | ✅ | Permission |
| *(any)* Empty / loading | ad-hoc | `EmptyState` / skeletons | 07 | ✅ | Empty, loading |

**Totals:** 22 surfaces — **10 ✅ · 4 ◐ · 8 ○**.

## System-state coverage (design system §6)

| State | Where it is previewed |
|---|---|
| License blocked / read-only | 07 |
| Money conflict | 05 (capsule, banner, queue), 06 (rejected list), 07 |
| Other rejected operations | 06, 07 |
| Recovery in progress / recovered | 07 |
| Offline | 02, 08, 07 |
| Pending | 03, 06, 07, 08 |
| License grace | 06, 07 |
| No open shift | 07 |
| All good | 01, 04, 09 |
| Permission denied / disabled control | 07 |
| Validation error / unsaved changes | 09 |

## Before full migration

These ○ surfaces still need a preview: Receipts, Customers & debt, Suppliers, Delivery (orders + drivers), Team & permissions, About & updates, Lock screen, First setup. Plus the close-day flow and the reconciliation view as ◐ follow-ups.

All of them reuse patterns already prototyped:

- the list + details drawer (03)
- KPI tiles + action queue (05)
- the form + sticky save bar (09)
- the PIN pad (design system §7)

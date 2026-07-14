# POS-UX-IA-2 — Navigation & Screen Structure Simplification (PLAN)

**Date:** 2026-07-14
**Status:** audit + plan only — **no code changes until reviewed**
**Builds on:** [pos-ux-ia-1-audit.md](pos-ux-ia-1-audit.md) (exhaustive per-button map) + shipped IA-1A/1B.
**Guardrail:** no stock / sync / tender / tax / refund / ledger / shift **business logic** touched — this is placement, naming, grouping, and disclosure only.

---

## 1. Current UI map (as of 1.0.35)

### Sidebar (single nav; same list on mobile BottomNav), filtered by `userCan(permission)`
| Group | Item | Route | Permission |
|-------|------|-------|-----------|
| Register | POS | `/` | sales.checkout |
| Register | Sales | `/sales` | reports.view |
| Register | Customers | `/customers` | customers.manage |
| Inventory | Products | `/products` | inventory.manage |
| Inventory | Receiving | `/products/new` | inventory.manage |
| Inventory | Suppliers | `/suppliers` | accounting.manage |
| Finance | Dashboard | `/dashboard` | reports.view |
| Finance | Accounting | `/accounting` | accounting.manage |
| Operations | Delivery | `/delivery` | delivery.manage |
| Operations | Staff | `/staff` | staff.manage |
| System | Settings | `/settings` | settings.manage |

### Per-screen structure (tabs · key/destructive actions · modals · role)
- **POS** (`sales.checkout`): category tabs (All / Favorites / categories); search+scan; **Quick POS** mode; cart→tender (Cash/Card/Wallet/Debt), Discount (`sales.discount`), Sale note, Sell-at-cost; **Hold**, **Clear sale** (confirmed), discard-held; **Confirm Sale** modal; variant picker.
- **Sales** (`reports.view`): tabs Receipts / Insights; filters; Print; **Refund** (`sales.refund`), **Void** (`sales.void`) — confirmed.
- **Customers** (`customers.manage`): tabs Ledger / Pay debt; Add · Export · Record Payment; per-customer WhatsApp/Call/Edit/Statement/Print/Archive/**Delete** (confirmed); edit modal.
- **Products** (`inventory.manage`): **6 views** — Catalog / Categories / Alerts / **Stock control** / Batches / Add product; Tools menu (Generate Images, Bulk Edit), Export CSV; edit drawer; **Delete** product. **Stock control holds 5 tools:** adjustment form ("Apply adjustment"), physical **stock count**, recent adjustments, client "Run Scan" reconciliation, **Ledger Reconciliation** (Initialize ledger [Admin], Refresh, **Repair** modal).
- **Receiving** (`inventory.manage`, route `/products/new`): supplier + payment + invoice; batch rows (barcode lookup, generate/duplicate/**delete** row); **Save & Receive**; print labels.
- **Suppliers** (`accounting.manage`): tabs Accounts / Orders / Pay supplier / Activity; Add; Archive/**Delete**.
- **Dashboard** (`reports.view`): date range; KPI cards; charts; action queue → links to /products,/settings.
- **Accounting** (`accounting.manage`): tabs Close day / Expenses / Cash flow / History / **Shift** (shown when `shifts.manage`, IA-1B); Close day, Save expense; **Shift open/close** (confirmed).
- **Delivery** (`delivery.manage`): tabs Orders / Drivers; Mark-as-status; **Cancel order** (confirmed, IA-1A); Drivers add/edit, **deactivate** (confirmed, IA-1A).
- **Staff** (`staff.manage` = Admin): tabs Team / Shifts / Audit; Use (switch user), **Disable/Enable** (confirmed), Change PIN, Add user; **Shift open/close** (also here — duplicated with Accounting→Shift); role-permission reference (data-driven, correct).
- **Settings** (`settings.manage` = Admin): **6 tabs** — Business / Delivery / Cloud sync / Security (read-only) / Backup / About. Cloud sync sub-panels: connection mode, hub status + LAN toggle (confirmed), pairing + paired devices (revoke, confirmed), offline sync queue, cloud connection (super-admin unlock). Backup: Recovery card + **Danger zone** (Export/Restore, confirmed, IA-1A).
- **Web surfaces** (out of desktop scope): `apps/admin` (super-admin/tenants), `apps/driver`, `apps/ordering`.

### Role/permission model (authoritative `rolePermissions`)
- **Cashier:** `sales.checkout` only → sees POS only.
- **Manager:** checkout, discount, refund, void, inventory, customers, reports, accounting, shifts, delivery (**not** staff/settings).
- **Admin:** all 12.
- **Driver:** `delivery.manage`.

---

## 2. Navigation problems

**P1 — Products is overloaded (biggest issue).** One page carries the catalog *and* 5 distinct stock tools inside "Stock control" (adjust, count, recent adjustments, legacy scan, ledger reconcile+repair). Hard to find, hard to teach, dangerous actions (repair) sit next to routine ones.
**P2 — Settings is a 1,880-line, 6-tab mega-page.** "Cloud sync" alone nests 5 sub-panels (connection, hub/LAN, pairing/devices, offline queue, cloud connection). Devices, sync diagnostics, and backup are hard to locate.
**P3 — Reconciliation is buried** three levels deep (Products → Stock control → scroll). A tool an owner reaches for during an audit isn't discoverable.
**P4 — Receiving reads as "new product."** Route `/products/new` + proximity to Products' "Add product" view blurs "receive stock" vs "create a product."
**P5 — Shift open/close lives in two places** (Accounting→Shift *and* Staff→Shifts) → ambiguity about the canonical spot; Staff's copy is Admin-only, contradicting Managers' `shifts.manage`.
**P6 — Suppliers gated by `accounting.manage`** (semantic mismatch — it's purchasing/inventory) and grouped under "Inventory" while its permission is finance.
**P7 — Group labels are system-centric, not task-centric.** "Register / Inventory / Finance / Operations / System" — staff think "sell / stock / people / money / setup." "Staff" under "Operations" is unintuitive.
**P8 — Dangerous config is scattered**, not consistently in named danger zones (LAN toggle, device revoke live inside Cloud sync; backup export/restore now grouped — good, but the pattern isn't uniform).
**P9 — Two ways to create a product** (Products→Add product form vs Receiving) with no signposting of when to use which.
**P10 — "Batches" vs "Lots"** internal/label drift mostly fixed (label is "Batches"); the view value is still `Lots` (cosmetic/internal only).

---

## 3. Proposed final IA

### Target groups + items (task-centric names; keep cashier minimal)
```
SELL          POS                       (cashier home)
              Sales                     (receipts, refunds, insights)
STOCK         Products                  (catalog: Catalog · Categories · Alerts · Add product)
              Receiving                 (restock — stays 1 click; label reads "Receiving")
              Stock & Batches           (NEW home: Adjust & Count · Batches · Reconciliation)
              Suppliers                 (purchasing)
PEOPLE        Customers
              Staff                     (Admin: Team · Shifts history · Audit)
MONEY         Dashboard
              Accounting                (Close day · Expenses · Cash flow · History · Shift)
SYSTEM        Settings                  (Store · Devices & Sync · Data & Backup · About)
```
Item count stays ~12; the win is grouping by task and de-overloading Products/Settings.

### Page-by-page target
- **POS** — unchanged (protect cashier speed). Keep Quick POS, cart/tender, Confirm Sale, Hold/Clear.
- **Sales** — Receipts / Insights unchanged; Refund/Void stay in receipt detail, role-gated + confirmed.
- **Products** — **catalog master only:** Catalog / Categories / Alerts / Add product. Edit in a **drawer**; Delete inside the edit drawer (confirmed); Tools menu (Bulk Edit, Generate Images, Export). **Remove** the "Stock control" and "Batches" views (moved below).
- **Stock & Batches** (NEW) — the single home for stock operations, gated `inventory.manage`:
  - **Adjust & Count** — stock adjustment form + physical stock-count flow + recent adjustments.
  - **Batches** — the lots table (search/filter).
  - **Reconciliation** — the ledger report (A/B/L), **Initialize ledger** (Admin), and **Repair** (in a modal, confirmed). Retire the older client-only "Run Scan" in favor of the ledger report (or keep as a secondary "quick scan").
- **Receiving** — top-level, 1-click; make the route/label unambiguously "Receiving" (not `/products/new`). Signpost: "New products can be created here or in Products → Add product."
- **Suppliers** — under STOCK (purchasing); propose gating by `inventory.manage` (needs approval — permission change).
- **Customers** — Ledger / Pay debt unchanged; move to PEOPLE group.
- **Staff** (Admin) — Team / **Shifts (history & oversight)** / Audit. **Shift open/close becomes canonical in Accounting → Shift**; Staff → Shifts shows history/oversight only (removes the P5 duplication; no logic change, just which screen exposes the open/close controls).
- **Dashboard / Accounting** — MONEY group; Accounting keeps Close day / Expenses / Cash flow / History / **Shift** (Manager-reachable open/close).
- **Delivery** — Orders / Drivers unchanged.
- **Settings** — split the mega-page into 4 clear sub-pages:
  - **Store** — business info, tax/currency/USD-LBP rate, register, receipt (+ read-only Security summary folded in).
  - **Devices & Sync** — connection mode, hub status + LAN access, pairing + paired devices, offline sync queue/diagnostics, cloud connection (super-admin unlock). *(Delivery store-config also lives here or under Store.)*
  - **Data & Backup** — Recovery Card; **Danger zone** (Export/Restore) with confirmations (+ the deferred S1 admin-gate).
  - **About** — version + update.

### Placement rules (make it teachable)
- **Routine, frequent → visible tab/button.** Rare/dangerous → drawer, modal, or a clearly-labeled **Danger zone**.
- **One canonical home per action** (no action reachable two ways with different gates — resolves P5).
- **Destructive actions always confirm** and, where possible, are role-hidden from those who shouldn't act.
- **Reconciliation & repair** are discoverable (top-level under Stock) but repair stays behind a confirm+reason modal.

---

## 4. Findings split

### Safe quick wins (IA-2A — labels/tooltips/signposting; no structural move, no logic)
1. Rename sidebar groups to task-centric: **Sell / Stock / People / Money / System** (pure labels).
2. Make **Receiving**'s label/route read as "Receiving," not `/products/new` (perception; no behavior change).
3. Add a one-line signpost on Receiving and Products→Add product clarifying which to use (P9).
4. Normalize internal "Lots" → "Batches" (view value; cosmetic).
5. Add tooltips/section headers on Products→Stock control grouping its 5 tools until the IA-2B split lands.
6. Ensure every destructive action has a confirm (audit any missed spots beyond the IA-1A set).

### Needs approval (IA-2B — structural moves; still no business logic change)
7. **De-overload Products:** extract Stock control + Batches into a new **"Stock & Batches"** destination (Adjust & Count / Batches / Reconciliation). Surfaces reconciliation (P1, P3).
8. **Split Settings** into Store / Devices & Sync / Data & Backup / About (P2, P8).
9. **Shift open/close canonical in Accounting**; Staff → Shifts becomes history/oversight (P5).
10. **Suppliers** → gate by `inventory.manage` + place under Stock (P6) — a **permission change**, explicit approval required.
11. Group re-home: **Staff → People**, **Customers → People**, **Suppliers → Stock** (P7).

### Later structural refactor (IA-2C)
12. Consistent drawer/modal patterns + empty states across pages (visual/UX polish).
13. **S1 backup admin-gate + secret redaction** (export currently dumps PINs/tokens).
14. Route restructure so deep tools have stable URLs (e.g. `/stock/reconciliation`), enabling the Dashboard action-queue to deep-link.
15. Retire the legacy client-only reconciliation scan once the ledger report is the single source.

---

## 5. Role workflow maps

**Cashier** (`sales.checkout`): **POS only.** Scan/search → cart → tender → Confirm → receipt; Hold/resume; Quick POS. No back-office, no shift open (manager opens the till). — fast, uncluttered ✅ (unchanged by IA-2).

**Manager** (adds inventory/customers/reports/accounting/shifts/delivery): daily ops —
- Sell (POS/Sales, refunds/voids), **open/close shift** (Money → Accounting → Shift),
- Stock: **Receiving** (1 click), **Stock & Batches** (adjust/count/reconcile), Products catalog, Suppliers,
- People: Customers (debt), Money: Dashboard + Accounting close day.
- Not Staff admin, not Settings. Every routine task ≤ 2 clicks from the sidebar.

**Owner/Admin** (everything): all Manager flows + **Staff** (users/roles/PINs, shift history) + **Settings** (Store / Devices & Sync / Data & Backup / About) + **Initialize ledger** and reconciliation repair. Dangerous config isolated in danger zones.

**Driver** (`delivery.manage`): Delivery → assigned/broadcast orders → advance status → deliver (desktop Delivery page or the driver web app). No back-office.

---

## 6. Implementation phases

- **IA-2A — safe quick wins** (labels, group renames, Receiving perception, signposts, tooltips, confirm-coverage audit). Independently revertible; ship first.
- **IA-2B — structural moves** (approval-gated): new **Stock & Batches** destination (de-overload Products + surface Reconciliation); **Settings split** into 4 sub-pages; **shift canonicalization**; group re-homing; Suppliers permission/placement. No stock/sync/tender/tax/refund/ledger/shift logic changes — only where components render.
- **IA-2C — later refactor**: drawer/modal/empty-state consistency, **S1 backup admin-gate**, stable deep-link routes, retire legacy recon scan.

## Acceptance (this sprint)
No code changed. Current map, proposed map, role workflow maps (Cashier/Manager/Owner-Admin/Driver), and phased plan delivered. Awaiting review to choose which of IA-2A/2B/2C to implement (and the two permission decisions: Suppliers gate, shift canonicalization).

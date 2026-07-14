# POS-UX-IA-1 — Navigation & Workflow Placement Audit

**Date:** 2026-07-14
**Type:** IA / workflow audit — **review before any code change**. No code touched.
**Scope:** desktop SPA (`apps/desktop`); web surfaces (admin/driver/ordering) noted where relevant.

---

## 0. Role model (authoritative source: `security.service.ts` `rolePermissions`)

Roles: **Admin, Manager, Cashier, Driver.** Permission-based UI (`userCan(permission)`), route-gated via `RequirePermission`, nav filtered in `Sidebar`.

| Permission | Cashier | Manager | Admin | Driver |
|---|:--:|:--:|:--:|:--:|
| sales.checkout | ✅ | ✅ | ✅ | |
| sales.discount / refund / void | | ✅ | ✅ | |
| inventory.manage | | ✅ | ✅ | |
| customers.manage | | ✅ | ✅ | |
| reports.view | | ✅ | ✅ | |
| accounting.manage | | ✅ | ✅ | |
| shifts.manage | | ✅ | ✅ | |
| delivery.manage | | ✅ | ✅ | ✅ |
| **staff.manage** | | ❌ | ✅ | |
| **settings.manage** | | ❌ | ✅ | |

**Finding R1 (inconsistency):** the Staff page renders a permission-matrix panel that shows **Manager with `staff.manage`/`shifts.manage`**, but the real `rolePermissions` gives Manager **neither `staff.manage` nor `settings.manage`**. So a Manager cannot open the Staff or Settings screens, yet the in-app matrix implies they can manage staff. Decide the intended policy, then make code + display agree.
**Finding R2:** **Cashiers have only `sales.checkout`** → they cannot open/close their own shift (`shifts.manage` is Manager+). Confirm this is intended (manager opens the till) or a workflow gap.
**Finding R3:** **Suppliers** is gated by `accounting.manage`, not an inventory/purchasing permission — a manager doing purchasing sees it only via the accounting grant.

---

## 1. Current navigation map

**Single nav system** (`Sidebar.tsx`; `BottomNav` is the same list on mobile). Grouped, filtered by `userCan`:

```
REGISTER    POS            /            sales.checkout
            Sales          /sales       reports.view
            Customers      /customers   customers.manage
INVENTORY   Products       /products    inventory.manage
            Receiving      /products/new inventory.manage
            Suppliers      /suppliers   accounting.manage
FINANCE     Dashboard      /dashboard   reports.view
            Accounting     /accounting  accounting.manage
OPERATIONS  Delivery       /delivery    delivery.manage   (+ Drivers sub-tab / /delivery/drivers)
SYSTEM      Staff          /staff       staff.manage
            Settings       /settings    settings.manage
```

**Per-screen internal structure (condensed):**

- **Login / lock:** PIN unlock; "New device / add another store" (connection modes STORE_HUB / CONNECT_TO_HUB / DIRECT_RAILWAY + pairing code); quick store-switch; forced PIN change on first login.
- **POS (+ Quick POS):** category tabs (All Items / Favorites / categories); search+scan toolbar; **Quick POS** full-screen mode; cart drawer → tender panel (Cash/Card/Wallet/Debt), **Discount** (role-gated `sales.discount`), **Sale note**, **Sell at cost** toggle; **Hold**, **Clean** (=clear cart, confirmed), discard-held; **Confirm Sale** modal; variant picker; shortcuts modal.
- **Products:** 6 workspace views — **Catalog / Categories / Alerts / Stock control / Batches / Add product**; Tools menu (Generate Images, Bulk Edit), Export CSV; edit drawer; **delete product** (destructive).
- **Stock control** (a Products view): adjustment form ("**Post**"), physical **stock count** flow, **recent adjustments**, **client reconciliation scan**, **Ledger Reconciliation** panel (Initialize ledger [Admin], Refresh, **Repair** modal). *(This one view holds ~5 distinct tools.)*
- **Batches ("Lots"):** read-only table + filter tabs (all/open/consumed/expired). Terminology split "Batches" vs "Lots".
- **Receiving:** separate page (`/products/new`); supplier + payment method + invoice; batch rows (barcode lookup, generate barcode, duplicate/delete row); **Save & Receive**; print labels.
- **Customers:** tabs Ledger / Pay debt; Add, Export, Record Payment; per-customer WhatsApp/Call/Edit/Statement/Print/Archive/**Delete**; aging KPIs.
- **Suppliers:** tabs Accounts / Orders / Pay supplier / Activity; Add; Archive/**Delete**.
- **Sales:** tabs Receipts / Insights; filters (date/method/status/cashier); Print; **Refund** (`sales.refund`), **Void** (`sales.void`) — both confirmed.
- **Accounting:** tabs Close day / Expenses / Cash flow / History (+ register reconciliation); Close Today, Save Expense (`accounting.manage`); WhatsApp/Print.
- **Dashboard:** date range; KPI cards; charts; action queue (links to /products, /settings); recent sales.
- **Delivery:** tabs Orders / Drivers; Refresh; Mark-as-[status]; **Cancel order** (destructive, **no confirm**).
- **Drivers:** Add/Edit; **active/inactive toggle** (destructive-ish, **no confirm**).
- **Staff:** tabs Team / Shifts / Audit; Use (switch user), **Disable/Enable** (confirmed), Change PIN, Add user; **Open/Close shift** (confirmed); role-permission reference panel.
- **Settings (mega-page, 6 tabs):** Business / Delivery / Cloud sync (Connection, Hub status, pairing+devices, offline queue, cloud connection w/ super-admin unlock) / Security (read-only) / Backup / About. Destructive: **Disable LAN**, **Revoke device** (confirmed); **Export Full Data Backup** and **Restore from IndexedDB** (**no confirm, no gate** — see S1).
- **Web surfaces:** `apps/admin` (Dashboard/Delivery/Drivers/Customers/Products/Sales/Reports/Staff/Tenants[super-admin]); `apps/driver` (login/orders/detail); `apps/ordering` (find store/menu/orders/tracking). Out of scope for desktop IA except to note overlap (Drivers/Staff exist in both).

---

## 2. Recommended navigation map (IA only — no features removed)

Keep **cashier = POS only** (already the case). For Manager/Owner, regroup for memorability and reduce the overloaded Products/Settings pages. Proposed sidebar groups + labels:

```
SELL        POS
            Sales
INVENTORY   Products      (views: Catalog · Categories · Alerts · Add product)
            Receiving     (stays 1 click; label its route, not /products/new)
            Stock & Lots  (NEW grouping: Batches + Stock control + Reconciliation
                           split out of the overloaded Products→Control view)
            Suppliers
PEOPLE      Customers
            Staff         (Admin)
FINANCE     Dashboard
            Accounting
OPERATIONS  Delivery      (+ Drivers)
SYSTEM      Settings      (split into: Store · Devices & Sync · Backup/Danger · About)
```

Key moves vs current:
- **Split the Products→"Stock control" view** (adjustment + count + client-scan + ledger reconcile + repair) into two clearer destinations: **Adjust & Count** and **Reconciliation** (the 2C tools). Today all five tools live in one scrolling panel — hard to find and to teach.
- **Receiving** stays top-level (frequent manager task) but the label/route should read as "Receiving," not "new product."
- **Settings**: break the 1,880-line mega-page into named sub-pages so Devices/Sync/Backup are findable, and isolate a **Danger zone**.
- Unify **"Lots" → "Batches"** everywhere.

---

## 3. Role-based workflow maps

**Cashier** (sees only POS): scan/search → cart → tender → **Confirm Sale** → receipt. Held sales resume. *Cannot* discount/refund/void/open-shift (needs manager). — Fast and uncluttered ✅. Gap: can't self-open shift (R2).

**Manager** (POS + inventory + customers + reports + accounting + shifts + delivery; **no staff/settings**): open/close shift (Staff→Shifts — but Staff is `staff.manage`=Admin-only! so **Manager can't reach the Shifts tab** → R1/R2 blocker), receive stock, adjust/count/reconcile, refunds/voids, close day, manage customers/suppliers, delivery. **The shift controls being on the Admin-only Staff page contradicts Manager's `shifts.manage`.** → surface shift open/close where Managers can reach it.

**Owner/Admin** (everything): all of the above + Staff + Settings + device pairing + cloud + backup + ledger initialize. Main risk = clutter + dangerous actions too reachable (see §5, S1).

**Driver** (`delivery.manage`): login → assigned/broadcast orders → advance status → deliver. Desktop Delivery page + driver web app. No back-office.

---

## 4. Quick wins (IA-1A — low-risk: rename / group / confirm / role-hide)

1. **Rename "Clean" → "Clear sale"** (cart) — matches its own confirm text; memorable.
2. **Rename "Post" → "Apply adjustment"** (Stock control).
3. **Unify "Lots" → "Batches"** across tab label + code strings.
4. **Add a confirmation dialog to Delivery "Cancel order"** (currently 1-click, no confirm) — UI-only, no logic change.
5. **Add a confirmation to the Drivers active/inactive toggle.**
6. **Group Settings "Export Full Data Backup" + "Restore from IndexedDB" into a labeled "Danger zone"** with a confirm (see S1 for the deeper gate).
7. **Make shift Open/Close reachable by Managers** (move the Shifts tab out from under the Admin-only Staff route, or surface a shift control the Manager can see) — resolves R2.
8. **Fix the Staff permission-matrix display** to match real `rolePermissions` (or adopt the intended matrix) — resolves R1's display half.
9. **Clarify the Receiving nav** so it doesn't read as `/products/new`.
10. **Role-hide inside pages:** hide clearly-destructive/admin actions from roles that shouldn't see them (e.g., surface delete only where the role has authority) — where it's pure hide (no permission change).

## 5. Risky moves (need explicit approval — policy or structural)

- **S1 — Backup export/restore safety (highest):** "Export Full Data Backup (JSON)" dumps **plaintext PINs + auth tokens + audit logs** with no gate; "Restore from IndexedDB" overwrites local data in one click. Recommend admin-gate + confirm + (ideally) redact secrets. *Touches security, not money/stock — but needs your call.*
- **R1/R2/R3 — role→permission changes:** e.g. give **Manager `staff.manage`/`shifts.manage`**, gate **Suppliers** under a purchasing/inventory permission, or let **Cashiers self-open shifts**. These change who-can-do-what.
- **Structural page splits:** breaking the **Products→Stock control** view into Adjust/Count + Reconciliation, and splitting the **Settings** mega-page. Moving deep tools changes muscle memory.
- **Gating destructive deletes:** requiring Admin (not Manager) for delete-customer / delete-supplier / cancel-delivery. Policy change.
- **Moving Receiving** under Products (vs top-level) — affects manager speed; only if desired.

## 6. Implementation plan

**IA-1A — low-risk rename / group / confirm / role-hide** (no logic, no permission changes): quick wins #1–#6 and #9. Pure label/grouping + added confirm dialogs + non-privilege-changing hides. Ship first; each is independently revertible.

**IA-1B — structural moves** (needs approval): split Products→Stock control into **Adjust & Count** + **Reconciliation**; split **Settings** into sub-pages incl. a **Danger zone**; **resolve shift-access for Managers (R2 — decided, see below)**; decide Receiving placement. Coordinated but still no money/stock/sync logic change.

---

## Review decisions (2026-07-14)

- **IA-1A:** implemented (commit `c938806`) — label renames, batches terminology, confirms on Delivery-cancel + Driver-deactivate, Settings Danger zone with confirms.
- **R2 (shift access) — DONE (IA-1B):** shift Open/Close now lives on the **Accounting page** as a **"Shift" tab**, gated by `shifts.manage` (Managers + Admins reach it; cashiers can't reach Accounting at all). New `ShiftControlPanel` reuses the existing shift-service functions (single source of truth) — open with float, close with counted cash + expected-cash breakdown + confirm. The Staff page's shift tab is left untouched for Admins. No cashier-facing change.
- **R1 (staff matrix) — VERIFIED already correct (no change needed):** the Staff page's permission matrix (per-user chips *and* the reference panel) is **data-driven from `rolePermissions`**, so it already shows Manager with shifts/inventory/accounting/delivery and **without** `staff.manage`/`settings.manage`. The audit's "misleading matrix" note was an explorer misread. No second/hardcoded matrix exists (the only other role reference is a login badge colour). Staff management stays Admin-only, as decided.
- **S1 (backup admin-gate/secret-redaction):** still deferred (grouping+confirm shipped in IA-1A; the admin-gate/redaction is a separate approval).
- Remaining IA-1B items (Products/Settings splits, Receiving placement, delete-gating) still need explicit go before implementation.

**IA-1C — optional visual polish** (last, only if wanted): consistent iconography, group headers, empty states, spacing — explicitly out of scope for this sprint beyond noting it.

---

## Constraints honored in recommendations
No money/tender/tax/stock/sync **logic** changes proposed (only labels, grouping, confirmations, and role *visibility*). No features removed. Cashier flow stays minimal. Owner/manager tools stay complete but get de-cluttered. **Nothing implemented — awaiting review.**

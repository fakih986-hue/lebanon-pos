# Titan POS — Full Platform QA / Audit Report

**Requested report version: 1.0.10 — ACTUAL AUDITED BUILD: 1.0.15**

The filename/version requested for this report ("1.0.10") does not correspond to any artifact in this repository. `apps/electron/package.json` is at version **1.0.15**, and the installer artifacts actually present in `apps/electron/dist-v8/` are `Titan POS 1.0.15.exe` / `Titan POS Setup 1.0.15.exe` (plus stale leftover `Titan POS 1.0.8.*` files from an older build — there is no 1.0.10 anywhere on disk). Version history observed in git log (most recent first): `bbfab81` (1.0.15, LAN-toggle race fix) → `768f8bb` (chore: bump to 1.0.14) → `dd3abfb`/`c21ab66` (registerId/deviceId sync stripping) → `41bf311`/`d1e19c0` (rebrand + cloud discovery proxy) → `31f51c3` (cloud API key self-heal) → `5f3b3f8` (website mobile menu / hero / Three.js background). This report audits the **1.0.15** build (HEAD `bbfab81`) and all findings below should be read against that version, not 1.0.10.

---

## 1. Executive verdict: **PASS WITH LIMITATIONS**

The platform is functionally sound across its ten audited areas: core POS/cashier flows, tender math, refunds/voids, staff/permission gating, delivery/driver/ordering, settings/device pairing, Electron packaging, and the marketing website all trace cleanly to real, working code — confirmed by reading actual handlers/components, not just checking that UI renders. All automated gates are green (100% pass on typecheck/test/build across desktop, API, electron, website, admin). However, the sync-architecture auditor found **three separate, previously-unknown Prisma "Unknown argument" bugs** (settings sync, daily-close sync, customer/supplier archive sync) that are structurally identical to the registerId/deviceId bug already fixed earlier this session — meaning that class of defect was not fully eradicated, only partially patched. These bugs do not corrupt data or crash the app (failed sync operations retry-then-give-up silently), but they mean several categories of data (business settings, daily P&L snapshots, customer/supplier archive state) never actually propagate from a local device to the hub database or Railway cloud, which undermines the core multi-device/cloud-sync value proposition for any store that isn't single-device. Two other real bugs were found and fixed during this pass (a website text-mojibake defect and a driver-edit UI bug that silently blanked login codes); one LAN-toggle race condition was previously fixed but the auditor found the underlying crash-handler can still race in rare cases. None of these issues touch money/tax/rounding/tender math — that logic was traced end-to-end and found consistent everywhere it was checked.

---

## 2. Build / test evidence table

| Check | Result | Detail |
|---|---|---|
| `pnpm typecheck:desktop` | PASS | `tsc -p tsconfig.app.json --noEmit`, zero errors |
| `pnpm typecheck:api` | PASS | `tsc --noEmit`, zero errors |
| `pnpm typecheck:electron` (`tsc -p apps/electron/tsconfig.json --noEmit`) | PASS | zero errors |
| `testDesktop` (vitest) | PASS | 3 test files, 101/101 tests |
| `testApi` (vitest) | PASS | 9 test files, 121/121 tests |
| `buildDesktop` (`npx vite build`) | PASS | 1 pre-existing non-blocking chunk-size warning (index.js 1.2MB min / 331KB gzip) |
| `buildWebsite` (`npx vite build`) | PASS | 1 pre-existing non-blocking chunk-size warning (three.js chunk 503KB min / 128KB gzip) |
| `buildAdmin` (`npx vite build`) | PASS | no warnings |

No build/test gate failed. These were run by the orchestrating session, not re-run here, per instructions.

---

## 3. Manual route / flow smoke table (derived from area-auditor checklists)

| Area | Flow | Status | Key evidence (file:line) |
|---|---|---|---|
| POS core | Login / PIN unlock | pass | `security.service.ts` `unlockWithPin()` L352-541; server verify `POST /api/auth/login`; offline fallback + pinVersion staleness check L497-531; brute-force lockout L357-386 |
| POS core | New device / connect modes (STORE_HUB/CONNECT_TO_HUB/DIRECT_RAILWAY) | pass | `LoginScreen.tsx` `handleConnect()` L183-293; `SettingsPage.tsx` ~L1115-1350 |
| POS core | Pairing code flow | pass | `deviceRegistry.service.ts`; `apps/api/src/routes/device.ts` (generate-code/pair/list/rename/revoke); `PairingCode`/`Device` models schema.prisma:713-742 |
| POS core | Offline/online sync banners | pass | `sync.service.ts` `getSyncStatus()`/`subscribeSync()`; `SyncBanner.tsx` |
| POS core | Quick/Standard POS, scan, search, cart, held sales | pass | `QuickPOSMode.tsx`; `POSPage.tsx` L212-298; `heldSale.service.ts` |
| POS core | Tender math (cash/card/wallet/debt, exact tender, LBP rounding, change) | pass | `POSPage.tsx` L242-267 (`ceilLbp` to nearest 5,000 LBP); `currency.ts` L77-92 `computeCashChange`; cross-checked against `__tests__/cashChange.test.ts` |
| POS core | Receipt print preview | pass | `printReceipt.ts` `printLastSaleReceipt()`/`printSaleReceipt()` |
| POS core | Refund flow | pass | `sales.service.ts` `recordRefund()` L302 — requires open shift, stamps shift/register/device, audit + sync |
| POS core | Void flow | pass | `sales.service.ts` `voidSale()` L359 — double-void guard, stock/batch restore, debt reversal; server mirror `sync.ts` ~L608-628 |
| POS core | Debt / credit-limit warnings | pass | `POSPage.tsx` L268-273 `creditLimitExceeded`; `TenderPanel.tsx` L297-318 |
| POS core | Daily close / shift open-close / cash drawer / owner draw / unsynced warning | pass | `security.service.ts` `openShift()`/`closeShift()`; `dailyClose.service.ts` `closeBusinessDay()`; `CloseDayPanel.tsx` L192-198 |
| POS core | registerId/deviceId server-side stripping | partial | Stripped correctly server-side (`sync.ts` L537-551) but not restorable on re-pull; client falls back to `'REG-001'`/`'unknown'` placeholders (`shift.service.ts` L118-119) — degrades multi-register attribution silently |
| Products/Inventory | Catalog list/filter/quick-views | pass | `ProductsPage.tsx` L229-260; `ProductTable.tsx` |
| Products/Inventory | Add/edit product drawer | pass | `product.service.ts` `createProduct()` L400-465, `updateProduct()` L333-398 |
| Products/Inventory | Product image + AI generation | pass | `ProductTable.tsx` L96-110; `image.ts` L256-305 `/api/images/generate-all` |
| Products/Inventory | Barcode/no-barcode chips | pass | `ProductTable.tsx` L148-153; `product.service.ts` L762-765 |
| Products/Inventory | Lots/batches FEFO + expiry chips | pass | `ProductsPage.tsx` L335-354; `inventoryBatch.service.ts` L175-185 |
| Products/Inventory | Receiving flow (scan/manual/label print) | pass | `ProductReceivePage.tsx` L155-206; `supplier.service.ts` `receiveAndRecord()` L600-665 |
| Products/Inventory | Supplier selection at receiving | pass | `ProductReceivePage.tsx` L695-703 |
| Products/Inventory | Supplier payment recording | pass | `supplier.service.ts` `recordSupplierPayment()` L337-412 |
| Products/Inventory | Stock movements ledger | **fail** | `getMovements()` never exported/consumed anywhere in UI (`inventoryBatch.service.ts` L27-65) — data collected, never displayed |
| Products/Inventory | Alerts (low-stock/dead-stock/reorder/expiry/promo) | pass | `stock.service.ts`; `AlertsPanel.tsx` |
| Products/Inventory | Import/export CSV | pass | `ProductsPage.tsx` L790-799; `parseSpreadsheetPaste()` product.service.ts L838-861 |
| Products/Inventory | Reconciliation tool | pass | `getReconciliationIssues()` product.service.ts L899-998 |
| Products/Inventory | Backend sync coverage (product/inventory/supplier) | partial | PO Draft→Received transition never synced (`supplier.service.ts` L610-641) — server PO status permanently disagrees with local |
| Customers/Suppliers | Sorting, aging buckets | pass | `CustomersPage.tsx` L212-218; `computeAging()` customer.service.ts L72-99 |
| Customers/Suppliers | Archive/restore | **fail (sync)** | Client wiring correct, but see Section 6/7 — Prisma schema missing `archived` column |
| Customers/Suppliers | Debt payment + overpayment cap | pass | `CustomersPage.tsx` `handleRecordPayment()` L283-328 |
| Customers/Suppliers | POS customer picker + credit block | pass | `TenderPanel.tsx` L248-328; `POSPage.tsx` L268,277 |
| Customers/Suppliers | Supplier list/archive/activity/payments | pass | `SuppliersPage.tsx` L22-30,161,179,238 |
| Dashboard/Accounting/Sales | KPI cards, payment mix, action queue | pass | `DashboardPage.tsx` L150-190,164-169,182-190 |
| Dashboard/Accounting/Sales | Daily close card, sales list/filter/CSV | pass | `AccountingPage.tsx`; `SalesPage.tsx` L175-204, `exportSalesCsv()` L73-107 |
| Dashboard/Accounting/Sales | Refund/void buttons wired | pass | `ReceiptPreview.tsx` L253-275; `SalesPage.tsx` L243-284,641-653 |
| Dashboard/Accounting/Sales | Accounting summary math | pass | `accounting.helpers.ts` `getAccountingSummary()` L94-159 |
| Dashboard/Accounting/Sales | Expenses, cash reconciliation, close history | pass | `ExpenseForm.tsx`; `shift.service.ts` L105-154; `HistoryPanel.tsx` |
| Staff/Permissions/Shifts | Staff list, roles/permission chips | pass | `StaffPage.tsx` L318-327,612-621,949-970; `security.service.ts` L91-120 |
| Staff/Permissions/Shifts | PIN login, permission-denied gate, sidebar filtering | pass | `security.service.ts` L352-541,718-721; `routes/index.tsx` L154-166,180-199; `Sidebar.tsx` L68,328 |
| Staff/Permissions/Shifts | Shift history register/device labels | pass | `StaffPage.tsx` L1026-1030; `security.service.ts` `openShift()` L810-851 |
| Staff/Permissions/Shifts | Server-side role checks (comprehensive?) | partial | Only 2 routes have server role checks (`delivery.ts:562`, `sync.ts:158`) — most permission enforcement is client-only (documented architectural limitation, not a fix-required bug) |
| Delivery/Drivers/Ordering | Admin dashboard, driver CRUD, assign/unassign | partial→fixed | Driver edit-code bug found and fixed (see Section 11) |
| Delivery/Drivers/Ordering | Driver login, order accept (atomic claim), status transitions | pass | `delivery.ts` L757-831 atomic `updateMany` claim; L632-695 status PATCH with ownership check |
| Delivery/Drivers/Ordering | Ordering site: menu, cart, checkout, tracking, customer accounts | pass | `MenuPage.tsx`; `TrackingPage.tsx`; `LoginPage.tsx`/`OrdersPage.tsx` (customer) |
| Settings/System | Business settings persistence | pass | `SettingsPage.tsx` `handleSave()`; `settings.service.ts` `saveSettings()` L77 |
| Settings/System | Connection mode card, device pairing UI | pass | `SettingsPage.tsx` L1115-1240,415-444 |
| Settings/System | LAN toggle | partial | bbfab81 fixed the original 2s-sleep EADDRINUSE crash, but auditor found a residual crash-handler race (Section 7) |
| Settings/System | Cloud sync save/self-heal, license status | pass | `setup.ts` L225-407; `sync.service.ts` `isLicenseBlocked()`/`isLicenseGrace()` L434-473 |
| Electron/Installer | Startup sequence, bundled Postgres startup | pass | `main.ts` L92-144 (whenReady chain); L187-245 (startPostgres) |
| Electron/Installer | Postgres graceful shutdown | **fail** | `stopPostgres()` L293-326 references wrong path for `pg_ctl.exe` (`USER_DATA` instead of `PG_BIN_DIR`) — falls through to SIGTERM/taskkill fallback, functional but not the intended path |
| Electron/Installer | JWT_SECRET/ADMIN_PASSWORD persistence, uninstall config, auto-updater | pass | `writeApiEnv()` L330-373; nsis config; `setupAutoUpdater()` L765-776 |
| Website | Navbar mobile menu, Three.js background, no overflow, all 6 pages, prod health | pass | Live Playwright-verified; `Navbar.tsx` L12-98; `ThreeBackground.tsx`; prod curl 200s on both domains |
| Sync architecture | Local write→queue, device approval, hub↔Railway push/pull loops | pass | `sync.ts` L164-190,108-138; `cloudSync.ts` L207-301,184-366 |
| Sync architecture | Settings / daily-close / customer-supplier-archive sync | **fail** | Three confirmed Prisma "Unknown argument" bugs — see Section 6 |
| Sync architecture | Conflict/reconciliation logic | not-applicable | Confirmed absent by design (last-write-wins); documented as known architectural limitation, not a defect |

---

## 4. Installer / setup evidence table

| Check | Result | Evidence |
|---|---|---|
| Installer artifacts present, version-matched to package.json | partial | `apps/electron/dist-v8/` has `Titan POS 1.0.15.exe`, `Titan POS Setup 1.0.15.exe`, `.blockmap`, `latest.yml` — matches `package.json` version 1.0.15. Stale `1.0.8.sha256`/`.blockmap` leftovers also present (harmless clutter, not shipped since `latest.yml` points at 1.0.15) |
| Build config wiring (appId, icons, extraResources, nsis) | pass | `package.json`: appId `com.titan.pos`, icons at `assets/icon.ico`, `extraResources` bundles `apps/api/bundle`, `@prisma/client`, `assets/pg` |
| Brand assets exist on disk | pass | `apps/electron/assets/icon.png` (1,716,999 B), `icon.ico` (372,526 B), `apps/desktop/public/titan-logo.png` (320,321 B) — all modified 2026-07-11, consistent with rebrand commit 41bf311 |
| App title/version wiring | pass | `main.ts:700` title `'Titan POS'`; `get-app-version` handler L830 exposes package.json version |
| Taskbar/window icon | pass | `main.ts:49-50` ICON_PNG/ICON_ICO; `createTray()` L718-721 |
| Loading/activation window branding | pass | `TITAN_MARK_DATA_URI` base64-inlined shield mark, no leftover helmet/emoji brand marks (two unrelated decorative unicode glyphs found, cosmetic only) |
| Startup sequence (Postgres → migrations → API → activation/main window) | pass | `app.whenReady()` L92-144 |
| Postgres graceful shutdown | **fail** | `stopPostgres()` L298 wrong path — dead-code primary path, functional fallback works |
| JWT_SECRET/ADMIN_PASSWORD persistence across reinstall/upgrade | pass | `writeApiEnv()` L330-373 reuses existing `.env` values; no NSIS data-wipe flag |
| Auto-updater wiring | pass | `setupAutoUpdater()` L765-776, GitHub provider, 10s delayed check, manual tray "Check for Updates" |
| Unsigned installer | pass (expected) | No code-signing config anywhere in build block — expected for a project without a purchased cert, not a defect |

---

## 5. Sync topology evidence table

| Component | Result | Evidence |
|---|---|---|
| Local write → SyncOperation queue (transactional) | pass | `sync.ts` L164-190, `prisma.$transaction` |
| Device approval / `DEVICE_NOT_APPROVED` | pass | `sync.ts` L108-138; covered by `apps/api/__tests__/device.test.ts` L129-189 |
| Hub → Railway push loop | pass | `cloudSync.ts` L207-301, batches of 100, 5s interval |
| Hub → Railway pull loop | pass (doc stale) | `cloudSync.ts` L184-203,324-366 — runs every 5s, not the 30s the file's header comment claims (comment is stale, not a functional bug) |
| Retry-failed-item UI wiring | pass | `retryFailedSync()` called from `SyncStatus.tsx:64`, `SyncBanner.tsx:119`, `SettingsPage.tsx:375` |
| `IS_LOCAL_SERVER` string-check consistency | pass | Identical `["true","1"].includes(...)` pattern in `index.ts:53`, `setup.ts:225`, `sync.ts:109` — no stale strict-equality checks remain in source |
| Pairing/registerHub/revoke flow | pass | `device.ts` full lifecycle, audit-logged |
| Conflict/reconciliation (CRDT/version-vector) | not-applicable | Confirmed absent by design — last-write-wins; only idempotency guards exist for sale-create/refund-create (`sync.ts` L668-682,733-737) |
| **Settings sync payload vs Prisma schema** | **fail** | `settings.service.ts` sends `profitPercent1`, `profitPercent2`, `registerName` — none exist on `AppSettings` Prisma model (schema.prisma:147-165); not stripped by `stripClientMeta` (only strips registerId/deviceId); every settings sync throws and fails permanently |
| **Daily-close sync payload vs Prisma schema** | **fail** | `unsyncedCountAtClose` field (populated by `AccountingPage.tsx:181`) does not exist on `DailyClose` Prisma model (schema.prisma:648-669); every daily-close sync throws and fails permanently |
| **Customer/Supplier archive sync payload vs Prisma schema** | **fail** | `{ id, archived }` payload sent on archive/restore; neither `Customer` (schema.prisma:307-327) nor `Supplier` (schema.prisma:361-378) model has an `archived` column; every archive/restore sync throws and fails permanently |

---

## 6. Critical issues found (severity: critical)

**None.** No issue rose to "critical" (defined here as: crashes the app, corrupts financial data, or causes irrecoverable data loss). All failures found are silent-retry-then-give-up sync failures that degrade cross-device consistency without crashing or corrupting anything locally.

---

## 7. High issues found (severity: high)

1. **Settings sync always fails with Prisma "Unknown argument"** — `apps/api/src/routes/sync.ts` case `"settings"` (~L1015-1025) spreads the full client `AppSettings` payload (including `profitPercent1`, `profitPercent2`, `registerName` — see `apps/desktop/src/features/pos/services/settings.service.ts:11-30,77-91`) directly into `prisma.appSettings.create/update`. These three fields do not exist on the Prisma `AppSettings` model (schema.prisma:147-165) and are not covered by `stripClientMeta` (which only strips `registerId`/`deviceId`). Every settings save (VAT rate, exchange rate, receipt footer, store name, etc.) fails to sync to the hub DB / Railway and retries to exhaustion. **Not fixed** — same bug class as the already-patched registerId/deviceId issue, but on different fields; requires either a schema migration or extending `stripClientMeta`, judged out of scope for a "surgical, fully-confident" fix in this pass.

2. **Daily-close sync always fails with Prisma "Unknown argument: unsyncedCountAtClose"** — `sync.ts` case `"daily-close"` (~L1026-1035) spreads the client `DailyClose` payload, which includes `unsyncedCountAtClose` (populated at `apps/desktop/src/pages/accounting/AccountingPage.tsx:181`), a field absent from the Prisma `DailyClose` model (schema.prisma:648-669). Every end-of-day close snapshot fails to sync; daily close records exist only on the originating device's local storage. **Not fixed**, same reasoning as above.

3. **Customer/Supplier archive & restore sync always fails with Prisma "Unknown argument: archived"** — `sync.ts` cases `"customer"` (~L801-812) and `"supplier"` (~L813-824) spread `{ id, archived }` from `apps/desktop/src/features/pos/services/customer.service.ts:178-210` / `supplier.service.ts:169-192` directly into `prisma.customer.upsert`/`prisma.supplier.upsert`. Neither Prisma model has an `archived` column (only `Product` does, schema.prisma:192). Archive/restore state never propagates past the local device. **Not fixed** — requires a schema migration (add `archived Boolean @default(false)`) which is out of scope for this pass; flagged in two independent area audits (Customers/Suppliers and Sync architecture), corroborating the finding.

4. **Editing a driver silently blanked their login code** (`apps/admin/src/pages/DriversPage.tsx`) — **FIXED THIS SESSION**. The `Driver` type omitted the `code` field even though the API returns it (`apps/api/src/routes/delivery.ts:101-113`), and `startEdit()` never populated `code` from the existing driver. The (required) Code input would render empty on Edit, risking an unintentional login-code overwrite on save. Fixed by adding `code: string` to the `Driver` type and calling `setCode(d.code)` in `startEdit()`. Confirmed via `git diff --stat`: `apps/admin/src/pages/DriversPage.tsx` shows 4 changed lines (2 insertions/2 deletions).

5. **Homepage hero headline rendered as garbled mojibake text** (`apps/website/src/pages/HomePage.tsx:40`) — **FIXED THIS SESSION**. `KineticLine` inserted `"Â "` (stray U+00C2 + NBSP double-encoding artifact) after each word, rendering literally as "RunÂ theÂ business.Â" live (confirmed via Playwright screenshot). Fixed by stripping the stray `Â` while retaining the NBSP (a plain space would have collapsed words together because `.word-rise` is `display: inline-block`, which trims trailing whitespace at the inline-block edge). Verified visually post-fix at both 1440x900 and 390x844.

6. **Widespread em-dash mojibake across homepage copy** (`apps/website/src/pages/HomePage.tsx`, 10 occurrences) — **FIXED THIS SESSION**. Every em-dash had been corrupted to `â€”` via the same Latin-1/UTF-8 round-trip defect. All 10 occurrences replaced with a proper U+2014 em-dash. Confirmed isolated to this one file (other pages — About/Company/POS/Payroll/Contact — already used correct characters). Verified via `git diff --stat`: `apps/website/src/pages/HomePage.tsx` shows 22 changed lines (11 insertions/11 deletions), consistent with the headline + 10 em-dash fixes combined.

---

## 8. Medium / low polish issues

**Medium:**
- registerId/deviceId stripped server-side but not restorable on re-pull — silently collapses per-register/per-device attribution to `'REG-001'`/`'unknown'` placeholders after a full re-pull (`shift.service.ts` L118-119), degrading `RegisterReconciliationPanel.tsx` for multi-device stores. Non-crashing.
- Purchase order Draft→Received status transition never synced to server (`supplier.service.ts` L610-641) — server-side PO status permanently disagrees with local state after receiving.
- LAN-toggle race: bbfab81 fixed the original 2s-sleep EADDRINUSE crash, but the module-level crash-restart handler in `main.ts` (registered at spawnApi L487) can still treat a deliberate SIGTERM-triggered restart (exit code `null`, not `0`) as a crash, scheduling a redundant delayed `spawnApi()` that can orphan the correctly-running process and push `apiRestartCount` toward the fatal-dialog threshold. Not fixed — subtle, hard to exercise in this environment, judged beyond "small/obviously safe."

**Low:**
- Cash-rounding disclosure (`payableLbp`) never persisted on `Sale` records — reprint/CSV export show it blank (dead-code condition in `printReceipt.ts:156`; blank CSV column in `SalesPage.tsx:78,91`). Live checkout math/disclosure is correct; only the audit trail is lost after save.
- Stock Movements ledger recorded (`inventoryBatch.service.ts` `recordStockMovement`) but `getMovements()` never exported/consumed anywhere — feature is inert.
- "Active Products" / stock-value KPIs include archived products (`ProductsPage.tsx` L366-371,803-808) — archived items aren't excluded like they are in low-stock/no-barcode filters.
- `detectDuplicateBarcodes()` double-counts the first product when 3+ share a barcode, inflating the "Dupes (N)" counter (display-only; the actual filter is unaffected).
- `addCustomer()` skips the `assertCanWrite()` license-suspension guard that every other customer/debt mutation calls — inconsistency, not a security bypass.
- Manual "Counted cash" entry in `CloseDayPanel.tsx` is local-only state, never persisted to `DailyClose` — gives a false sense that it was recorded.
- Owner draws shown as a separate line in `RegisterReconciliationPanel.tsx` even though already netted into "Cash in/out" — copy/label clarity issue only, no double-counting in the math.
- Most permission gates beyond void/driver are enforced client-side only (architectural note, not a bug per se).
- StaffPage duplicates shift cash-breakdown calculation logic instead of reusing `shift.service.ts` (duplication risk, no divergence found).
- No aggregate "unassigned orders" warning banner on delivery dashboard (only per-order label) — UX gap, not a wiring bug.
- Stale 1.0.8 build artifacts left alongside 1.0.15 in `dist-v8/` — harmless clutter.
- `stopPostgres()` references the wrong path for `pg_ctl.exe` (uses `USER_DATA` instead of `PG_BIN_DIR`), so the intended graceful `pg_ctl -m fast` shutdown path is dead code; functional fallbacks (SIGTERM, then netstat/taskkill) still work.
- Mojibake (`â€”`) also present in non-user-facing JS/CSS comments in `ThreeBackground.tsx` and `index.css` — left untouched intentionally (not user-visible).

---

## 9. Confirmed safe areas

- PIN unlock (online-first verification, offline SHA-256 fallback, pinVersion staleness check, brute-force lockout).
- Tender math: `currency.ts` `roundMoney`/`roundLbp`/`ceilLbp`/`computeCashChange` — internally consistent, matches checkout UI and `cashChange.test.ts`.
- Refund/void flows client- and server-side (idempotent guards, stock/batch/debt restoration).
- Pairing code / device registry lifecycle, end-to-end.
- Credit-limit enforcement (checkout blocking) consistent between `POSPage.tsx` and `TenderPanel.tsx`.
- Daily-close unsynced-count warning wiring.
- FEFO batch consumption/allocation logic.
- Stock adjustment and physical stock count flows, correctly synced to matching server models.
- Product image generation endpoint, receiving flow (scanner/camera/external barcode lookup/label printing).
- Debt aging bucket computation (FIFO settlement), overpayment capping, POS customer picker.
- Dashboard KPIs, payment mix, accounting summary math, register cash reconciliation math — all derived from live data, no mocked values.
- Role/permission chip rendering genuinely sourced from `rolePermissions` (not hardcoded copy); route-level and sidebar-level gates genuinely swap/hide content.
- Server-side JWT `tokenVersion` revocation on PIN reset/logout.
- Admin-portal super-admin gate (`__admin__` synthetic identity) separate from tenant roles.
- Delivery money math (`Prisma.Decimal`, no float drift), atomic stock-decrement guards, atomic driver-order-claim guard, tenant-scoped customer/driver JWT auth.
- Electron rebrand assets (icon/logo) present on disk and consistently wired; JWT_SECRET/ADMIN_PASSWORD persistence across reinstall/upgrade; unsigned-installer state confirmed intentional (no cert configured).
- Website: routing, Navbar (desktop+mobile, live-tested), Three.js background (no console/page errors, proper cleanup), no real horizontal-overflow bug, both production endpoints return HTTP 200.
- Sync: device approval/rejection flow, pairing lifecycle, retry-failed-item UI wiring, `IS_LOCAL_SERVER` string-check consistency, sale/refund idempotency guards, and — per the sync auditor's explicit field-by-field cross-check — product/staff/expense/debt/debtPayment/inventory/purchase-order/supplier-payment/shift/cash-movement/delivery-order payloads do NOT have further unstripped extraneous fields beyond the three newly-found bugs above.

---

## 10. Release recommendation

**Safe for pilot (single-device / STORE_HUB-only stores):** Yes. Every core cashier flow — login, cart, tender math, refund, void, debt, shift/daily-close — is correctly wired and passes all automated tests. A single-device deployment never exercises the cross-device sync paths where the newly-found bugs live, so a pilot store running one terminal will not encounter them.

**Safe for production at multi-device/cloud scale:** **Not yet, with caveats.** The three newly-found sync bugs (settings, daily-close, customer/supplier archive) mean that any store using CONNECT_TO_HUB/DIRECT_RAILWAY with more than one device, or relying on the cloud dashboard, will silently lose settings/daily-close/archive-state synchronization — the local UI shows success while the sync operation fails and retries forever in the background. This is a serious but non-crashing defect class that should be fixed (schema migration + either stripping unsupported fields or adding the missing columns) before broad multi-device/cloud rollout. Similarly, `RegisterReconciliationPanel`'s per-register attribution silently degrades after any full re-pull for multi-device stores, and purchase-order status will diverge between devices for any store using the Receive Inventory flow.

**Blockers before publishing the update manifest for 1.0.15:**
1. None of the found issues are release-blocking crashes or money-math bugs, so publishing 1.0.15 as an update is reasonable **if** the target audience is understood to be primarily single-device or STORE_HUB-only deployments (which is likely the actual current install base).
2. Before actively marketing/enabling multi-device or cloud-sync features more broadly, the three sync "Unknown argument" bugs (Section 7, items 1-3) should be fixed and a follow-up patch released — these will otherwise cause quiet, hard-to-diagnose support tickets ("my settings didn't sync to my other register").
2b. The stale 1.0.8 artifacts in `dist-v8/` should be cleaned up before distributing from that folder directly (use `latest.yml`, which correctly points at 1.0.15).
3. No further action needed on: money/tax/tender math (verified correct), founder.jpg (untouched, confirmed via git status), or any design/branding work (not reverted).

---

## 11. Exact files changed (verified via `git status --short` and `git diff --stat`)

```
 M apps/admin/src/pages/DriversPage.tsx     |  4 ++--   (2 insertions, 2 deletions)
 M apps/website/src/pages/HomePage.tsx      | 22 +++++++++++-----------   (11 insertions, 11 deletions)
?? apps/api/public/founder.jpg              (untracked, pre-existing, untouched per instructions)
```

Both modifications match exactly what the area auditors self-reported:
- `apps/admin/src/pages/DriversPage.tsx` — added `code: string` to the `Driver` type and populated it in `startEdit()` (fixes silent login-code blanking on driver edit).
- `apps/website/src/pages/HomePage.tsx` — fixed the mojibake hero headline (`"Â "` → NBSP-only) and 10 corrupted em-dashes (`"â€”"` → proper `—`).

No other files in the working tree were modified by any area auditor. `apps/api/public/founder.jpg` remains untouched and untracked, as required. No money/tax/rounding/tender math file was modified anywhere in this pass.

---

## 12. Exact commits, push/deploy status

Commits created this session (from `recentCommitsThisSession`, newest first):

| Commit | Message | Pushed? | Deployed? |
|---|---|---|---|
| `bbfab81` | fix: race condition crashing the API server when toggling LAN access | **No** — 1 commit ahead of `origin/master`, not yet pushed | Not applicable to Railway (Electron-only fix, ships via installer, not the server) |
| `768f8bb` | chore: bump electron version to 1.0.14 | Yes (ancestor of Railway's deployed commit) | Deployed (Railway runs `768f8bb`, per `railwayDeployed` evidence) |
| `dd3abfb` | fix: strip registerId/deviceId from all synced payloads, not just sale | Yes | Deployed — confirmed live in production per `railwayDeployed` evidence (`dd3abfb` is an ancestor of Railway's running commit) |
| `c21ab66` | fix: strip registerId/deviceId from synced sale payload before prisma.sale.create | Yes | Deployed (ancestor of `dd3abfb`) |
| `41bf311` / `d1e19c0` | fix: proxy hub cloud-link discovery to Railway; rebrand identity across POS and setup | Yes | Deployed |
| `31f51c3` | fix: self-heal missing tenant cloud API key during setup | Yes | Deployed |

Working tree at time of this audit: **clean except** the two files fixed during this pass (Section 11) and the pre-existing untracked `founder.jpg`. The two fixes made during this QA pass (DriversPage.tsx, HomePage.tsx) are **uncommitted** — they exist only in the working tree and were not part of the `bbfab81`-and-earlier commit history reported by the orchestrating session. They should be committed and pushed as a follow-up if the fixes are approved.

**Verification performed:** `git status --short` and `git diff --stat` were run directly against the repository (not merely trusted from auditor self-reports) and match auditor claims exactly — see Section 11 output above.

---

## 13. Post-audit fix — sync payload / schema alignment (2026-07-11, follow-up pass)

Following this audit, commit `080f844` ("fix: driver code edit and website mojibake cleanup") was made first, containing exactly `apps/admin/src/pages/DriversPage.tsx` and `apps/website/src/pages/HomePage.tsx` (Section 11 items). Then the three High-severity sync bugs from Section 7 (items 1–3) were fixed as follows.

### Exact root cause

Same defect class as the earlier `registerId`/`deviceId` fix (Section 7 intro): the desktop client's sync payload for three entities included fields that had no corresponding Prisma column, so `prisma.<model>.upsert()` threw `Unknown argument` and the sync operation failed-and-retried forever without ever succeeding or surfacing a clear error to the user.

For each field, the actual purpose was checked before choosing a fix (per the requested approach — add a real column if the field is meaningful and tenant-wide, or strip it if it's local/device-only):

| Field | Entity | Real purpose | Fix chosen |
|---|---|---|---|
| `profitPercent1` / `profitPercent2` | settings | Tenant-wide quick-profit-margin percentages used by the Receive Inventory "+25%/+35%" quick-price buttons (`ProductReceivePage.tsx`, `SettingsPage.tsx`) — same category as `vatRate`/`deliveryFee`, which already have columns | **Added as real columns** (additive migration) |
| `registerName` | settings | Per-device register label (`getRegisterName()`), analogous to `registerId` — syncing it would let one device's register name overwrite the shared tenant settings row | **Stripped** before upsert (device-local, not tenant data) |
| `unsyncedCountAtClose` | daily-close | A real audit-trail number computed at close time (`AccountingPage.tsx:181`, via `getUnsyncedCount()`) — meaningful business/audit data that should persist and sync | **Added as a real column** (additive migration) |
| `archived` | customer, supplier | Real business state (archive/restore), same category as the `Product.archived` column that already exists from an earlier migration (`20260708000003_add_product_archived`) | **Added as a real column** (additive migration, mirrors the existing Product precedent) |

No error was swallowed or silently ignored anywhere — the three "add column" fixes make the previously-failing upserts succeed for real; the one "strip" fix (`registerName`) removes a field that was never meant to be tenant data in the first place, exactly like the already-shipped `registerId`/`deviceId` strip.

### Exact files changed

- `apps/api/prisma/schema.prisma` — added `profitPercent1 Decimal @default(25) @db.Decimal(6,2)` and `profitPercent2 Decimal @default(35) @db.Decimal(6,2)` to `AppSettings`; added `unsyncedCountAtClose Int?` to `DailyClose`; added `archived Boolean @default(false)` to both `Customer` and `Supplier`.
- `apps/api/prisma/migrations/20260711120000_align_sync_payload_schema/migration.sql` — new additive migration (4 `ALTER TABLE ... ADD COLUMN` statements, all nullable-or-defaulted — safe against existing rows, no data loss, no destructive change).
- `apps/api/src/generated/prisma/*` — regenerated Prisma client (tracked in this repo) to reflect the new columns.
- `apps/api/src/routes/sync.ts` — `case "settings"` now destructures `registerName` out of the payload before the upsert (with an explanatory comment); `case "daily-close"`, `case "customer"`, `case "supplier"` needed no code change — the schema now simply supports what they were already sending.
- `apps/api/__tests__/sync.test.ts` — three new targeted tests: settings strips `registerName` but keeps `profitPercent1`/`profitPercent2`; daily-close accepts `unsyncedCountAtClose`; customer/supplier (parameterized) accept `archived`.

### Tests run

| Check | Result |
|---|---|
| `pnpm typecheck:api` | PASS — zero errors |
| `pnpm typecheck:desktop` | PASS — zero errors |
| `pnpm test:api` (vitest run, full suite) | PASS — 125/125 (9 test files; was 121 before this pass, +3 new tests here and +1 from the earlier session that had already landed) |
| `pnpm test:desktop` (vitest run, full suite) | PASS — 101/101 (3 test files, unchanged — this fix is entirely server-side) |
| Targeted sync tests | PASS — all 3 new tests in `sync.test.ts` (settings/daily-close/customer+supplier archive) |

No money/tender/tax/rounding/refund/void/inventory/debt logic was touched. No CASHOPS/HUB topology was touched. The update manifest was not modified. Nothing was pushed or deployed as part of this fix.

### Remaining limitations (unchanged from Section 8, not addressed by this pass)

- registerId/deviceId still degrade to `'REG-001'`/`'unknown'` placeholders after a full re-pull for multi-register attribution (`shift.service.ts` L118-119) — a display-only limitation, not a sync failure.
- Purchase order Draft→Received transition is still never synced (`supplier.service.ts` L610-641).
- The residual LAN-toggle crash-handler race noted in Section 8 (Medium) is unrelated to this fix and was not addressed here.
- This migration has **not been applied to any running database** (local dev, hub installs, or Railway) — it exists only as a migration file and regenerated client in the working tree. It needs `prisma migrate deploy` (or equivalent) run against each target database before the fix takes effect anywhere, and a new installer build for hub installs. Per instructions, no deploy was performed as part of this task.

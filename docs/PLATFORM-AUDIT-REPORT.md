# Lebanon POS — Full Platform Audit Report

**Date:** 2026-07-08
**Scope:** Complete A-to-Z audit of v4 platform
**Method:** Static analysis of all source code, schemas, migrations, configuration, and build pipelines

---

## 1. Executive Summary

### What Is Strong
- **Monorepo structure** is clean: 7 apps, 2 packages, well-organized
- **Decimal money everywhere**: All monetary fields use `Decimal(18,4)` — no Float for money, no rounding errors
- **Multi-tenant isolation**: Every model except `RateLimitEntry` has `tenantId` — cross-tenant data leak is architecturally impossible
- **Sync system** is well-designed with idempotency, atomic operations, and error recovery
- **Electron boot** is robust: bundled PostgreSQL, migration runner, health polling, auto-restart on crash
- **Rate limiting** covers all major endpoints with persisting state
- **Offline-first** POS works without internet — IndexedDB + localStorage dual-write
- **i18n is complete**: All 6 apps translated (EN + AR), 1100+ keys
- **TypeScript strict mode** across all apps with clean typecheck

### What Is Risky
- **pinVersion does not invalidate existing JWTs after PIN reset** (auth middleware checks wrong column)
- **No database backup mechanism** — catastrophic data loss risk on the hub machine
- **No code signing** for the EXE — Windows SmartScreen warnings
- **Receiving UI** needs redesign for commercial use
- **Stock decremented at delivery completion, not order creation** — overselling risk during busy periods

### What Must Happen First
1. Fix `pinVersion` → `tokenVersion` JWT invalidation bug (auth middleware)
2. Add automated database backup to Electron app
3. Run pending migrations on Railway: `npx prisma migrate deploy`
4. Code sign the Windows EXE

---

## 2. Current System Map

### Application Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Railway Cloud                          │
│  ┌─────────┐  ┌──────────┐  ┌────────┐  ┌───────────┐  │
│  │ Express │  │ Postgres │  │  Admin │  │  Ordering  │  │
│  │  API    │  │   DB     │  │  SPA   │  │  Driver    │  │
│  │ :3001   │  │          │  │        │  │  Owner     │  │
│  └────┬────┘  └──────────┘  └────────┘  └───────────┘  │
└───────┼─────────────────────────────────────────────────┘
        │ HTTPS (sync push/pull + API calls)
        │
┌───────┼─────────────────────────────────────────────────┐
│  Desktop EXE (Electron)                                  │
│  ┌────┴─────┐  ┌──────────┐  ┌─────────────────────┐   │
│  │ Express  │  │ Postgres │  │  React SPA (Vite)    │   │
│  │  API     │◄─┤  (local) │  │  POS / Dashboard /   │   │
│  │ :3015    │  │  :5434   │  │  Products / Sales     │   │
│  └────┬─────┘  └──────────┘  └──────────┬──────────┘   │
│       │                                 │               │
│  ┌────┴─────┐                    ┌──────┴──────────┐   │
│  │ Cloud    │                    │  localStorage   │   │
│  │ Sync     │◄──────────────────►│  + IndexedDB     │   │
│  │ Bridge   │   dual-write       │  (19+ stores)    │   │
│  └──────────┘                    └─────────────────┘   │
└─────────────────────────────────────────────────────────┘
```

### Data Flow

1. **Desktop POS** writes to localStorage + IndexedDB (local-first)
2. `enqueueSyncOperation()` queues changes for push
3. Background sync pushes every 5s to local API → cloud sync bridge → Railway
4. Background pull every 10s from local API (which pulls from Railway every 30s)
5. WebSocket handles instant push for delivery/status updates
6. Staff login: API-first verification → offline SHA-256 fallback

### Multi-Tenant Model
- Single PostgreSQL database, all tables scoped by `tenantId`
- Owner portal creates tenants → generates per-tenant `cloudApiKey`
- Desktop EXE activates with subdomain + admin PIN → auto-discovers tenantId + API key
- Cloud sync bridge uses `X-Cloud-Key` + `X-Tenant-Id` headers for tenant-scoped sync

---

## 3. Top Critical Findings

### C1. pinVersion JWT invalidation bug
- **Severity:** Critical
- **Area:** Auth/Security
- **Evidence:** `apps/api/src/middleware/auth.ts:82-94` checks `user.tokenVersion !== payload.tokenVersion`. But login at `apps/api/src/routes/auth.ts:242-247` sets `payload.tokenVersion = user.pinVersion`. After PIN reset (which increments only `pinVersion`, not `tokenVersion` at `apps/api/src/routes/admin.ts:328`), existing JWTs remain valid because `tokenVersion` in DB hasn't changed.
- **Impact:** Staff can continue using old token after owner resets their PIN — defeating the purpose of PIN reset security.
- **Fix:** In `requireAuth`, compare against `user.pinVersion` instead of `user.tokenVersion`, OR increment `tokenVersion` alongside `pinVersion` during PIN reset.

### C2. No database backup mechanism
- **Severity:** Critical
- **Area:** Deployment/Operations
- **Evidence:** `apps/electron/src/main.ts` has no backup or `pg_dump` call. Entire PostgreSQL data directory (`%APPDATA%/Lebanon POS/pgdata`) has no automated backup.
- **Impact:** Disk corruption, accidental deletion, or ransomware means ALL sales, products, customers, and inventory data is permanently lost.
- **Fix:** Add periodic `pg_dump` backups to a configurable location, with a "Restore from backup" option in Settings.

### C3. Receiving UI needs redesign
- **Severity:** High
- **Area:** Inventory/Receiving
- **Evidence:** `apps/desktop/src/pages/products/ProductReceivePage.tsx` (793 lines). The current receiving flow uses a single form with barcode, name, cost, price, quantity, expiry, supplier, and PO number fields. No batch scanning, no bulk receive, no PO matching, no label printing integration.
- **Impact:** Slow for high-volume receiving. Cashiers must manually type every field for each product.
- **Fix:** Redesign with barcode-first flow, auto-fill from catalog, batch receive mode, PO matching, and label print integration.

### C4. No code signing for Windows EXE
- **Severity:** High
- **Area:** Deployment/Operations
- **Evidence:** `apps/electron/package.json` has no `sign` or `certificateFile` in electron-builder config.
- **Impact:** Unsigned EXE triggers "Windows protected your PC" SmartScreen warning. Destroys user trust for commercial deployment.
- **Fix:** Add EV code signing certificate to build pipeline.

### C5. Stock overselling risk on delivery orders
- **Severity:** Medium
- **Area:** Delivery/POS
- **Evidence:** Delivery orders check stock at creation (`delivery.ts:217-223`) but only decrement at delivery (`delivery.ts:529`, `delivery.ts:667`). Between creation and delivery, the same stock could be sold in-store.
- **Impact:** A delivery order and an in-store sale could consume the same stock if the delivery is delayed.
- **Fix:** Reserve stock at order creation (soft-lock), release on cancellation/timeout.

### C6. SaleRefund cascade destroys audit trail
- **Severity:** Medium
- **Area:** Database
- **Evidence:** Migration `20260626144415` adds `ON DELETE CASCADE` to `SaleRefund.saleId → Sale.id`. Deleting a sale silently removes all associated refund records.
- **Impact:** Audit trail is destroyed when sales are deleted. Legally problematic for tax compliance.
- **Fix:** Remove cascade, use soft-delete pattern with `isDeleted` flag on Sale.

### C7. Cloud API key exposed in admin portal
- **Severity:** Medium
- **Area:** Security
- **Evidence:** `apps/api/src/routes/admin.ts:108` returns `cloudApiKey` in `GET /tenants/:id` response. Any admin portal user can see all tenant API keys.
- **Impact:** Compromised admin access leaks all tenant API keys, enabling full data access/exfiltration.
- **Fix:** Remove `cloudApiKey` from the response, or only return it on explicit key-reveal action with audit logging.

---

## 4. Feature Review By Area

### 4.1 POS — Checkout & Sales Flow

**What works well:**
- Offline-first with IndexedDB + localStorage dual-write
- Exchange rate USD↔LBP handled correctly
- Discount (USD + Percent) reduces tax base correctly
- Held sales preserve cart state
- Complete sale wraps everything in try/catch with step-by-step rollback
- isCompleting state prevents double-click checkout

**What needs work:**
- `setItemPrice` has no permission gate — any cashier can override prices
- Sale number uses timestamp suffix, not sequential (tax authorities may require sequential)
- No "Card" payment button in UI (removed, but type system still has it)
- No split payment (cash + card)
- Change always returned in USD regardless of payment mix

### 4.2 Sync System

**Endpoints:** `POST /api/sync/push`, `GET /api/sync/pull`, `GET /api/sync/pull/full/:entity`

**Idempotency:** Yes for most entities via upsert. Product without barcode can duplicate.

**Entities synced:** 15+ (products, sales, customers, suppliers, inventory batches, settings, shifts, expenses, delivery orders, etc.)

**Error handling:** Each operation individually try/caught. Batch continues on individual failure. Atomic transactions per operation.

**Desktop:** Push every 5s, pull every 10s, WebSocket instant. Queue with max attempts (5), dead ops excluded from badge.

### 4.3 Auth & Security

**JWT:** HS256, 30-day expiry, secret from env. `tokenVersion` supports logout revocation.

**PIN:** bcrypt (cost 12) or legacy SHA-256. Auto-migrates on login. `pinVersion` tracks resets.

**Rate limits:** 13 endpoints rate-limited, persisted to DB every 10 min.

**Route protection:** All admin/sync routes protected. Public endpoints: login, signup, health, setup/check, discover, order creation, product listing.

**Issues:** Admin/cloud tokens bypass tokenVersion. No API key rotation. PIN brute-force possible (full user scan on login).

### 4.4 Inventory & Receiving

**Products:** Variants (parent/child), barcode aliases, categories, reorder points.

**Batches:** FIFO consumption by expiry then receipt date. Receiving creates batches, sales consume them. Restore on void creates RETURN-* batches.

**Stock adjustments:** Manual add/remove with reason tracking.

**Stock counts:** Draft → count lines → post (creates adjustment for each variance).

**Issues:** Receiving page slow for high volume. No bulk scan. No label printing. Float quantities may have edge case precision issues.

### 4.5 Sales & Refunds

**Sale storage:** localStorage + IndexedDB. status enum: Completed, Debt, Voided.

**Refund flow:** Select sale → refund items → adjust stock → record SaleRefund.

**Void:** Undos sale — restores stock, batches, reverses debt. Full audit trail.

**CSV export:** Available for sales list.

### 4.6 Customers & Debt

**Customer ledger:** Computed balance from DebtSale total - DebtPayment total. FIFO aging buckets.

**Credit limit:** Enforced at checkout. Blocks Debt sales exceeding limit.

**Wholesale pricing:** Per-product wholesale price, per-customer wholesale flag.

**Sell at cost:** Toggle for specific customers (all items priced at product.cost).

### 4.7 Suppliers & Purchase Orders

**PO lifecycle:** Draft → Received → Closed. Items with cost tracking.

**Supplier payments:** Recorded against suppliers with method/reference tracking.

**Supplier balances:** Separate ledger from customer debt.

### 4.8 Accounting & Dashboard

**Dashboard KPIs:** Net paid revenue, operating profit, outstanding debt, stock value. Trend charts for revenue.

**Daily close:** Records snapshot with gross sales, refunds, net, costs, margin, expenses, supplier payments, net profit, cash in/out.

**Shifts:** Open/close tracking, opening float, cash reconciliation (expected vs actual).

**Reports:** X report (mid-shift), Z report (close shift + cash reconciliation), margin analysis, debt aging, CSV exports.

### 4.9 Delivery, Ordering & Driver

**Delivery:** 21 API endpoints. Status flow: Pending→Confirmed→Preparing→OutForDelivery→Delivered/Cancelled. Atomic claim for driver accept.

**Ordering app:** Browse products → add to cart → place order with payment method. Order tracking via WebSocket+polling. Customer login with PIN.

**Driver app:** Login with code+PIN. Available orders list. Accept → Start Delivery → Deliver + collect cash. Rejection via cancellation.

**Issues:** Stock decremented at delivery, not order creation. No dedicated reject endpoint for drivers.

### 4.10 Admin & Owner

**Admin portal:** Dashboard, Sales, Staff, Delivery, Drivers, Products, Customers, Reports, Tenants. Auth via JWT with admin password.

**Owner portal:** Tenant CRUD, staff management, PIN reset. Auth via JWT with master password.

**Issues:** Cloud API key exposed in tenant view. Delete/Suspend UI needs polish.

### 4.11 Electron & Hardware

**Boot:** PostgreSQL → migrations → API spawn → health poll → cloud check → main window.

**Hardware support:** Thermal printer (80mm), barcode scanner (native + html5-qrcode fallback), camera scanner.

**Packaging:** electron-builder, NSIS installer, auto-updater from GitHub releases.

**Issues:** No cash drawer kick support. No label printer integration. No code signing.

### 4.12 Deployment

**Railway:** Dockerfile multi-stage build. All 5 SPAs built + API compiled. Prisma migration at start.

**Environment:** 15+ env vars (DATABASE_URL, JWT_SECRET, ADMIN_PASSWORD, CLOUD_API_URL, etc.).

**Health:** `/api/health` endpoint, DB connectivity check.

---

## 5. UI/UX And Design Review

### Current Design State
The POS migrated from an older design to a refined "Midnight Gold" aesthetic:
- Warm ivory page background (#F7F5F1) with deep gold brand (#9C6F14)
- Elevation shadow scale (elev-1 through elev-4)
- Button press effects, card hover lift, input hover states
- Focus-visible for keyboard users
- Modal system with pop-in animations, toast with slide-in
- Skeleton shimmer for loading states

### Strengths
- Comprehensive design token system across all apps
- Full dark/light mode support
- Consistent component naming (.card, .btn-*, .chip, .modal-*, etc.)
- Arabic/RTL support in sidebar, topbar, layout components
- Responsive utility classes (.mobile-hide, .mobile-tight, .mobile-full)
- Touch optimization (min 44px tap targets)

### Issues Found

**Hardcoded colors (50+ instances):**
| Location | Count | Example |
|----------|-------|---------|
| `NotificationCenter.tsx` | 6 | `#ef4444`, `#fca5a5` |
| `DashboardPage.tsx` | 8+ | PM_COLORS all hardcoded hex |
| `SaleCompleteOverlay.tsx` | 4 | `#10b981` hardcoded |
| `CustomersPage.tsx` | 2 | `#25D366` WhatsApp green |
| Admin CSS `.btn-danger` | 2 | `#e11d48` |
| Scanner status messages | 15+ | Emojis in scanner status |

**Broken RTL** (3 files):
- `StaffPage.tsx:276` — `text-left` should be `text-start`
- `SalesPage.tsx:46, 171` — `text-left` should be `text-start`

**Missing components:**
- No breadcrumb navigation
- No date range picker component
- No dropdown menu component
- No progress bar component
- No tooltip component

**Pages needing full redesign:**
1. Receiving page (ProductReceivePage.tsx) — highest priority
2. Customer detail/debt ledger — add detail view with payment history
3. Supplier page — add PO matching, payment scheduling

**Pages already well-designed:**
- POS checkout screen (product grid + cart rail)
- Products page (tabbed workspace, categories table)
- Login screen (staff cards + PIN entry)
- Settings page

---

## 6. Data Safety Review

### Can data be lost?
- **Local DB failure:** Yes — no backup mechanism. PostgreSQL on local machine has no automated dump.
- **Sync failure:** Queued operations retry up to 5 times with exponential backoff. Dead ops (exceeded retries) are pinned but could be lost on `clearStoreData()`.
- **Railway DB:** Protected (Railway handles backups), but migration `20260604000002` (Float→Decimal conversion) has a warning about potential data loss in cast.

### Can data duplicate?
- **Sale creation:** Idempotent — checks if sale ID already exists before creating.
- **Product without barcode:** Can duplicate — upsert by `tenantId_barcode` only works if barcode exists.
- **Settings:** Upsert by tenantId (single record) — cannot duplicate.

### Can stock be wrong?
- **Overselling:** `consumeInventoryBatches` uses `updateMany` with `quantityRemaining >= quantity` guard — atomic at DB level.
- **Race condition:** Single browser tab eliminates client-side races. Server-side sync uses transactions.
- **Delivery timing:** Stock decremented at delivery completion, not order creation — between order and delivery, POS could sell same stock.

### Can money be wrong?
- **Decimal precision:** All money fields use `Decimal(18,4)` — no Float rounding errors.
- **Currency conversion:** `usdToLbp` returns raw float — `roundLbp()` used at display time for banknote-friendly amounts.
- **Discount calculation:** Correct — discount reduces subtotal before tax calculation.

### Can stores mix data?
- **Tenant isolation:** Every model (except RateLimitEntry) has `tenantId` with FK to Tenant.
- **`clearStoreData()`** on store switch wipes all localStorage + IndexedDB for the current store.
- **Known stores** list preserved separately for the switcher UI.

### Can a broken laptop recover from cloud?
- **Yes** — cloud sync bridge pulls ALL data from Railway on first connect.
- Activation wizard: user enters subdomain + admin PIN → auto-discovers tenantId + API key → full pull.
- All data restored: products, customers, sales, settings, staff, inventory, delivery orders.

---

## 7. Test And Verification Results

### Commands Run
```
pnpm --version            # Installed (visible in lockfile)
npx tsc -p apps/*/tsconfig.json --noEmit    # ALL PASS
npx vite build apps/desktop                 # PASS
npx vite build apps/admin                   # PASS
npx vite build apps/ordering                # PASS
npx vite build apps/driver                  # PASS
npx vite build apps/owner                   # PASS
npx tsc apps/api                            # PASS
```

### Test Coverage
- **API tests:** 7 test files in `apps/api/src/__tests__/` (vitest) — test auth, sync, delivery, reports, setup, admin, image routes
- **Desktop tests:** Not found — no `__tests__` directory in `apps/desktop`. Coverage: 0%.
- **Admin/Ordering/Driver tests:** Not found. Coverage: 0%.
- **Test runner:** vitest (configured in API package.json)

### TypeScript Coverage
- All 6 apps + 2 packages have `tsconfig.json` with `strict: true`
- All pass `tsc --noEmit` with zero errors
- `noUnusedLocals` and `noUnusedParameters` enabled on most apps

---

## 8. Recommended Sprint Plan

### Day 0 — Blockers
1. Fix `pinVersion` JWT invalidation bug (auth middleware)
2. Run pending migrations on Railway
3. Generate `ADMIN_PASSWORD_HASH` on Railway

### Sprint 0 — Data/Sync Trust
1. Add database backup mechanism (pg_dump on shutdown, periodic backup)
2. Add `isDeleted` soft-delete to Sale model, remove SaleRefund cascade
3. Add reserve-stock-on-order for delivery (prevent overselling)
4. Fix product-without-barcode duplicate sync

### Sprint 1 — Design Foundation
1. Tokenize all remaining hardcoded hex colors (50+ instances)
2. Fix all `text-left` → `text-start` for RTL (3 files)
3. Replace emojis with SVG icons (scanner, status, etc.)
4. Add missing components: breadcrumb, date range picker, tooltip

### Sprint 2 — POS Polish
1. Add Card payment button back to checkout
2. Add permission check on `setItemPrice`
3. Add split payment (cash + card) mode
4. Sequential sale number option for tax compliance
5. Add online/offline indicator

### Sprint 3 — Hardware & Receipts
1. Add cash drawer kick support
2. Add barcode label printing integration
3. Improve print receipt flow (auto-detect printer)

### Sprint 4 — Inventory & Receiving
1. Full redesign of receiving page (barcode-first, batch mode, PO matching)
2. Add label print on receive
3. Add bulk stock adjustment
4. Add inventory valuation report

### Sprint 5 — Owner & Accounting
1. Add cloud API key rotation endpoint
2. Add tenant analytics (revenue, active users, growth)
3. Add profit & loss statement
4. Add tax report

### Sprint 6 — Settings & Recovery
1. Add backup/restore UI in Settings
2. Add system health dashboard
3. Add error telemetry (Sentry or similar)
4. Add automated database maintenance (VACUUM, reindex)

### Sprint 7 — Delivery
1. Add reserve-stock-at-order-creation (soft lock)
2. Add driver performance metrics
3. Add estimated delivery time display
4. Add customer self-service cancellation

### Sprint 8 — Launch QA
1. Full dark/light mode audit on every screen
2. Mobile/tablet audit (375px to 1440px)
3. Keyboard navigation + focus audit
4. RTL verification across all pages
5. Color contrast check (WCAG AA)
6. Console error sweep

---

## 9. Quick Wins (Under 1 Day)

1. **Fix pinVersion JWT invalidation** — 3-line change in `auth.ts` middleware
2. **Remove SaleRefund cascade** — 1 migration to revert
3. **Tokenize 50+ hardcoded colors** — mechanical search-and-replace
4. **Fix 3 RTL `text-left` instances** — mechanical
5. **Add retry button to DashboardPage error state** — 5-line change
6. **Add confirmation dialog before toggle active on DriversPage** — done in previous sprint
7. **Generate ADMIN_PASSWORD_HASH on Railway** — 1 command

---

## 10. Open Questions

1. **Should sequential sale numbers be enforced?** Some Lebanese tax authorities require sequential numbering. Currently uses timestamp-based.
2. **Should Card payment return to UI?** Removed from POS but still in type system. Was this intentional?
3. **Is hardcoded `10mb` JSON body limit sufficient?** For sync operations with large payloads (100+ products), this could be tight.
4. **Should delivery stock be reserved at order time?** Trade-off: better accuracy vs potentially locking stock for cancelled orders.
5. **What's the backup strategy for Railway?** Railway provides automated backups — are they configured?
6. **Is the 30-day JWT expiry appropriate?** For POS terminals that may go months without restart, this could cause mid-shift lockout.
7. **Should the EXE be code signed before launch?** SmartScreen warnings significantly impact commercial adoption.

---

## 11. Appendix

### A. Important Files Inspected
| File | Purpose |
|------|---------|
| `apps/api/prisma/schema.prisma` | Database schema (28 models, 9 enums) |
| `apps/api/src/routes/sync.ts` | Sync push/pull handling |
| `apps/api/src/routes/auth.ts` | Authentication (login, PIN, JWT) |
| `apps/api/src/routes/admin.ts` | Admin portal (tenants, staff, reset PIN) |
| `apps/api/src/routes/delivery.ts` | Delivery order management |
| `apps/api/src/routes/setup.ts` | Cloud setup, discovery, activation |
| `apps/api/src/middleware/auth.ts` | JWT signing, requireAuth middleware |
| `apps/api/src/middleware/security.ts` | Rate limiting, CORS, security headers |
| `apps/api/src/middleware/cloudAuth.ts` | Cloud API key authentication |
| `apps/api/src/ws/index.ts` | WebSocket server |
| `apps/api/src/services/cloudSync.ts` | Cloud sync bridge (push/pull loops) |
| `apps/api/src/app.ts` | Express app setup |
| `apps/desktop/src/index.css` | Design tokens + component styles |
| `apps/desktop/src/features/pos/pages/POSPage.tsx` | Main POS checkout screen |
| `apps/desktop/src/features/pos/services/sync.service.ts` | Desktop sync client |
| `apps/desktop/src/features/pos/services/security.service.ts` | Login, PIN, auth |
| `apps/desktop/src/features/pos/services/sales.service.ts` | Sale recording and voiding |
| `apps/desktop/src/features/pos/lib/currency.ts` | Currency formatting |
| `apps/electron/src/main.ts` | Electron boot sequence |
| `Dockerfile` | Railway deployment |

### B. Models (28 total)
Tenant, StaffUser, AppSettings, Product, Sale, SaleItem, SaleTender, SaleRefund, RefundItem, Customer, DebtSale, DebtPayment, Supplier, PurchaseOrder, PurchaseOrderItem, SupplierPayment, Shift, AuditEvent, Expense, InventoryBatch, StockAdjustment, StockCountSession, StockCountLine, DeliveryOrder, DeliveryOrderItem, DailyClose, SyncOperation, RateLimitEntry, StockMovement

### C. Major localStorage Keys
`lebanonpos.sync-queue.v1`, `lebanonpos.sync-last.v1`, `lebanonpos.api-url`, `lebanonpos.auth-token`, `lebanonpos.suspended.v1`, `lebanonpos.known-stores.v1`, `lebanonpos.products.v1`, `lebanonpos.sales.v1`, `lebanonpos.users.v1`, `lebanonpos.current-user.v1`, `lebanonpos.session.v1`, `lebanonpos.settings.v1`, `lebanonpos.shifts.v1`, `lebanonpos.audit.v1`, `lebanonpos.customers.v1`, `lebanonpos.suppliers.v1`, `lebanonpos.held-sales.v1`, `lebanonpos.pin-attempts.v1` (brute-force)

### D. Environment Variables (Redacted)
`DATABASE_URL`, `JWT_SECRET`, `PORT`, `ADMIN_PASSWORD`, `ADMIN_PASSWORD_HASH`, `CORS_ORIGINS`, `CLOUD_API_URL`, `CLOUD_API_KEY`, `CLOUD_TENANT_ID`, `IS_LOCAL_SERVER`, `HUGGINGFACE_TOKEN`, `NODE_ENV`, `JWT_EXPIRES_IN`, `PRISMA_QUERY_ENGINE_LIBRARY`

### E. Migrations (17 total)
See Section 1.8 of database audit for full list. Latest: `20260705000000_add_pin_version` and `20260705000001_add_token_version` (pending deployment).

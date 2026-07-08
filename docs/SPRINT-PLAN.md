# Lebanon POS Master Sprint Plan v4 (2026-07-08)

Grounded in a code audit of THIS repo (`D:\Claude project\6.3.2026\v4\lebanonpos`, 200 commits, v1.0.7 EXE). The stale copy at `D:\Claude project\lebanonpos` must never be used.

## Platform state (audited)
**Built and working:** 7 apps (desktop, api, admin, owner portal, driver, ordering, electron packaging). Desktop: POS cockpit (QuickPOS mode, favorites, keyboard shortcuts, dual-currency auto-detect tender, sale overlay, receipt print/preview, held sales, shift history, cash-drawer panel, CSV exports), Dashboard, Sales, Accounting (daily close, expenses, cash flow, KPIs), Customers (debt), Suppliers/PO, Products + Receiving (barcode aliases), Delivery, Drivers, Staff, Settings. PIN system complete (pinVersion/tokenVersion, bcrypt admin, brute-force lockout, session revocation). i18n incl. RTL. Sync with failed/dead/retry states + allowed-actions whitelist. 7 API test suites + desktop core tests. Design tokens from POS-UI-1..7.

**Verified gaps:** no thermal-printer/drawer-kick integration (browser print only); no general push-op dedupe (only sales are id-keyed); no documented conflict policy; no per-op structured validation errors; no local backup/restore independent of sync; hard-coded hex colors across Accounting/Customers/Dashboard/Delivery components (35 occurrences repo-wide); no first-run onboarding; PIN migrations not yet deployed to Railway.

**Deep-audit findings (2026-07-08, from reading code + running suites):**
- **BUG: refunds record no exchangeRate/tender breakdown** (`recordRefund` in sales.service.ts) while sales do — refunds on a day the rate moved compute wrong money. Fix in Sprint 2.
- **API test suite is RED: 74/77** — delivery order create returns 500, NaN-changeRequired guard returns 500, image serve 404s. Desktop suite green (24/24). Fix in Day 0.
- **Business data is localStorage-primary** (IndexedDB only mirrors). ~5–10MB cap, synchronous, wipeable by browser cleanup — a scalability + data-loss risk for real shops. Address in Sprint 0.
- **No product-grid virtualization** (memoized only) — perf cliff for 1,000+ product catalogs. Address in Sprint 2.
- **Monoliths:** POSPage 1,015 lines, SettingsPage 1,109 lines — refactor opportunistically during Sprints 2 and 6, not as a separate sprint.

Sprint length: ~1 focused week unless noted. Priority: deploy what's built → sync trust → design consistency → money correctness → hardware → polish → delivery → launch.

---

## Day 0 — Deploy & Baseline (1–2 days, blocking)
1. Back up Railway production DB.
2. `npx prisma migrate deploy` (pin_version + token_version) on Railway; set `ADMIN_PASSWORD_HASH`.
3. Verify live: staff login online/offline, owner PIN reset propagation, admin login.
4. **Fix the 3 failing API tests** (delivery create 500, NaN changeRequired 500, image serve 404), then record the green baseline (API 77/77 + desktop 24/24).
5. Rename/retire the stale `D:\Claude project\lebanonpos` copy after checking its uncommitted work.

## Sprint 0 — Sync Trust Completion
Harden what exists rather than rebuild.
- **Idempotency for all push ops:** client-generated `opId` per operation, server dedupe table; retries never duplicate debts, payments, expenses, receives, adjustments, counts (sales already id-keyed — verify with a double-push test).
- **Conflict policy documented + enforced** in `docs/sync-contract.md`: server-wins for settings/staff/security; last-write-wins (updatedAt) for products/customers/suppliers; append-only + dedupe for sales/refunds/payments/receives/counts.
- **Per-op structured errors** from `/api/sync/push`: stable error codes, surfaced in desktop sync UI per operation.
- **Storage layer hardening:** flip primary storage from localStorage to IndexedDB (or SQLite via Electron) with localStorage as cache only; quota monitoring; migration path for existing installs. localStorage-primary is a data-loss + 5–10MB-cap risk for real shops.
- **Local backup independent of sync:** scheduled export to file + one-click restore (sync is not backup).
- **Tests:** double-push dedupe per entity, mid-push connection kill, multi-store switch isolation, settings round-trip, multi-batch receive.

## Sprint 1 — Design Consistency Sweep (0.5–1 wk)
Tokens exist (POS-UI-1..7); finish adoption.
- Grep-driven sweep of hard-coded hex/light classes: Accounting components (KpiCards, CashFlow, CloseDay, ExpenseForm/Mix/Panel, History), CustomersPage, DashboardPage, DeliveryPage — migrate to tokens.
- Extract any still-inline patterns into shared primitives (StatCard, FilterBar, StatusBadge, EmptyState, Skeleton) where duplication exists.
- Tabular numerals for all money displays.
- Exit: repo-wide grep for raw hex in pages/components returns only token definitions.

## Sprint 2 — Money Correctness & POS Verification
POS features exist; prove they're right.
- **Money invariants module + property tests:** tender lines sum to total at recorded rate; refunds use the ORIGINAL sale's exchange rate; mixed-tender sale → refund → daily close balances to zero; smart LBP rounding never loses money across a day.
- **Fix the refund-rate bug:** `recordRefund` must store the original sale's exchangeRate + tender breakdown; refund UI shows original-rate amounts.
- POS speed audit: timed 10-item sale ≤20s; scanner focus recovery (incl. Arabic keyboard layout); QuickPOS role-locked for cashiers (verify vs spec, fix gaps).
- **Product grid virtualization** (react-window or equivalent) so 1,000+ product catalogs stay smooth; measure before/after with a seeded large catalog.
- Opportunistic split of POSPage (1,015 lines) into feature hooks/components while touching it.
- Fix whatever the audit finds; no redesign unless a flow fails the timing test.

## Sprint 3 — Hardware & Receipts (the biggest true gap)
- Thermal printing via Electron (ESC/POS or raw driver): 58mm/80mm templates, printer picker, test print.
- Cash drawer kick (ESC/POS pulse through the printer).
- Receipt template polish: bilingual AR/EN, dual currency, tax, debt balance line, store identity, logo.
- Barcode label printing from Products/Receiving.
- Scanner settings: prefix/suffix, Enter behavior, focus recovery.
- Test on real target hardware on Windows.

## Sprint 4 — Inventory & Receiving Polish
ProductReceivePage exists; gap-fill only.
- Receiving workflow audit vs spec: supplier/invoice header, scan row, batch/expiry/cost/price/reorder fields, validation before save, totals, labels.
- Stock-confidence surfacing: low stock, expiry soon, dead stock, reorder suggestions (stockout prediction exists in old copy — port if missing here).
- Products ↔ Receiving ↔ Suppliers ↔ Batches cross-navigation with no dead ends.
- Audit history for every stock change (verify inventoryAdjustment coverage).

## Sprint 5 — Owner Views Polish
- Dashboard: owner-readable labels, Today/Week/Month/Custom ranges.
- Sales: advanced filters, saved views, export, refund/void flow with full audit trail.
- Accounting: cashier drawer reconciliation per shift; verify daily close, expenses, paid-vs-debt, operating profit, stock value against real data.
- Customers: promise-to-pay notes; debt aging/statement/reminder polish (port from old copy if missing here).

## Sprint 6 — Settings, Roles, Navigation
- Reorganize SettingsPage into sections: Store Profile · Money & Tax · Users & PINs · Roles & Permissions · Cloud Sync · Backup & Recovery · POS Behavior · Receipt & Printer · Barcode & Scanner · Delivery · WhatsApp · Inventory Rules.
- Users & PINs reflects shipped architecture: Owner Portal owns PINs; desktop read-only status.
- Role-based navigation: Cashier → POS/QuickPOS (+customers if allowed); Manager → +products/receiving/sales; Admin/Owner → all. (rolePermissions exists — audit + enforce in sidebar and routes.)
- Header chips: store name, current role, sync health.

## Sprint 7 — Delivery & Ordering (deferrable)
- Status flow: Pending/New → Confirmed → Out For Delivery → Delivered (+ Cancelled).
- Desktop delivery board: driver assignment, customer contact, payment status.
- Driver app + customer ordering + WebSocket live updates with polling fallback (ws test suite exists — extend).
- WhatsApp order updates.

## Sprint 8 — Launch QA & Onboarding
- First-run onboarding wizard: store profile → printer → first product → first sale.
- Final design sweep (grep-verified zero stray hex/light classes).
- Skeletons/empty/error states on remaining screens; mobile-width pass.
- Full regression: sync suite, POS timing, money round-trips, role matrix, PIN reset online/offline, fresh-device recovery rehearsal.
- Fresh EXE build (v1.1.0), install test on a clean Windows machine.
- Desktop + mobile screenshots of all major screens.

---

## Cross-cutting rules
- Tokens/primitives only; new raw hex fails review.
- Sync contract frozen after Sprint 0; changes require doc + DTO + test updates together.
- Money module is the single source for tender/rate/rounding math.
- Every sprint ends with its tests green plus the Day-0 baseline suites.

## Test plan (rolling)
- Sync: per-entity double-push dedupe, mid-push kill, settings round-trip, multi-batch receive, multi-store isolation.
- Money: mixed-tender round-trip, original-rate refunds, daily-close balance, LBP rounding conservation.
- POS: timed sale, each payment type, stock decrement, QuickPOS as cashier.
- PIN: server reset → offline denial (pinVersion mismatch), lockout, session revocation.
- Roles: cashier blocked, manager limited, owner full.
- Recovery: fresh device with URL + subdomain + admin PIN.
- Hardware: thermal print 58/80mm, drawer kick, label print.

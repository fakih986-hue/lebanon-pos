# TITAN POS — Implementation Checklist (from Fable visual direction)

Companion to `fable-premium-visual-direction.md`. For OpenCode execution.
Rules: tokens only · file-by-file commits · `tsc --noEmit` + `vitest run` green before every commit · no behavior change to money math, sync, security · 4-way QA (dark/light × EN/AR) per phase.

## Phase 1 — Foundation quick wins — ✅ COMPLETE 2026-07-09 (Fable, sprint POS-UX-F1)
- [x] QuickPOS `PAY_OPTIONS`: add Card (order Cash · Card · Wallet · Debt) — `QuickPOSMode.tsx` (grid-cols-4)
- [x] Main POS `CartBody.tsx`: Card added there too + per-method emerald/violet/amber active classes replaced with gold token active (design law) + aria-pressed
- [x] "Clean" → "Clear sale" (i18n EN+AR values updated; new `pos.pay` key)
- [x] Scan-bar error escalation: danger border + danger ring 1.2s on unknown barcode / out-of-stock / stock-cap — both SearchToolbar and QuickPOS bars (verified live: rgb(248,113,113))
- [x] Checkout label now dynamic "Pay $X" (Debt keeps "Record Debt — $X")
- [x] Removed `v1.0.x` chip from `Topbar.tsx`
- [x] Cart steppers 28→36px + aria-labels (Increase/Decrease/Set quantity); camera/clear/more icon buttons got aria-labels
- [x] Manual: product tap adds, qty +/- works, Card selects (gold #D4A843 + dark text), cash tender change calculates, Clear Sale confirms w/ items + cancel preserves cart, tsc clean, 62/62 tests

## Phase 2 — Tender unification — ✅ COMPLETE 2026-07-09 (Fable)
- [x] Shared `TenderPanel.tsx` (density full | quick): payment row, cash tender (inputs, quick-cash chips, exact, change/still-due), debt picker — consumed by `CartBody.tsx` + `QuickPOSMode.tsx`; pure presentation, all state/math in POSPage; Enter-flow (USD→LBP→review) preserved via optional callbacks; change panel now semantic green/red in both modes
- [x] `LastSaleBanner` already rendered in main POS (pre-existing — verified, no change needed)
- [x] Held sales as pill shelf ABOVE cart items (play icon + hold# + total, tap resumes, ✕ discards); collapsible section removed
- [x] Toast position route-aware: bottom-center on `/` (verified: centered, 24px from bottom), top-end elsewhere
- [x] Manual verified live: cash change in both modes (incl. exact-LBP change 248,210 regression), hold→pill→resume, 4 tiles both modes, tsc clean, 62/62 tests

## Phase 3 — Inventory / Customers / Dashboard
- [ ] Product edit modal → right drawer; new `components/ui/Drawer.tsx`
- [ ] Generate Images + Bulk Edit behind "⋯ Tools" menu — `ProductsPage.tsx`
- [ ] Batches tab: FEFO sort + expiry countdown chips (>30d green / ≤30d amber / ≤7d red)
- [ ] Customers: clickable aging bands filter ledger; promise-to-pay note; credit-limit progress bar — `CustomersPage.tsx`
- [ ] Dashboard action queue: inline action buttons, money-at-risk sort, "All clear" success empty state — `DashboardPage.tsx`, `AlertsPanel.tsx`
- [ ] Manual: product edit round-trip, debt payment + statement, dashboard ranges incl. empty

## Standing design laws (review gates)
- [ ] One solid-gold element max per zone; money digits never gold
- [ ] Money = tabular-nums 600/700, LTR always; 40px total is unique per screen
- [ ] Tabs are places; actions are buttons
- [ ] Stock/status info renders only when actionable
- [ ] Selected rows = gold-soft wash + 3px inset gold bar (only selection style)
- [ ] Sidebar stays dark in both themes
- [ ] New raw hex outside `index.css`/`paymentColors.ts`/accent map = reject

## Explicitly rejected
- Mojibake/encoding work (false positive — verified clean UTF-8)
- Sidebar regroup to Sell/Stock/Online (Finance stays first-class)
- Per-method payment colors in tender UI (charts only)

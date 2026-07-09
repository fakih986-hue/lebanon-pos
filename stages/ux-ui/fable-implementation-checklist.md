# TITAN POS — Implementation Checklist (from Fable visual direction)

Companion to `fable-premium-visual-direction.md`. For OpenCode execution.
Rules: tokens only · file-by-file commits · `tsc --noEmit` + `vitest run` green before every commit · no behavior change to money math, sync, security · 4-way QA (dark/light × EN/AR) per phase.

## Phase 1 — Foundation quick wins
- [ ] QuickPOS `PAY_OPTIONS`: add Card (order Cash · Card · Wallet · Debt) — `QuickPOSMode.tsx`
- [ ] "Clean" → "Clear sale" (i18n EN+AR) — `SearchToolbar.tsx`, QuickPOS header
- [ ] Scan-bar error escalation: danger border 1.2s on unknown barcode / out-of-stock — `SearchToolbar.tsx`, `POSPage.tsx`
- [ ] Remove `v1.0.x` chip from `Topbar.tsx`
- [ ] 44px hit-areas: POS cart steppers + icon buttons <32px
- [ ] Manual: cash sale E2E, error scan visual+buzz, AR, light

## Phase 2 — Tender unification
- [ ] Extract shared `TenderPanel` (density: full | quick); consume from `CartBody.tsx` + `QuickPOSMode.tsx`; zero logic change
- [ ] `LastSaleBanner` in main POS under scan bar, 30s dissolve
- [ ] Held sales as pill-tabs above cart; recall shelf = drawer
- [ ] Toast position: bottom-center on POS routes, top-end elsewhere — `Toast.tsx`
- [ ] Manual: 4 payment methods × both modes, mixed tender, change/still-due, hold/recall, refund regression

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

# Lebanon POS — Design Plan (v1, 2026-07-08)

A from-scratch visual redesign of every page, executed page-by-page in Fable sessions. Goal: an interface that looks like a $100K commercial SaaS product — distinctive, calm, fast, and beautiful on a shop PC and a phone.

Current state (audited): tokenized dual-theme system exists in `apps/desktop/src/index.css` (1,192 lines) — warm cream/gold "Titan" light theme + dark theme. Primitives: Button, EmptyState, Spinner, Toast, WorkspaceTabs; shell: Sidebar, Topbar, NotificationCenter, SyncStatus. 35 raw hex stragglers in pages. This plan REPLACES the visual language while keeping the token architecture.

---

## 1. Design identity: "Midnight Gold"

One signature look, dark-first, with the Titan gold heritage as the accent. Dark is the primary theme (shops run the POS all day; dark reads premium and reduces glare); the light theme stays as a derived variant.

**Principles**
1. **Calm surface, loud money.** Backgrounds recede; numbers, totals, and statuses are the loudest things on screen.
2. **One accent, used sparingly.** Gold marks the primary action and brand moments only. Everything else is neutral or semantic.
3. **Depth from light, not lines.** Elevation via subtle gradients/glows, hairline borders only where separation is ambiguous.
4. **Speed is visible.** Every interaction acknowledges in <100ms (pressed states, optimistic UI, skeletons — never spinners on primary flows).
5. **Bilingual by design.** Every layout must be beautiful in Arabic RTL, not just mirrored.

## 2. Foundation tokens (rebuild `index.css` palette, keep variable names)

**Color — dark (primary)**
- Page: `#0B0E14` (near-black blue). App canvas, behind everything.
- Surface: `#12161F` cards · Surface-2 `#171C27` raised · Surface-3 `#1E2430` overlays/menus.
- Hairline borders: `rgba(148,163,184,0.08)` default · `0.16` strong.
- Text: `#F4F6FA` primary · `#9AA4B8` secondary · `#5F6B80` muted.
- **Brand gold**: `#D4A843` (primary actions, focus rings, logo) · hover `#E4BC5C` · soft `rgba(212,168,67,0.12)`.
- Semantic: success `#34D399` · danger `#F87171` · warning `#FBBF24` · info `#60A5FA` — each with `-soft` (12% alpha) fills.
- Money colors: USD amounts `#F4F6FA`, LBP amounts `#9AA4B8` (secondary until focused), profit `#34D399`, debt `#F87171`.

**Light theme** derives: warm paper `#FAF8F4`, white cards, same gold, deeper text — regenerated from the same semantic roles, never designed separately.

**Typography**
- UI: Inter (or IBM Plex Sans Arabic for AR — must pair; test Arabic rendering).
- Numbers: `font-variant-numeric: tabular-nums` EVERYWHERE money appears. Totals use a display size (28–40px, weight 700). Money never wraps.
- Scale: 12 / 13 / 14 (base) / 16 / 20 / 24 / 32 / 40. Line-height 1.5 text, 1.1 numerals.

**Space, radius, elevation, motion**
- 4px grid; component padding 12/16/20; page gutter 24 (16 mobile).
- Radius: 10 controls · 14 cards · 20 modals · full for pills/badges.
- Elevation: e1 `0 1px 2px rgba(0,0,0,.4)` · e2 `0 4px 16px rgba(0,0,0,.35)` · e3 modals `0 16px 48px rgba(0,0,0,.5)` + 1px inner hairline top (`rgba(255,255,255,.04)`) on raised surfaces for the "lit edge" premium cue.
- Motion: 120ms micro (hover/press) · 200ms panels · 320ms overlays; easing `cubic-bezier(.2,.8,.2,1)`; scale-press `0.98` on all buttons; number changes tick with a 200ms slide-up.

**Touch/density:** every interactive target ≥44px in POS screens; tables offer dense mode (36px rows) for owner screens.

## 3. Primitive kit (build in this order; everything else composes from these)

1. `Button` (primary-gold / neutral / ghost / danger; sizes sm-md-lg-xl; loading state built-in)
2. `Card` + `StatCard` (label, big tabular number, delta chip, sparkline slot)
3. `PageHeader` (title, subtitle, actions, breadcrumb-less — POS apps don't need breadcrumbs)
4. `Toolbar` / `FilterBar` (search, filter chips, date-range control, saved views)
5. `DataTable` (dense/comfortable, sticky header, row hover, sortable, skeleton rows, empty state slot, mobile card-collapse)
6. `StatusBadge` (semantic dot + label pill; one component for sale/sync/delivery/stock states)
7. `Modal` / `Drawer` / `Sheet` (bottom sheet on mobile widths)
8. `Toast` (rework: bottom-center on POS, top-right on owner pages)
9. `Skeleton` (shimmer, matches every card/table geometry)
10. `MoneyText` (THE money renderer: currency, tabular, size variants, dual-currency stack USD-over-LBP)
11. `KeypadButton` / `Numpad` (shared by tender, PIN lock, quantity)
12. `SegmentedControl`, `Tabs` (underline style), `Kbd` hint chip
13. `EmptyState` (illustrated — one consistent illustration style, gold-line on dark)

## 4. App shell

- **Sidebar**: 72px icon rail (collapsed default on POS role) expanding to 240px; active item = gold left bar + soft fill; role-filtered items; store identity block at top (logo/initial, store name, subdomain); sync-health dot + current user/role at bottom.
- **Topbar**: page title, global search (`/` to focus), sync status chip, notification bell, theme toggle, lock button (goes to PIN lock).
- **PIN lock screen**: full-screen brand moment — centered logo, big Numpad primitive, gold focus glow, shake on wrong PIN, lockout countdown ring. This screen is seen 50×/day; it must be the most polished screen in the app.

## 5. Page-by-page redesign specs

Each page below is one Fable execution unit: spec → build → screenshot QA (dark+light, EN+AR, desktop+390px).

### 5.1 POS Cockpit (the flagship — 40% of total design effort)
Three-zone layout, zero navigation during a sale:
- **Left rail (56%):** search bar (always focused, scanner-safe) → category chips (horizontal scroll, soft-fill active) → product grid (image-or-initial tiles, name, price via MoneyText, stock dot; 8–12 visible; virtualized).
- **Right rail (44%):** cart. Each line: name, qty stepper, line total; swipe/hover to remove. Beneath: subtotal/discount/tax rows → **the Total** — the single largest element on screen (40px gold-underlined tabular numerals, dual-currency stacked).
- **Tender zone (bottom of cart):** payment method segmented control (Cash/Card/Wallet/Debt) → quick-cash chips (round LBP + USD denominations) → Numpad on demand → change display in green.
- **Sale complete:** full-cart-rail takeover overlay — green check draw-in animation (400ms), change due huge, Print / WhatsApp / New Sale buttons. Auto-dismiss 5s.
- Held sales as pill-tabs above the cart. Keyboard hints (Kbd chips) on hover. Favorites bar as a pinned first category.

### 5.2 QuickPOS / Worker Mode
Same DNA, radically reduced: full-screen, no sidebar; giant grid + cart column; XL touch targets (56px); total permanently visible; one payment row; lock button only escape. Design target: usable by a first-day cashier with zero training.

### 5.3 Dashboard (owner's morning coffee screen)
- Row 1: four StatCards — Today's Sales, Profit, Debt Outstanding, Cash in Drawer — each with 7-day sparkline and delta chip.
- Row 2: revenue area-chart (gold gradient fill, range control Today/Week/Month/Custom) beside top-products horizontal bars.
- Row 3: live feed (recent sales ticking in) + alerts panel (low stock, stale rate, unsynced ops) as actionable rows, not text.
- All charts: no gridline clutter, hairline axes, tooltip cards on hover.

### 5.4 Sales
FilterBar with saved views (chips: Today, This Week, Refunds, Debt sales…) → DataTable (sale #, time, cashier, items count, method badge, MoneyText total, status) → row click opens a **Drawer**: full receipt replica, timeline (sold → synced → refunded), refund/void actions with confirm + reason. Refund flow shows ORIGINAL rate explicitly.

### 5.5 Accounting
Tab layout: Overview / Daily Close / Expenses / History.
- Overview: cash-flow waterfall (in green / out red), paid-vs-debt donut, expense mix.
- Daily Close: a ceremony, not a form — expected vs counted side-by-side, difference auto-highlighted (green match / red variance), close button gold, closed day gets a "sealed" stamp treatment.
- Expenses: quick-add inline row + categorized list.

### 5.6 Customers & Debt
Split view: searchable customer list (avatar-initial, name, phone, debt badge) → detail pane: debt aging bar (color bands 0-30/31-60/60+), statement timeline, promise-to-pay notes, WhatsApp reminder button, credit-limit progress bar.

### 5.7 Products & Categories
Toolbar (search, category filter, stock filter, + Add) → grid/table toggle. Table: image, name, barcode(s), cost, price, margin %, stock with confidence dot (green/amber/red/skull-for-dead). Edit in Drawer, not page navigation. Category manager: color-dot per category from a fixed 10-color token ramp (kills random colors forever).

### 5.8 Receiving (stock intake)
A focused document editor: sticky header (supplier select, invoice #, date) → scan-first row entry (scan → row appears → tab through qty/cost/expiry) → running totals footer → validate → save ceremony with label-print offer. Row validation inline (red hairline + message under the field).

### 5.9 Suppliers
List + detail: balance owed (MoneyText, red), PO history table, payment recording inline, WhatsApp PO button.

### 5.10 Delivery Board
Kanban: Pending → Confirmed → Out for Delivery → Delivered columns; order cards (customer, phone tap-to-call, address, MoneyText, payment badge, driver avatar chip); drag or button advance; live updates pulse-highlight new cards. Cancelled = collapsed rail.

### 5.11 Drivers & Staff
Staff: card grid (avatar, name, role badge, PIN status, last active), owner-portal note for PIN resets. Simple, administrative, calm.

### 5.12 Settings
Two-pane: sticky section nav (12 sections per sprint plan) → content pane, each section a Card with clear rows (label left, control right, description under label). Danger zone (clear data, disconnect store) visually quarantined at bottom in rose-soft. Search settings box on top.

### 5.13 Login / Connect Store + Onboarding
- Connect: centered card on a subtle radial gold-glow background — server URL, subdomain, admin PIN; connection progress as a 3-step checklist animation.
- First-run wizard: 4 full-screen steps (Store profile → Printer → First product → First sale simulation) with progress dots; skippable; ends with confetti (once, tasteful).

## 6. RTL & bilingual rules
- Logical CSS properties only (`margin-inline-start`, never `margin-left`).
- Numerals stay LTR/tabular inside RTL text; money never mirrors.
- Every Fable page session QAs Arabic before closing.

## 7. Execution plan for Fable sessions

| Session | Scope | Exit gate |
|---|---|---|
| D0 | Token rebuild (palette above into index.css), MoneyText, Button, Card/StatCard, Skeleton, StatusBadge | primitives demo route screenshot, dark+light |
| D1 | Shell: Sidebar, Topbar, PIN lock, Toast rework | shell screenshots EN+AR |
| D2 | **POS Cockpit** (biggest session, allow 2) | timed sale ≤20s + 4-way screenshots |
| D3 | QuickPOS + Sale Complete overlay | cashier-role walkthrough |
| D4 | Dashboard + charts | 4-way screenshots |
| D5 | Sales + Accounting | refund drawer + daily-close ceremony QA |
| D6 | Customers, Products, Receiving | intake flow walkthrough |
| D7 | Suppliers, Delivery board, Drivers, Staff | kanban live-update QA |
| D8 | Settings, Login/Connect, Onboarding wizard | fresh-install walkthrough |
| D9 | Sweep: kill all 35 raw hex, dense-mode pass, mobile pass, motion audit | grep clean + full screenshot set |

Rules for every session: tokens/primitives only (new raw hex fails review); 4-way QA (dark/light × EN/AR) + 390px mobile; no functional regressions — existing tests stay green; commit per page with before/after screenshots in the message.

## 8. Relationship to SPRINT-PLAN v4
This design plan REPLACES Sprint 1 and the visual half of Sprints 2–6 in SPRINT-PLAN v4. Recommended interleave: Day 0 (deploy/test fixes) → D0–D3 (the POS is the product) → Sprint 0 sync trust → D4–D9 alongside Sprints 2–6 functional work. Hardware (Sprint 3) and money correctness (Sprint 2 fixes) remain functional tracks untouched by this plan.

# TITAN POS — Premium Visual Direction

Date: 2026-07-09
Author: Fable (design direction sprint — no implementation)
Baseline: the shipped Midnight Gold token system (`apps/desktop/src/index.css`), audited live against the running app. This document finalizes and extends it into the definitive visual identity.

Verified correction: there is **no mojibake** in the product. Source and rendered UI are proper UTF-8 (grep-verified across `apps/desktop/src`; em-dashes and middots render correctly in the live app). Any encoding workstream should be deleted from other plans.

---

## 1. Visual Identity — "Midnight Gold"

### Brand feeling
A bank vault with the lights dimmed: **calm, dense, precise, quietly expensive**. TITAN should feel like professional equipment — closer to a Bloomberg terminal crossed with a luxury watch face than to a consumer app. The customer-facing surfaces (ordering page, receipts) carry the same identity so the shop looks like one brand from shelf to phone.

Three words that gate every decision: **Calm. Loud money. One accent.**

- *Calm*: surfaces recede; nothing decorates itself.
- *Loud money*: numbers — totals, change, debt, profit — are always the loudest elements on screen.
- *One accent*: gold marks exactly one primary action or brand moment per zone. If two things are gold, one of them is wrong.

### Color system (final)

**Dark (primary theme — the brand default):**

| Role | Value | Use |
|---|---|---|
| Canvas | `#0B0E14` | App background |
| Surface | `#12161F` | Cards, panels |
| Surface-2 | `#171C27` | Inputs, raised chips |
| Surface-3 | `#1E2430` | Menus, hover-raised |
| Hairline | `rgba(148,163,184,0.10)` | Default borders |
| Hairline-strong | `rgba(148,163,184,0.18)` | Interactive borders |
| Text | `#F4F6FA` | Primary |
| Text-2 | `#9AA4B8` | Secondary |
| Text-3 | `#5F6B80` | Muted/labels |
| **Gold (brand)** | `#D4A843` | THE accent |
| Gold hover | `#E4BC5C` | |
| Gold soft | `rgba(212,168,67,0.12)` | Fills, active washes |
| Gold contrast | `#2C1F05` | Text ON gold — never white |

**Light (derived, never designed separately):** warm paper `#FAF8F4`, white cards, deep gold `#9C6F14` (hover `#7E5A10`), warm borders `#E8E4DC`, ink text `#1C1917`. Light mode is "the same room with the lights on" — same geometry, same hierarchy, warmer neutrals. It must never look like a different product.

**Sidebar: stays dark in BOTH modes.** It is the brand anchor — the black/graphite rail with the gold active bar is TITAN's silhouette. This is already true in the code (`--sidebar-*` tokens are theme-invariant) and must stay a rule, not an accident.

### Gold usage rules (the discipline that makes it premium)

Gold MAY be used for:
1. The single primary action per zone (Complete Sale, Save batch, Close Today, Unlock).
2. Active/selected state washes (active nav item, selected row, active category chip) — always the *soft* 12% wash + solid bar/underline, never solid fill.
3. Brand moments: logo, PIN-lock focus glow, the total's rule line, focus rings.
4. The grand total's underline/rule — but the total's *digits* are white. Money is white; gold frames it.

Gold must NEVER be used for:
1. **Money digits.** Amounts are `#F4F6FA` (or semantic green/red). Gold digits read as decoration and cheapen both the gold and the number.
2. Success/positive semantics. Gold ≠ good. Green is good.
3. More than one solid-gold element per visible zone.
4. Body text, icons at rest, table headers, borders of non-interactive elements.
5. Warnings. Gold and amber-warning are dangerously close — warning uses `#FBBF24` and always pairs with an icon + label so hue alone never carries meaning.

### Semantic rules
- Success `#34D399` — money received, balanced drawer, synced, in-stock dot. Text-on-soft: `#86EFAC`.
- Danger `#F87171` — debt, shortage, out-of-stock, failed sync, destructive actions. Text-on-soft: `#FECACA`.
- Warning `#FBBF24` — low stock, stale rate, pending states. Always icon + label, never hue alone.
- Info `#60A5FA` — neutral system notices only. Rare by design.
- Data-viz ramps (payment methods, category accents, debt aging) are the only sanctioned non-semantic colors: muted, ≤60% saturation, defined once in `lib/paymentColors.ts` / the accent map — never inline.

---

## 2. Design System Direction

### Typography
- Family: **Inter** (UI); pair with **IBM Plex Sans Arabic** for AR — test money+Arabic side by side before locking.
- Scale (already tokenized, final): 11 caption · 12 meta · 13 body · 15 subhead · 18 h3 · 22 page · 24 stat · 28 display · **40 total** (POS grand total only; one 40px element per screen, ever).
- **All money is `font-variant-numeric: tabular-nums`, weight 600–700, never wraps, LTR even in RTL.** This is non-negotiable and is the single strongest premium signal in the product.
- Weights: 400/500/600/700. Never 800+ except the logo block.
- Line-height 1.45 text, 1.1 numerals. Letter-spacing −0.02em on display numerals, +0.06em on uppercase micro-labels.

### Spacing, radius, borders
- 4px grid. Component padding 12/16/20; page gutter 24 (16 mobile). Section rhythm: 20px between cards.
- Radius: 6 inputs-sm · 8 controls · 12 cards/buttons-lg · 16 modals · 999 pills. Never mix radii inside one component.
- Borders: 1px hairline alpha only. No 2px borders except the daily-close "sealed" stamp and focus rings. Separation comes from surface steps, not lines: prefer surface-2 on surface over border-on-surface.

### Elevation & the "lit edge"
- e1 cards `0 1px 2px rgba(0,0,0,.4)` · e2 hover/popover `0 10px 28px rgba(0,0,0,.38)` · e3 modals `0 18px 44px rgba(0,0,0,.44)`.
- Raised dark surfaces get a 1px inner top hairline `rgba(255,255,255,0.04)` — the "lit edge". This is the detail people can't name but feel.
- One ambient: the POS canvas top radial gold glow at 5% alpha (shipped). No other ambient effects. Ambience is a spice, not a sauce.

### Icons
- Lucide, 1.75px stroke, sizes 13/15/17 inline · 20 zone anchors. Icons never carry color at rest (text-3); color only with state. No filled icons except the favorite star when active.

### Motion
- 80ms micro (press) · 140ms buttons · 200ms panels/drawers · 320ms overlays. Easing `cubic-bezier(0.2, 0.8, 0.3, 1)`.
- Every button: `scale(0.97)` press. Every money value: 200ms tick (slide-up 6px + fade) on change.
- Signature moments (keep, never add more): sale-complete pulse rings + cart→check morph; wrong-PIN shake; camera scan line sweep; sale chime/scan blip/error buzz audio.
- `prefers-reduced-motion` collapses everything to instant (shipped).

### States
- **Loading**: skeletons matching real geometry, 1.4s shimmer. Spinners only for indeterminate network waits inside buttons. Never a blank screen.
- **Empty**: icon in a dashed 2px rounded square, one bold line, one muted line, one action. Same silhouette everywhere.
- **Error**: danger-soft fill + 1px danger border + icon + message + retry. Inline under the field for forms; toast only for async surprises.
- **Success**: green is enough; confetti exists only once, at first-run onboarding completion.

### Tables
- Header: 11px/700 uppercase +0.14em tracking, text-3, surface-2 row, 1px bottom hairline.
- Rows: 40px comfortable / 36px dense (owner screens get a density toggle eventually). Hover surface-hover; selected = gold-soft wash + 3px inset gold start-bar (shipped pattern — the only sanctioned selection style).
- Money columns right-aligned tabular; status as chips; actions as 36px icon buttons revealed at rest (POS is not a hover-only environment).

### Cards, modals, drawers
- Card: surface, hairline, r12, e1, lit edge; hover e2 only when clickable.
- Modal: 520px default, r16, e3, header 15px/700 + close, footer right-aligned actions, overlay `rgba(9,12,24,0.55)` + 4px blur. One modal max; nested confirmation replaces content, never stacks.
- Drawer: right side (start side in RTL), 420–480px, full-height, same header anatomy. **Rule: editing an entity = drawer; creating from scratch or confirming danger = modal; reviewing = drawer.** Bottom sheet at <640px.

### POS-specific components (the differentiators)
- **MoneyText** — single money renderer (shipped): tabular, dual-currency stack (USD primary / LBP 55% size secondary), tick animation, profit/debt tones.
- **Numpad** — 56px keys, r12, tabular digits (shipped in PIN lock; extend to tender + qty).
- **Quick-cash chips** — banknote denominations that ADD (shipped).
- **Scan hero** — the focused-glow command bar (shipped).
- **StatusBadge/chips** — one chip family for sale/sync/delivery/stock states.

---

## 3. The Five Screens

### A. POS Cashier Screen (`/`)
**Hierarchy (loudest→quietest):** grand total → scan bar → product tiles → cart lines → category chips → widgets/status.

**Layout (three zones, zero navigation during a sale):**
- Top strip (44px): shift dot + number, date · right: sync chip, notifications, user+role, AR/theme/lock. Graphite, hairline bottom.
- Left work area (~56%): scan hero (60px, gold focus glow, `/` hint) → category chips row → favorites pills → product grid (tiles 150–170px min, virtualized at >200 products).
- Right cart rail (~44%, surface on `#0E1219` wash): sale # chip + held-sale pills → cart lines → note → payment segmented row → tender zone → **total block** (gold rule, 40px white digits, LBP under) → gold Complete Sale (56px).

**Above the fold: everything.** The POS never scrolls except inside the cart-lines list and product grid. That is the whole layout contract.

**Dense:** cart lines, widgets. **Large:** total, Complete Sale, scan bar, change due. **Drawer/modal:** refunds, held-sale recall shelf, receipt preview, variant picker. **Remove:** any stock text on healthy tiles (shipped), decorative dots (shipped), the version string from the topbar (move to Settings › About).

**Premium feel:** the scan glow, the total's tick, silence of healthy tiles. **Operational feel:** quick-cash chips, big change display, keyboard hint bar.

### B. Payment / Tender
**One tender engine, two skins.** CartPanel (full POS) and QuickPOS rail must consume the same tender component; only density differs. Add **Card to QuickPOS** — all four methods everywhere, always in the same order: Cash · Card · Wallet · Debt.

- Method row: 4 equal segments, 48px (56px QuickPOS). Active = solid gold + `#2C1F05` text; inactive = surface-2 + hairline. Never colored per method — method colors live only in charts.
- Cash: USD/LBP inputs (22px tabular) with Exact buttons → quick-cash chip grid → **change panel**: success-soft card, "CHANGE" micro-label, 36–44px green digits, LBP under. Still-due mirrors in danger. Pure-LBP change computes in LBP (shipped fix — protect it with the existing tests).
- Debt: customer select → balance / after-sale / limit rows; over-limit = danger border + Complete Sale disabled with explicit reason text (never a silently dead button).
- Confirm review (QuickPOS): keep — Esc/Enter footer, items, total, change. It is the best moment in the product.
- Rename "Clean" → **"Clear sale"** with eraser icon everywhere.

### C. Products + Inventory (`/products`)
Keep the tabbed workspace (Catalog · Categories · Alerts · Stock control · Batches · Add product) but visually promote **Catalog** to 90% of the experience; other tabs are tools.

- KPI strip: 4 StatCards (products, units, stock value, reorder-needed — last one danger-tinted when >0).
- Catalog table (shipped direction is final): avatar/gold-initial, name, category, supplier, barcodes, price, cost, **margin % color-coded**, stock, status chip, actions. Below-cost margin in red is a merchandising radar — this is the screen's premium story.
- Edit in a right drawer (not modal): overview / pricing / barcodes / variants / lots / history sections.
- Batches tab: FEFO order, expiry countdown chips (green >30d, amber ≤30d, red ≤7d/expired).
- Remove from view: image-generation and bulk tools live behind a "⋯ Tools" menu, not the toolbar.

### D. Owner Dashboard (`/dashboard`)
The owner's 60-second morning read, in reading order:
1. Range control (Today/7d/Month — gold active pill) top-right.
2. Four StatCards: Net revenue · Operating profit · Outstanding debt (danger digits) · Stock value. Delta chips vs previous period.
3. **Revenue trend** (gold bars, today bright/past 45% alpha — shipped fix) beside **Action queue**: low stock, stale rate, unsynced ops, overdue debt as actionable rows with buttons, ordered by money-at-risk. The queue is the dashboard's soul; if it's empty show "All clear" in success tone — that state is the product's promise.
4. Payment mix + top products (shared ramp) + recent-sales ticker.

**Dense:** queue, ticker. **Large:** the four KPIs. **Remove:** nothing — this screen is already correct; it needs data-state polish (empty ranges, single-sale days), not redesign.

### E. Customer Debt / Profile (`/customers`)
- KPI strip: customers · outstanding (danger) · credit sales · collected (success).
- **Aging bar**: four bands 0-30 gold-soft / 31-60 amber / 61-90 orange / 90+ red — the page's signature element; clicking a band filters the ledger.
- Ledger table: avatar, name + overdue chip ("32d overdue" danger), contact, debt/paid/balance (MoneyText, balance dual-currency), last activity, actions (WhatsApp reminder = the one gold-tinted icon).
- Right rail: selected customer statement — balance header, timeline (sales +, payments −, refund credits), promise-to-pay note field, credit-limit progress bar (fills toward danger).
- "+ Add customer" is a gold button, never a tab (shipped rule: **tabs are places, buttons are actions** — applies platform-wide).

---

## 4. The POS Cashier Concept (definitive)

**The contract: a cashier who has never seen TITAN completes a cash sale in under 20 seconds without training, and a cashier in hour 7 makes zero extra eye movements.**

- **Scanner/search bar**: always focused; focus glow = "TITAN is listening". Refocus after every action, tap, and modal close. Error states escalate INTO the bar: unknown barcode turns the bar's border danger + buzz (status text alone is too quiet — this is the one audit point to adopt).
- **Category/favorites**: one chip row, gold-soft active; favorites as pinned first "category". Never two rows of navigation.
- **Product tiles**: image/initial 32px, name 12px/700, price 16px tight tabular + LBP 10px muted. Stock silent when healthy, "N left" amber when low, red when out (40% opacity tile). Tap = whole tile, ring-burst + blip. Qty badge = gold circle.
- **Cart rail**: lines dense (name · qty stepper · line total), swipe/✕ remove. Empty state: dashed cart icon + "Scan to start".
- **Payment area**: as §B. One glance answers: how much, how paid, how much back.
- **Change due**: the second-loudest number on screen. Green, 36px+, LBP under, spring-scale on change. Still-due mirrors in red.
- **Held sales**: pill-tabs above cart ("H1 · 3 items · $12.40"); recall shelf as drawer. Holding must feel free, not like filing.
- **Customer debt**: chip next to sale # when a customer is attached (name + balance, amber when near limit).
- **Offline/sync**: one topbar chip — synced (green dot) / syncing (spin) / N pending (amber) / offline (red, "sales saved locally" tooltip). Never more than a chip: offline is normal in Lebanon, not an alarm.
- **Shift/register**: topbar-left dot+number. No shift = amber "No shift" chip; opening drawer actions live in the Cash Drawer widget.
- **Last sale / receipt**: banner under scan bar for 30s after each sale (sale # · total · Print · WhatsApp · New Sale) — then dissolves. Never blocks the next scan.

---

## 5. Component Specs

Conventions: dark values; light derives by token. All interactive minimum touch target 44×44 even when visually smaller (extend hit area). All components: visible `:focus-visible` 2px gold ring, offset 2.

| Component | Size / padding | Type | Colors & states |
|---|---|---|---|
| **Product card** | min 150w, p10, r12 | name 12/700, price 16/700 tab, LBP 10/500 | surface + hairline; hover lift −1px + e2 + gold-soft border; press 0.97; added: gold ring-burst 300ms; out: 40% opacity, no pointer. A11y: single button role, label "name, price, stock state" |
| **Cart item** | row 44h, px12 | name 13/700, qty 15/700 tab, total 13/700 tab | hairline bottom; qty steppers 40×40 r8 surface-2 (POS: 24px allowed w/ extended hit; QuickPOS: 40px visual); remove ✕ text-3→danger on hover. A11y: steppers labeled "increase/decrease name" |
| **Payment method tile** | equal-width, 48h (56 QuickPOS), r10 | 12/700 + 15px icon | inactive surface-2+hairline+text-2; active solid gold + `#2C1F05`; press 0.94. Role radiogroup |
| **Scanner input** | 60h, r16, icon zone 56w | input 17/700, placeholder 15/500 | idle surface+hairline; focus gold border + 3px gold-soft ring + 32px bloom; error state: danger border + buzz; `/` kbd chip when empty. A11y: label "Scan barcode or search" |
| **Quick cash chip** | min 44h, px10, r8 | 13/700 tab | surface-2 + strong hairline; press 0.95; disabled 30%. Adds to tender (never replaces). Label e.g. "$5" / "250k LL" |
| **Customer debt chip** | 24h pill, px9 | 11/700 | neutral: surface-2/text-2; near-limit: warning-soft/warning-text + icon; over: danger-soft/danger-text |
| **Sync status chip** | 28h pill, px10 | 11/700 + 6px dot | synced success-soft/dot; syncing text-2 + spinning icon; pending warning-soft + count; offline danger-soft. Click = sync panel. `aria-live="polite"` |
| **Stock status badge** | 22h pill, px9 | 11/700 | Active chip-success · Low chip-warning · Out chip-danger. Icon optional; never hue-only in AR/low-vision contexts (text always present) |
| **KPI card** | p16, r12 | label 12/600 text-3; value 24/700 tab; delta chip 11 | surface+hairline+lit edge; delta ▲ success / ▼ danger; optional sparkline slot; clickable = card-hover only then |
| **Action queue item** | row 52h, p12, r10 | title 13/700, sub 11 text-3 | left 3px severity bar (danger/warning); surface-2; right: 32h action button; hover raises. A11y: list items, button labeled with action+object |
| **Table row** | 40h (36 dense) | body 13; money right tab | hover surface-hover; selected gold-soft + 3px inset gold start bar; row focusable, Enter = open |
| **Modal** | 520w max-95vw, r16, e3 | header 15/700 | overlay `rgba(9,12,24,.55)` + blur 4; pop-in 200ms; focus trap, Esc closes, initial focus first field. Danger modals: danger icon + red confirm |
| **Drawer** | 420–480w, full-h | header as modal | slide 200ms from end side (RTL-aware); scroll body, sticky footer; <640px = bottom sheet 90vh |
| **Toast** | max 380w, p12–16, r8, e2 | 13/600 | 3px start-bar semantic; POS routes bottom-center, owner routes top-end; auto-dismiss 4s, hover pauses; `role="status"` |
| **Empty state** | icon 64 sq dashed r16 | title 13/700, sub 11 text-3 | one action button max; identical silhouette app-wide |
| **Buttons** | sm 32 / md 40 / lg 46 / xl 52–56; px 10–22; r8 (r12 ≥lg) | 12–15/700 | primary: gold + `#2C1F05`, hover gold-hover, glow shadow; default: surface + strong hairline; ghost: transparent→surface-hover; danger: danger-soft→solid on hover; success: mirror danger. Disabled 45%, no transforms. Loading: inline spinner replaces icon, label stays |

---

## 6. Competitor Benchmark (visual lessons only)

| Competitor | Copy | Avoid |
|---|---|---|
| **Square** | Ruthless tender-flow reduction; number-first payment screen; the "one giant amount" discipline | Sterile white sameness — TITAN's dark identity is a differentiator, keep it |
| **Toast** | Status color rigor under restaurant pressure; big touch targets everywhere; offline treated as normal | Visual noise on the order grid; cramped modifier flows |
| **Lightspeed** | Inventory depth presented as clean tables + drawers; matrix/variant UX | Enterprise-gray blandness; settings sprawl |
| **Shopify POS** | Component-system consistency (Polaris) — one chip/card/toast everywhere; smart-grid tiles | Over-abstraction that slows cashiers (menus inside menus for basic tender) |
| **Clover** | App-launcher simplicity for small merchants; approachable empty states | Toy-like roundness/color that undercuts trust for money screens |
| **Odoo POS** | Honest density for operators; keyboard-first affordances | Utilitarian visual debt — proof that features without design language reads cheap |
| **Oracle MICROS** | 8-hour ergonomics: huge tender keys, fixed zones, zero-scroll layout contracts | 2005 aesthetics; training-required UI |
| **NCR** | Hardware-integrated reliability cues (drawer/printer state always visible) | Legacy chrome and modal mazes |

**Where TITAN can beat all of them:** (1) dual-currency USD/LBP as a first-class, beautiful object — none of them render two currencies with this care; (2) offline/sync as a calm chip instead of an error state; (3) the dark-gold identity — every competitor is white/gray/blue; a Lebanese shop running TITAN looks *chosen*, not defaulted; (4) WhatsApp-native receipts/reminders as visible, branded actions.

---

## 7. Implementation Direction For OpenCode

Behavioral ground rules for ALL phases:
- **No behavior changes** to: money math (`lib/currency.ts` incl. `computeCashChange` + its 5 tests), sync queue, PIN/security flows, sale recording, stock decrement logic.
- Tokens/primitives only — any new raw hex outside `index.css` / `paymentColors.ts` / the category accent map fails review.
- Commit file-by-file (two agents share this tree). Run `npx tsc --noEmit` + `npx vitest run` (62+ tests) before every commit.
- 4-way manual QA per phase: dark/light × EN/AR at 1366×768 and 390px.

### Phase 1 — Visual foundation (0.5–1 day)
1. Add Card to `QuickPOSMode.tsx` `PAY_OPTIONS` (order: Cash · Card · Wallet · Debt).
2. Rename "Clean" → "Clear sale" (i18n key, EN+AR) in `SearchToolbar.tsx` / POS actions.
3. Scanner error escalation: unknown-barcode/out-of-stock sets a transient `error` visual state on the scan bar (danger border, 1.2s) in `SearchToolbar.tsx` + `POSPage.tsx` (`quickAddProduct` failure paths — buzz already wired).
4. Move `v1.0.x` version chip out of `Topbar.tsx` (Settings › About later; just remove from topbar now).
5. Extend 44px hit-areas: POS cart steppers + any icon button <32px get `::after` hit extension or size bump.
Manual test: cash sale end-to-end, error scan, AR layout, light theme.

### Phase 2 — POS & tender unification (2–3 days)
1. Extract one `TenderPanel` component consumed by `CartBody.tsx` and `QuickPOSMode.tsx` (props: density "full" | "quick"). No logic change — lift existing props through.
2. Last-sale banner: unify `LastSaleBanner` into main POS (under scan bar, 30s auto-dissolve).
3. Held sales: pill-tab treatment above cart; recall shelf as drawer (`HeldSale` service untouched).
4. Toast routing: bottom-center on `/` and QuickPOS, top-end elsewhere (`Toast.tsx`).
Manual test: all four payment methods in both modes, mixed tender, change display, hold/recall, refund untouched.

### Phase 3 — Inventory / Customers / Dashboard polish (2–3 days)
1. Products: edit modal → right drawer (`ProductsPage.tsx` edit block); move Generate Images + Bulk Edit under a "⋯ Tools" menu; Batches tab expiry countdown chips.
2. Customers: aging bands clickable → filter ledger; promise-to-pay note field in the rail (extend customer `notes`, no schema change); credit-limit progress bar.
3. Dashboard: action-queue rows get inline action buttons + money-at-risk sort; "All clear" success empty state.
4. Monolith relief (opportunistic only): extract drawer/panels touched above into components; do NOT restructure whole pages in this phase.
Files: `ProductsPage.tsx`, `CustomersPage.tsx`, `DashboardPage.tsx`, `AlertsPanel.tsx`, new `components/ui/Drawer.tsx`.
Manual test: product edit round-trip, customer payment + statement, dashboard ranges incl. empty days.

### Explicitly rejected (do not implement)
- Mojibake/encoding cleanup — false positive; nothing to fix.
- Sidebar regroup to "Sell/Stock/Online" — current Register/Finance/Inventory/Operations/System stays; Finance must remain a first-class group.
- Any gold recolor of money digits, semantic states, or per-method payment colors.

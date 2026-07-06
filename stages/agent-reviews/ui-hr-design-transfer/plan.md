# Design Transfer Plan â€” Titan HR â†’ Lebanon POS

**Status:** Design extraction complete. Awaiting implementation approval.
**Date:** 2026-07-06
**Reviewers:** POS team, Design lead

---

## 1. Titan HR Design DNA

### Color System
Titan HR uses a **violet-primary** palette engineered for data-dense operational apps:

| Layer | Light | Dark | Purpose |
|-------|-------|------|---------|
| Page | `#f7f7fb` | `#0d0e17` | Background canvas |
| Surface | `#ffffff` | `#161824` | Cards, modals, panels |
| Surface-2 | `#fafafd` | `#111320` | Secondary surfaces |
| Field | `#fbfbfd` | `#111320` | Input backgrounds |
| Border | `#e7e8f0` | `#262941` | Card borders |
| Field-border | `#d9dae8` | `#2c3050` | Input borders |
| Hairline | `#f2f2f8` | `#1a1d30` | Table row dividers |
| Text | `#17171f` | `#eceef7` | Primary text |
| Text-2 | `#5f6175` | `#9ba0ba` | Secondary/labels |
| Text-3 | `#7b7d93` | `#626683` | Tertiary/muted |
| **Accent** | `#5b45d4` | `#8f79ff` | Primary violet |
| Accent-2 | `#4a35bb` | `#7c63f2` | Hover/darker |
| Accent-weak | `#efecfe` | `rgba(143,121,255,0.15)` | Tint backgrounds |

**Status layer** (6-role semantic system):
| Role | Light FG | Light BG | Usage |
|------|----------|----------|-------|
| Success | `#16a34a` | `#eafbf1` | Active, completed, positive |
| Warning | `#b45309` | `#fff4df` | Pending, due soon |
| Danger | `#dc2626` | `#feecec` | Error, cancelled, overdue |
| Info | `#0e7aa5` | `#eaf7ff` | Submitted, posted |
| Neutral | `#64748b` | `transparent` | Inactive, draft |
| Strong | `var(--text)` | `rgba(148,163,184,0.20)` | Locked, permanent |

### Typography
- **Display font**: Sora (headings, stats)
- **Body font**: Inter (text, tables, forms)
- **Arabic font**: IBM Plex Sans Arabic (RTL)
- **Base size**: `13px` (compact operational density)
- **Scale**: 8 sizes from `11px` caption to `28px` display hero
- **Weights**: 400 (body) / 500 (subtle) / 600 (labels/buttons/active) / 700 (titles/stats) / 800 (KPI values)

### Spacing
- **Grid**: 4px base Ã— 10 stops (2px â†’ 48px)
- **Field padding**: `10px 14px`
- **Content padding**: `24px` (desktop), `16px` (tablet), `12px` (phone)
- **Table density**: 44px rows (normal) / 36px rows (dense)
- **Card padding**: `16px` default, `15pxâ€“16px` for dashboard KPI tiles

### Elevation (Shadow Scale)
| Level | Light | Dark | Usage |
|-------|-------|------|-------|
| Elev-0 | `none` | `none` | Flat, inline |
| Elev-1 | `0 1px 2px rgba(13,40,90,0.06)` | `0 1px 2px rgba(2,6,20,0.5)` | Resting cards |
| Elev-2 | `0 2px 8px rgba(23,22,46,0.07)` | `0 12px 32px rgba(0,0,0,0.5)` | Modals, raised cards |

### Radii
- **6px**: Inputs, controls, chips, skeletons
- **12px**: Cards, panels, modals
- **16px**: Large surfaces (dashboard KPI, hero)
- **999px**: Pills, badges, search bars, avatars

### Button System
- **6 variants**: primary, secondary, danger, ghost, success, icon
- **3 sizes**: sm (12px/6/12), md (13px/9/18), lg (15px/11/22)
- **Press effect**: `scale(0.975)` on `:active`
- **Transitions**: bg `0.16s`, color `0.16s`, border `0.16s`, shadow `0.16s`, transform `0.08s`
- **Icon buttons**: fixed `34px Ã— 34px`, small `28px Ã— 28px`

### Table System
- Uppercase headers: `11px / 700 / 0.5px letter-spacing`, color `text-2`
- Row height: `44px` (normal), `36px` (dense)
- Row hover: `background: var(--hover)` with `0.12s` transition
- Sortable headers: active = `var(--accent)`, sort indicators with opacity toggle
- Pagination: prev/next rounded controls, showing "{from}â€“{to} of {total}"
- Toolbar: pill search + per-page selector

### Modal System
- Overlay: `rgba(9,12,24,0.55)`, `z-index: 100`, `fade-in 0.16s`
- Card: `520px` max width, `elev-2` shadow, `pop-in 0.2s` animation
- Header: `14px 18px` padding, title `15px/700`
- Body: `18px` padding, scrollable
- Footer: `12px 18px` padding, right-aligned actions
- Focus trap for accessibility
- `prefers-reduced-motion` respected

### Navigation/Sidebar
- **Width**: `240px` expanded / `68px` collapsed, `width 0.2s` transition
- **Background**: `var(--sidebar)`, border: `1px solid var(--sidebar-border)`
- **Items**: padding `8px 12px`, margin `2px 12px`, radius `10px`
- **Active**: `var(--sidebar-active-bg)` background, `var(--sidebar-active-fg)` text
- **Hover (JS)**: `var(--sidebar-hover)`, transition `0.14s`
- **Collapsible groups**: chevron rotates `90deg`, children indented `24px` with left border
- **Mobile**: below `768px`, off-canvas drawer with overlay

### Form/Input System
- Base padding: `10px 14px`
- Border: `1px solid var(--field-border)`, radius `6px`
- Hover: border â†’ `var(--text-3)`
- Focus: border â†’ `var(--accent)`, ring: `0 0 0 3px var(--accent-weak)`
- Transitions: `border-color 0.15s, box-shadow 0.15s`
- Focus-visible: `2px solid var(--accent-2)`, offset `2px` (keyboard only)
- Labels: `12px / 600`, color `text-2`, `margin-bottom: 4px`

### Empty/Loading/Error States
- **Empty**: centered icon + title + description + optional action button, padded `52px`
- **Loading**: skeleton shimmer `1.4s` linear, gradient scan across `800px`
- **Error**: card with error icon + title + message + retry button
- **Dashboard empty**: dashed border `1.5px`, padding `48px 16px`
- **Table empty**: centered text `14px`, color `text-3`, padding `48px`

---

## 2. What POS Should Copy Directly

### âœ… Copy â€” Same Patterns, Different Accent Color

| Pattern | From HR | To POS | Reason |
|---------|---------|--------|--------|
| **Token architecture** | CSS custom properties in `:root` + `html.dark` | Exact same pattern | Already partially done |
| **Elevation scale** | `elev-0/1/2` | `elev-1/2/3/4` (POS has 4 tiers, keep 4) | Conceptual match |
| **Button system** | 6 variants + 3 sizes + press effect | Copy variant system, keep POS-specific sizes | Gold accent instead of violet |
| **Table system** | Uppercase headers, hover rows, sort indicators | Direct copy, add POS-specific density toggle | Universal pattern |
| **Input/select/textarea** | Hover + focus + ring pattern | Direct copy with brand color ring | Already close |
| **Modal structure** | Overlay + card + header/body/footer | Direct copy, add POS-specific back-button | Already close |
| **Card system** | `cardStyle` with hover elevation uplift | Direct copy, keep `.pos-` variants | Already close |
| **Status chips** | 6-role semantic system with dot indicators | Keep existing 6-chip system, add dots | Already close |
| **Skeleton loading** | Shimmer animation with token colors | Direct copy, keep POS shimmer | Already close |
| **Focus-visible** | `outline: 2px accent-2, offset 2px` | Direct copy | Already done |
| **Font family** | Inter (body), display-optimized | Copy Inter base, POS doesn't need Sora | Already Inter |
| **Spacing grid** | 4px base | Adopt as standard | Need to add |

### ðŸ”„ Adapt â€” Keep POS Brand, Adopt HR Patterns

| Pattern | HR Has | POS Should Have |
|---------|--------|-----------------|
| **Accent color** | Violet `#5b45d4` | Keep gold `#9C6F14` (brand identity) |
| **Typography scale** | 8 sizes, named tokens | Create matching scale with POS values |
| **Sidebar** | Light sidebar in light mode | Keep always-dark sidebar (POS tradition) |
| **Table row height** | 44px / 36px | Adopt 44px, no need for 36px (POS uses fewer columns) |
| **POS cart panel** | No equivalent | HR has no cart â€” POS keeps its custom cart with HR-quality tokens |

### âš ï¸ POS-Specific â€” DO NOT Change

| Area | Why Keep Different |
|------|--------------------|
| **POS checkout screen** | Product grid needs larger touch targets (62px tiles vs HR's 44px rows) |
| **Cart/basket panel** | No HR equivalent â€” complex payment flow needs its own design |
| **Barcode scanner UI** | Unique to POS, keep as-is |
| **Payment/tender inputs** | Complex dual-currency input (USD + LBP) â€” no HR equivalent |
| **Receipt print layout** | Print-only format â€” keep independent |
| **Quick-sale mode** | Fast-touch mode for high-volume â€” HR has nothing like this |

---

## 3. POS Design Target â€” Desired Feeling

**Premium, calm, commercial.** The POS should feel like a serious business tool, not a toy.

| Context | Feeling |
|---------|---------|
| **Login/setup** | Welcoming, professional, trust-inspiring |
| **POS checkout** | Fast, focused, impossible to mess up |
| **Dashboard** | At-a-glance metrics, calm color palette |
| **Products/Inventory** | Dense operational tables, like HR's employee list |
| **Customers** | Clean CRM-like list, like HR's people directory |
| **Reports** | Data-rich but not overwhelming |
| **Settings** | Organized, discoverable, form-native |
| **Admin portal** | Already close to HR style (navy/purple) |
| **Owner portal** | Clean card-based, like HR's admin pages |
| **Ordering (customer)** | Warm, inviting, simple â€” keep consumer-friendly |
| **Driver app** | Functional, fast, high-contrast â€” keep utilitarian |

---

## 4. Page-by-Page Application Plan

### POS-UI-SPRINT-1: Tokens + Primitives (Foundation)
**Risk: Low | Files: 2**

Bring the token system to Titan HR quality:
- Add `--fs-*` typography scale tokens (caption 11px â†’ display 28px)
- Add `--sp-*` spacing tokens (4px grid, 10 stops)
- Add `--z-*` z-index tokens (sidebar 50, topbar 30, modal 100, toast 9999)
- Add `--duration-*` animation tokens
- Standardize all shorthands (`--success` = `--st-ok`, etc.)
- Unify token naming between desktop/admin CSS files

### POS-UI-SPRINT-2: Shell + Nav + Login + Settings
**Risk: Low-Medium | Files: 5**

- **Sidebar**: Refine active states to use HR's exact hover/active bg pattern (already close)
- **Topbar**: Refine padding, search pill shape, user avatar to match HR
- **LoginScreen**: Redesign with HR's login page layout (centered card, brand glow, calm bg)
- **SettingsPage**: Adopt HR's settings layout (sticky sidebar nav + content panels)
- **Theme toggle**: Add system preference detection (`prefers-color-scheme`)

### POS-UI-SPRINT-3: Dashboard + Reports
**Risk: Low | Files: 4**

- **DashboardPage**: Redesign KPI cards to HR `StatCard` pattern (36px icon tile, CAP labels, trend arrow)
- **DashboardPage**: Widget board should use HR's card grid with hover lift
- **ReportsPage**: Already close â€” refine table headers, add HR-style empty states
- **ReportsPage**: X/Z report cards should use HR `ModuleTile` style

### POS-UI-SPRINT-4: Products + Inventory + Customers
**Risk: Medium | Files: 6**

- **ProductsPage**: Adopt HR's employee list layout â€” PageHeader + filter toolbar + DataTable
- **ProductsPage**: Product tiles should stay but get HR-quality hover/active tokens
- **InventoryPage**: Already close to HR's dense tables â€” refine headers + hover states
- **CustomersPage**: Adopt HR employee directory pattern â€” search + table + detail sidebar
- **SuppliersPage**: Same as customers â€” HR's data-table pattern

### POS-UI-SPRINT-5: Main POS Sales Screen
**Risk: High | Files: 8**

This is the hardest screen because it has no HR equivalent. Keep core functionality, apply HR tokens:
- **ProductGrid**: Touch targets stay 62px, but get HR-quality tokens (border, shadow, hover lift)
- **Search bar**: HR pill-search pattern with shift/brand color
- **DepartmentTabs**: HR underline-tab pattern (already close)
- **CartPanel**: Refine borders/spacing/tokens but keep the layout
- **Payment section**: Keep dual-currency inputs, apply HR input tokens
- **CartItemCard**: Already good, just refine padding/typography
- **Checkout button**: Keep prominent but use HR button tokens
- **SaleCompleteOverlay**: Keep personality, apply HR overlay tokens

### POS-UI-SPRINT-6: Receipts + Invoices + Print Views
**Risk: Low | Files: 3**

- Paper print layouts stay independent (physical receipt format)
- Screen receipt preview: HR card-based with clean typography
- Invoice list: HR DataTable pattern

### POS-UI-SPRINT-7: Final Visual QA
**Risk: Low | Files: All**

- Dark/light mode audit on every screen
- Mobile/tablet audit (375px, 768px, 1024px, 1440px)
- Keyboard navigation + focus states
- RTL layout verification
- Console error sweep
- Color contrast ratio check (WCAG AA)

---

## 5. Component Migration Plan

### Buttons
| Current | Target | Action |
|---------|--------|--------|
| `.btn-primary` CSS class | Same + HR press effect | Already done âœ… |
| `.btn-ghost` CSS class | Same + HR hover | Already done âœ… |
| `Button.tsx` React component | Keep but simplify variants to match CSS | Swap to use `.btn-*` classes |
| `.pos-command-button` | Keep CSS, apply HR token values | Minor polish |
| Icon buttons (inline) | HR `.t-btn--icon` pattern | Create `.btn-icon` CSS, adopt everywhere |

### Inputs
| Current | Target | Action |
|---------|--------|--------|
| Global `input` styles | Already close to HR | Minor spacing adjust |
| `.input` class | Already close | Unified focus ring |
| `.input-lg` | Keep for cart inputs | Fine as-is |

### Tables
| Current | Target | Action |
|---------|--------|--------|
| Global `table` styles | Already close | Add HR header pattern (CAPS + letter-spacing) |
| `.t-row` class | Already done âœ… | Fine |
| `ProductTable` component | HR DataTable pattern | Add toolbar + pagination if missing |

### Cards
| Current | Target | Action |
|---------|--------|--------|
| `.card` CSS class | Already done âœ… | Minor padding adjust |
| `.pos-product-tile` | HR hover lift pattern | Already done âœ… |
| `.pos-command-panel` | Keep unique POS pattern | Fine |

### Modals
| Current | Target | Action |
|---------|--------|--------|
| `.modal-overlay` / `.modal-card` | Already done âœ… | Fine |
| `ConfirmDialog` | HR ConfirmDialog | Add focus trap |

### Status Chips
| Current | Target | Action |
|---------|--------|--------|
| `.chip-*` classes | Already done âœ… | Add dot indicator |

### Tabs
| Current | Target | Action |
|---------|--------|--------|
| `WorkspaceTabs` underline style | Already done âœ… | Fine |

### Navigation
| Current | Target | Action |
|---------|--------|--------|
| `Sidebar` | Already close | Refine hover/active states |
| `BottomNav` (mobile) | Keep unique POS | Apply HR tokens |

### Product Tiles
| Current | Target | Action |
|---------|--------|--------|
| `.pos-product-tile` | Already done âœ… | Keep touch-optimized |

### Receipt/Payment Panels
| Current | Target | Action |
|---------|--------|--------|
| `.pos-cart-rail` | Keep unique POS pattern | Apply HR tokens |

---

## 6. Token Plan â€” Final State

### Color Tokens (Unchanged â€” Gold Brand)
The POS keeps its gold brand (`#9C6F14`). No change to brand color. The token system will use Titan HR's NAMING convention but POS's VALUES.

### Typography Scale (New Tokens)
```css
--fs-caption: 11px;   /* Table headers, field labels */
--fs-meta: 12px;       /* Secondary text, chip text */
--fs-body: 13px;       /* Table cells, default text */
--fs-subhead: 15px;    /* Card titles, modal titles */
--fs-h3: 18px;         /* Section headers */
--fs-page: 22px;       /* Page titles */
--fs-stat: 24px;       /* KPI numbers */
--fs-display: 28px;    /* Hero numbers */
```

### Spacing Scale (New Tokens)
```css
--sp-2: 2px; --sp-4: 4px; --sp-8: 8px; --sp-12: 12px;
--sp-16: 16px; --sp-20: 20px; --sp-24: 24px;
--sp-32: 32px; --sp-40: 40px; --sp-48: 48px;
```

### Radius Scale (Already Exists)
```css
--radius-sm: 6px;  /* Inputs, controls */
--radius: 8px;      /* General */
--radius-lg: 12px;  /* Cards, panels */
```

### Elevation Scale (Already Exists â€” Keep 4 Tiers)
```css
--elev-1: 0 1px 2px rgba(13,40,90,0.06);   /* Cards */
--elev-2: 0 4px 12px rgba(13,40,90,0.08);   /* Hover lift */
--elev-3: 0 8px 24px rgba(13,40,90,0.10);   /* Modals */
--elev-4: 0 16px 40px rgba(13,40,90,0.14);   /* Top-level */
```

### Z-Index Scale (New Tokens)
```css
--z-sidebar: 50;
--z-topbar: 30;
--z-overlay: 100;
--z-modal: 110;
--z-toast: 9999;
--z-tooltip: 1200;
```

### Dark Mode
Already complete (every token has light + dark pair). Keep as-is.

### Arabic / RTL
- `[dir="rtl"]` selectors for all layout components
- `text-start` / `text-end` instead of `text-left` / `text-right`
- `ms-*` / `me-*` instead of `ml-*` / `mr-*`
- Sidebar already RTL-capable
- Cart rail: flip to left side in RTL
- Toast: slide from left in RTL

---

## 7. Implementation Phasing

### POS-UI-1: Tokens + Primitives (Safe, no visual change)
**Duration: 30 min | Risk: Near-zero**
- Add typography scale, spacing scale, z-index tokens to `index.css`
- Add animation duration/easing tokens
- Regenerate with existing values intact
- Typecheck + build â€” should pass immediately

### POS-UI-2: Shell + Nav + Login + Settings (Safe, visual refresh)
**Duration: 45 min | Risk: Low**
- Refine sidebar hover/active states (HR pattern)
- Refine topbar (pill search, user avatar to HR spec)
- Redesign login screen (HR login page layout)
- Settings page: sticky sidebar nav pattern
- Add system-preference dark mode detection

### POS-UI-3: Dashboard + Reports (Safe, visual refresh)
**Duration: 30 min | Risk: Low**
- KPI cards: HR StatCard pattern with icon tiles
- Widget board: HR card grid with hover lift
- Reports: refine table headers, empty states

### POS-UI-4: Products + Inventory + Customers (Moderate risk)
**Duration: 60 min | Risk: Medium**
- Products: HR employee-list layout (PageHeader + filter + DataTable)
- Keep POS product tiles, but apply HR tokens
- Customers: HR employee directory pattern
- Suppliers: same DataTable pattern

### POS-UI-5: Main POS Sales Screen (Highest risk)
**Duration: 90 min | Risk: High**
- Apply HR tokens to ProductGrid (borders, shadows, hover)
- Refine search bar (HR pill pattern)
- DepartmentTabs refinement
- CartPanel: HR-quality borders/spacing
- Payment section: HR input tokens
- Checkout button: HR button tokens
- NO logic changes, NO layout restructuring

### POS-UI-6: Receipts + Invoices + Print Views (Safe)
**Duration: 20 min | Risk: Low**
- Screen receipt preview: HR card-based
- Print layouts: stay independent
- Invoice list: HR DataTable

### POS-UI-7: Final Visual QA (Validation only)
**Duration: 45 min | Risk: Low**
- Dark/light mode screenshot comparison
- Mobile audit (375px â†’ 1440px)
- Keyboard/focus audit
- RTL verification
- Color contrast check
- Console error sweep
- Typecheck + build across all 6 apps

---

## 8. Verification Plan

### Per Sprint
- [ ] `npx tsc --noEmit` across all 6 apps
- [ ] `npx vite build` for all Vite apps
- [ ] Screenshot comparison with Titan HR reference
- [ ] Dark/light mode visual check
- [ ] POS sales flow smoke test (add items â†’ checkout â†’ complete)
- [ ] Payment modal smoke test (cash + LBP + mixed)
- [ ] Console: zero errors

### Final QA
- [ ] All 6 apps typecheck clean
- [ ] All 6 apps build clean
- [ ] Railway deployment succeeds
- [ ] Mobile: 375px product grid touch targets â‰¥ 48px
- [ ] Tablet: 768px sidebar collapses correctly
- [ ] Desktop: 1440px all layouts fill correctly
- [ ] RTL: sidebar, tabs, tables flip correctly
- [ ] Keyboard: Tab, Enter, Escape work in modals
- [ ] Focus: focus-visible rings show only for keyboard

---

## 9. Open Questions / Risks

| Question | Recommendation |
|----------|---------------|
| Should HR and POS share a UI package? | **Not yet.** POS has gold brand, HR has violet. Different products. In the future, extract a `@titan/ui` design system package that supports theming. |
| Which POS screens need larger touch targets? | Checkout product grid (62px tiles), barcode scan button, payment buttons. Keep these larger than HR's 44px rows. |
| Should receipt/print keep their own style? | **Yes.** Print is a different medium. Receipt layout is fixed-width 80mm thermal. |
| Where should POS remain faster/more visual than HR? | POS checkout screen should be MORE visual than HR (product images, color accents, large price fonts). Back-office pages (products, reports, settings) should match HR's dense operational style. |
| Should dark sidebar always be dark? | **Yes.** Keep sidebar always-dark with gold accent. It's a POS brand tradition. |

---

## 10. Risk Summary

| Area | Risk | Mitigation |
|------|------|-----------|
| POS checkout screen | **High** â€” critical business path | Apply tokens only, no layout/logic changes |
| Token migration | **Low** â€” additive, not destructive | Add new tokens, keep existing values |
| Shell/sidebar | **Low** â€” already close to HR | Minor visual refinements only |
| Product grid | **Medium** â€” touch targets must stay large | Verify 62px minimum touch areas |
| RTL | **Medium** â€” incomplete in many components | Fix with `[dir="rtl"]` selectors + logical properties |
| Build pipeline | **Low** â€” typecheck + build catch errors | Run after every sprint |

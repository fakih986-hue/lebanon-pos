# POS-UX-FINAL-POLISH-1 — Commercial UI/UX Consistency Pass

UI/UX only. No stock/sync/tender/tax/refund/ledger/business-logic, calculation,
permission, or route changes. Dark-gold Titan direction and operational density
preserved.

---

## Phase 0 — Audit findings

The design system in `src/index.css` was already strong: full token set
(colors ×2 themes, typography scale, 4px spacing grid, z-index scale, duration/
easing tokens), `.btn` variants + sizes, `.icon-btn`, `.chip`, `.modal-*`,
`.toast`, `.skeleton`, `.input`, `.card`, `.t-row`; shared `Button`, `Drawer`,
`EmptyState`, `Skeleton`, `Spinner`, `StatCard`, `WorkspaceTabs`, `Toast`,
`ConfirmDialog` components. Modals, tabs, and destructive actions were audited
and found consistent (all modals use `.modal-overlay/.modal-card`, all tab strips
use `WorkspaceTabs`, no destructive action mis-styled, `window.confirm` is not
used anywhere — `ConfirmDialog` everywhere).

Real gaps found:
1. **Unsized buttons (biggest defect).** `.btn` declared no default
   height/padding — only the size variants did. ~15 buttons across the newest
   flows (First-setup wizard/import/scan, Bulk import, Quick create, Receive
   empty-states) used `btn btn-primary` with no size class and rendered with no
   height/padding at all.
2. **Empty states** in Suppliers (3×), Dashboard (2×), Customers (1×),
   Products→Categories (1×) were bare grey text with no icon/guidance.
3. **A11y gaps:** LoginScreen's two modal close buttons and the Products sort
   toggle were icon-only with no `aria-label`.
4. **One-off button styling:** Drivers "Edit" used raw zinc utilities.
5. `Spinner` used hard-coded emerald utility classes (remapped by CSS, but not
   token-native) and had no `role="status"`.
6. `.icon-btn` had no disabled state.

## UI rules (confirmed/established)

| Element | Rule |
|---|---|
| Primary button | `btn btn-primary` — gold fill, `--brand-contrast` text; **default 40px / 0 14px / 13px** (new), sizes `btn-sm` 32px · `btn-md` 40px · `btn-lg` 46px · `btn-xl` 52px |
| Secondary button | `btn btn-default` (surface + border); `btn-ghost` for tertiary |
| Danger button | `btn btn-danger` — danger-soft fill, fills solid danger on hover; destructive confirms via `ConfirmDialog` with typed/explicit language |
| Icon button | `.icon-btn` 32px square, `aria-label` required, hover fill, active scale 0.93, **disabled 0.45 opacity** (new) |
| Tabs | `WorkspaceTabs` — 40px row, brand text + inset 2px brand underline when active, `aria-pressed`, count pills |
| Card | `.card` — surface, 1px border, `--radius-lg` (12px), `--elev-1`, hover elev-2 only where clickable |
| Modal | `.modal-overlay` (fade 160ms) + `.modal-card` (pop-in 200ms `--ease-ui`), bordered header w/ title 15px + `.icon-btn` close |
| Drawer | `Drawer` component, 200ms `--dur-drawer` |
| Empty state | Full-panel: `EmptyState` (dashed border, icon chip, title, hint, optional action). Inline/dense: icon 22–26px `--text-3` + bold 13px `--text-2` title + 12px `--text-3` hint |
| Animation | `--dur-btn` 140ms, `--dur-modal` 200ms, `--ease-ui cubic-bezier(0.2,0.8,0.3,1)`; `prefers-reduced-motion` respected globally |
| Density | 4px spacing grid; page title 22px, section 15–16px, body 13px, meta 12px, caption 11px; tables stay dense — no marketing whitespace |

---

## Phase 1 — Global polish implemented

- **`index.css`: default button sizing** for `.btn/.btn-default/.btn-primary/
  .btn-ghost/.btn-danger/.btn-success` (40px / 0 14px / 13px) placed in
  `@layer components` so it is overridden by BOTH the unlayered size variants
  and Tailwind `h-*`/`p*-*` utilities (which live in the `utilities` layer).
  This one rule fixed every unsized button in the app with zero risk to the
  ~200 explicitly-sized ones (verified: unlayered custom CSS beats Tailwind's
  layered utilities, so a plain `.btn { height }` would have broken `h-7`/`h-9`
  buttons — the layer placement is the safe mechanism).
- **`index.css`: `.icon-btn` disabled state** (0.45 opacity, not-allowed) and
  hover/active gated on `:not(:disabled)`.
- **`Spinner`**: token-native (brand-soft ring, brand top, brand-text label) +
  `role="status"` / `aria-label`.

## Phase 2 — Screen polish implemented

| Screen | Change |
|---|---|
| Login | Connect-store + PIN-change modal close buttons → `.icon-btn` + `aria-label` |
| Products | Sort-direction toggle → dynamic `aria-label`/`title` ("Sort ascending/descending"); Categories tab empty state → icon + title + hint |
| Suppliers | 3 empty states (suppliers table, purchase orders, activity) → icon + title + guidance hint |
| Dashboard | Payment-mix + Recent-sales "No sales yet" → title + guidance hint (icon on recent sales) |
| Customers | "No customers found" → added guidance hint line |
| Drivers | Edit button: raw zinc utilities → `btn btn-default btn-sm` |
| First setup / Bulk import / Quick create / Receive | All previously-unsized buttons now render at standard 40px via the global default (no per-file edits needed) |

## Before / after behavior

- Purely visual/a11y: unsized buttons now have standard height/padding; empty
  panels explain what will appear and how to get there; icon-only controls are
  screen-reader labelled; disabled icon buttons look disabled. No workflow,
  handler, calculation, or route changed. All edits are JSX/class-level; the
  changed-file set contains **zero** service/logic files:
  `index.css`, `ui/Spinner.tsx`, `LoginScreen.tsx`, `CustomersPage.tsx`,
  `DashboardPage.tsx`, `DriversPage.tsx`, `ProductsPage.tsx`,
  `SuppliersPage.tsx`.

## Verification

- Desktop typecheck + build: `tsc -b && vite build` clean.
- Desktop tests: **235 passed** (16 files) — includes the first-setup
  acceptance drill, so wizard/import/scan flows still behave identically.
- Visual smoke: not possible in this environment (preview server blocked by the
  running hub on port 3015); mitigated by the layer-placement analysis above and
  the fact that every edit is markup-local.
- No stock/sync/tender/refund/ledger files touched (git status verified).

## Deferred (risky / out of scope)

1. **POSPage mobile cart button** uses one-off inline sidebar-gradient styles —
   POS is the highest-risk surface and the button is functional and on-brand;
   left alone.
2. **Migrating inline empty states to the `EmptyState` component** — the shared
   component's dashed-border py-12 format is too heavy for dense list/table
   contexts; the compact icon+title+hint pattern was standardized instead.
3. **Sweeping the ~180 Tailwind-sized `h-7`/`h-9` buttons onto `btn-sm/md`** —
   large diff with zero behavior gain; the size tokens exist for new code.
4. Ordering/website apps — separate deploy pipelines, untouched per rules.

## Installer

Desktop-only cosmetic changes → needs an installer to reach hubs but does not
justify one alone; fold into the next release (1.0.41 or whenever the next
functional change ships). No server change → no Railway deploy.

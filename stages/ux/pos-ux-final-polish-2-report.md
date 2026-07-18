# POS-UX-FINAL-POLISH-2 — Live Visual Smoke & Screen-by-Screen Polish

UI/UX only. No stock/sync/tender/tax/refund/ledger/business-logic, calculation,
permission, or behavioral route changes. The real hub was never stopped.

---

## How the live smoke ran

The Claude preview harness refuses to start while the Titan hub app is running
("hub-already-running"), and no Chrome extension was connected. Workaround that
respected "do not stop the real hub": the desktop SPA's vite dev server was run
on **port 5174** (background, no conflict with the hub) and driven by **headless
real Chrome via playwright-core** from a throwaway harness in `%TEMP%` (no repo
dependency changes, no browser download). A disposable logged-in owner + 3-product
demo store was seeded into the headless profile's localStorage — no live data
touched. Every screen was screenshotted at 1280×800, key screens at 375×812
(mobile) and in dark mode, with console errors captured and per-page horizontal
overflow measured.

Evidence: `stages/ux/pos-ux-final-polish-2-shots/` (8 representative shots);
full set generated in the temp harness.

## Screens checked (21 captures)

Login (fresh store) · Dashboard (+fresh-store prompt) · POS · Quick POS bar ·
Products · Stock & Batches (all 4 tabs incl. Opening inventory deep link) ·
Receive stock · First-setup wizard (welcome / import / scan) · Bulk import ·
Sales · Customers · Suppliers · Accounting · Staff · Delivery · Drivers ·
Settings (Business + Backup tabs) · Mobile: POS / Dashboard / Products /
Settings · Dark-mode Dashboard.

**Console errors across the entire walk: 0.**

## Defects found → fixed

| # | Defect (live finding) | Fix |
|---|---|---|
| 1 | **Mobile Products overflowed 569px horizontally.** Root cause: the Tailwind `sr-only` span inside the actions `<th>` is `position:absolute`; with no positioned ancestor it resolved against the document's initial containing block at x≈943 and widened `<html>` past the viewport — escaping the table's `overflow-x-auto` (clipping only applies between an element and its containing block). | `relative` on the `<th>` in `ProductTable.tsx`; same latent pattern fixed in `SuppliersPage.tsx` (Delete column th). Verified live: overflow 375px viewport → **0px** on both Products and Suppliers. |
| 2 | **Topbar showed "Point of Sale" on `/stock`** — the page-title map had no `/stock` entry and fell back to "/". | Added `/stock` to `Topbar.tsx` + `desktop.page.stock.title/subtitle` i18n keys (en + ar). Verified live: topbar now reads "Stock & Batches". |
| 3 | **Suppliers: the "Activity" tab was clipped underneath the "+ Add supplier" button** (tabs + button + 256px search couldn't fit one row; the strip silently cut off). | Tab row now wraps (`sm:flex-wrap`) with `min-w-0` on the tab strip — all 4 tabs fully visible, search drops to its own line. Verified live. |

## Verified good (no change needed)

- **Login/Unlock**: branded, clean numpad, clear primary Unlock button.
- **Dashboard**: KPI cards aligned; POLISH-1 empty-state hints render ("Payment
  mix appears after the first sale"); fresh-store setup prompt shows and
  dismisses.
- **POS**: scan bar focus ring, category tabs, product tiles, empty-cart state,
  hotkey footer; mobile POS has sticky Cart/Checkout and bottom nav, 0 overflow.
- **First-setup wizard**: welcome cards (disabled sample card reads clearly),
  import step, scan step — all buttons now standard 40px (POLISH-1 default
  sizing visibly working), disabled primary reads correctly.
- **Opening inventory tab**: `?view=Opening` deep link lands on the tab; summary
  cards, filters, Opening-only table, Export CSV.
- **Bulk import modal**: proper modal header/close, sized buttons.
- **Suppliers/Customers**: new icon+title+hint empty states render well.
- **Settings**: tabbed layout clean in Business/Backup; danger zone clearly
  danger-styled with typed confirmations.
- **Dark mode dashboard**: consistent (app's primary theme).
- Mobile overflow after fixes: POS 0 · Dashboard 0 · Products 0 · Settings 0 ·
  Suppliers 0.

## Files changed

- `apps/desktop/src/features/pos/components/ProductTable.tsx` — relative th (overflow fix)
- `apps/desktop/src/pages/suppliers/SuppliersPage.tsx` — relative th + tab-row wrap
- `apps/desktop/src/components/layout/Topbar.tsx` — `/stock` page title
- `packages/shared/src/i18n/en.ts`, `ar.ts` — stock title/subtitle keys
- `stages/ux/pos-ux-final-polish-2-shots/` — 8 evidence screenshots

Zero service/business-logic files touched.

## Verification

- Desktop `tsc -b && vite build`: clean.
- Desktop tests: **235 passed**.
- Live re-verification after each fix via the headless harness (overflow probes
  + re-screenshots).
- Dev server stopped after the run; hub untouched.

## Deferred visual issues (documented, not risky to ship as-is)

1. Mobile topbar "No shift · date" wraps to three cramped lines on 375px —
   cosmetic, low value vs. touching the shared Topbar layout.
2. Dashboard "Top products" empty state is a plain one-liner ("Sales will appear
   here") — consistent enough; left to avoid re-diffing the dashboard again.
3. POS mobile cart button one-off inline styles (carried from POLISH-1 deferral).
4. Settings Business tab renders single-column with an empty right half on wide
   screens — layout restructure is out of scope for a polish pass.

## Installer

Desktop-only cosmetic fixes (plus i18n keys). No server change → **no Railway
deploy**. Fold into the next installer (1.0.41) together with POLISH-1 and the
offline fresh-detection patch already awaiting a build.

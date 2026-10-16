# Titan POS — Design System v2 "Midnight Gold"

Canonical design system for the Titan POS desktop app (Electron + web), English and Arabic (RTL).
Source of truth for the redesign: every new screen and every migrated screen follows this file.
Derived from the current tokens in `apps/desktop/src/index.css` and the audit in `docs/design/EXPERIENCE-INVENTORY.md`.

---

## 1. Product context

**What it is.** An offline-first point of sale and back office for Lebanese retail: mini-markets, pharmacies, hardware stores and cafés, with one to five registers. It handles dual currency, USD and LBP, with cash rounded to the 5,000 LBP banknote. One store "hub" PC runs the local server. Other tills, phones and drivers connect to it or to the cloud.

**Who uses it**

| Role | Context | Primary jobs |
|---|---|---|
| Cashier | Standing, scanner in hand, queue waiting, often Arabic-first | Scan → see total in USD + LBP → take cash (often mixed) → give exact change → receipt. In under 20 s for a 10-item basket. |
| Manager | Between customers, at the counter | Refunds and voids, open/close shift, cash in/out, receive stock, fix a price |
| Owner | Back office or phone, end of day | Is money right? Is stock right? Close the day, see profit, debt, low stock, suppliers owed |

**Non-negotiables**

- **Money must be unmistakable.** Totals, change, LBP amounts and rounding are the most legible things on screen.
- **Offline is normal, not an error.** The UI must always say where work is: saved here, waiting, synced, or rejected.
- **Nothing a cashier does should be lost or silently undone.** Conflicts are shown and resolved, never hidden.
- **Arabic is a first-class language, not a translation layer.**

## 2. Information architecture (rethought)

Today there are 13 sidebar destinations in 5 groups, plus pages with their own H1, tabs labeled with translated strings, and shift controls in three places.

v2 groups everything by **job** into five workspaces. Each workspace has one page header and a consistent tab bar:

| Workspace | Contents | Who sees it |
|---|---|---|
| **Sell** | Register (POS); Receipts (history, refunds, voids); Held sales | Cashier+ |
| **Stock** | Products (catalog, variants, barcodes, images); Lots & counts (batches, expiry, adjust, count, reconciliation); Receiving (scan-in against supplier/PO); Suppliers (accounts, POs, payments) | Manager+, inventory.view for read |
| **Money** | Today (dashboard + close day); Shift & drawer (open/close, cash in/out, drop); Expenses; Customers & debt; Reports | Manager/Owner |
| **Delivery** | Orders board, drivers | delivery.manage |
| **Admin** | Team & permissions; Store settings; Devices & sync; Backup & recovery; About & updates | Owner |

**Shell rules**

- **Sidebar:** 64 px icon rail, expanding to 232 px. Workspaces only; sub-pages are tabs in the page header, not more sidebar items.
- **Topbar:** one per page. Left side: workspace › page title. Right side, in this order:
  1. **Status capsule** (§6)
  2. Shift chip
  3. Language
  4. Theme
  5. User
  6. Lock

  Pages never render their own H1.
- **Register mode:** POS runs full-bleed with no sidebar, in its own shell. A 48 px top strip holds the store, the register, the shift, the status capsule, the user, and an "Exit to back office" control. Cashier-only users never see the back office.
- **Shift lives in one place:** *Money › Shift & drawer*. Everywhere else only links to it, e.g. a "Shift closed — open shift" button in the Register.
- **Tabs carry stable values,** never translated labels.

## 3. Color

**Dark is the default theme; light is a full peer.** Gold is an **accent**, not a fill. Use it for:

- the single primary action on a screen (and the pay button);
- active navigation and selected controls (segmented control, filter chip);
- the focus ring.

Never use gold for large backgrounds, body text, status, charts or decorative icons. **Money is not gold:** it leads through size, weight and `--text` (≥ 7:1), so it never competes with the gold Pay button for meaning (Better Design reconciliation K1).

| Token | Dark | Light | Use |
|---|---|---|---|
| `--page-bg` | `#0B0E14` | `#F7F5F1` | App background |
| `--surface` | `#12161F` | `#FFFFFF` | Cards, panels, cart rail |
| `--surface-2` | `#171C27` | `#F6F4EF` | Inset rows, inputs, table headers |
| `--surface-3` | `#1E2430` | `#ECE8E1` | Pressed/selected, chips |
| `--border` | `rgba(148,163,184,.10)` | `#E8E4DC` | Default hairline |
| `--border-strong` | `rgba(148,163,184,.22)` | `#D3CCC0` | Dividers that matter, chip outlines |
| `--border-input` | `rgba(148,163,184,.60)` | `#857C70` | Input and segmented-control edges: ≥ 3:1 against the surface and the input fill |
| `--text` | `#F4F6FA` | `#1C1917` | Primary text, money |
| `--text-2` | `#9AA4B8` | `#57534E` | Secondary text |
| `--text-3` | `#7C879B` | `#635D55` | Meta, placeholders (never for values) — raised from `#5F6B80` / `#8C8578`, which measured ~3.3:1 |
| `--brand` | `#D4A843` | `#996d14` | Primary action, active nav, focus (light darkened 2% so white text passes 4.5:1) |
| `--brand-hover` | `#E4BC5C` | `#7E5A10` | |
| `--brand-soft` | `rgba(212,168,67,.12)` | `rgba(156,111,20,.10)` | Selected row, active tab background |
| `--brand-contrast` | `#2C1F05` | `#FFFFFF` | Text on gold (back-office primary) |
| `--pay-bg` / `--pay-text` | `#D4A843` / `#2C1F05` | `#D4A843` / `#2C1F05` | The pay button in both themes: 7.26:1, the same gold identity in light and dark |
| `--ok-money` | `#34D399` | `#0A5428` | Change due and other positive money on a success tint (≥ 7:1) |
| `--disabled-bg` / `--disabled-text` | `#1A2029` / `#7C879B` | `#ECE8E1` / `#635D55` | Disabled controls (no opacity fades) |
| `--chart-1…4`, `--chart-hi` | muted green / blue / violet / rose; `#C4CBD8` | darker equivalents; `#57534E` | Chart series (payment methods) and the highlighted bar. Never gold |

**Status colors** are semantic only. Each has `-soft` (tint background) and `-text` (readable on soft):

| Status | Dark | Light | Meaning |
|---|---|---|---|
| ok | `#34D399` | `#137639` | Synced, paid, in stock, balanced |
| warn | `#FB923C` | `#a44c09` | Pending, low stock, expiring, grace period, over/short. Dark warn moved from amber `#FBBF24` (43°) to orange so it no longer shares gold's hue (42°) |
| err | `#F87171` | `#b91c1c` | Rejected, failed, blocked, overdue, destructive |
| info | `#60A5FA` | `#0e6d93` | Neutral notices, updates available |

**Status color rules**

- "Pending" is **warn**, never err.
- Success green appears only for a positive confirmation, e.g. "Change $2.00" or "Synced". It is never decorative.
- Payment method colors (Cash, Card, Wallet, Debt) are muted chart colors, used only in charts and legends.

**Contrast:** body text ≥ 4.5:1, money ≥ 7:1, and non-text UI (input borders, selected-state edges, chart highlight) ≥ 3:1, in both themes. Verified by `docs/design/contrast-check.cjs` (32 pairs × 2 themes, including the 7:1 money pairs and the 3:1 UI pairs) and the rendered matrix in `docs/design/qa-prototypes.cjs`.

## 4. Typography

- **Latin:** Inter. **Arabic:** IBM Plex Sans Arabic.
  - Both are **bundled locally as woff2**, because the app must render offline.
  - Stack: `"Inter", "IBM Plex Sans Arabic", system-ui, sans-serif`.
  - Under `[dir=rtl]`, Plex Sans Arabic comes first.
- **Numerals:** money is always `font-variant-numeric: tabular-nums`, using Western digits in both languages (Lebanese retail convention). Currency symbols: `$` before the amount; `ل.ل` after the LBP amount in Arabic, `LBP` in English.
- **Scale:** seven steps only. The 21 arbitrary sizes in use today are retired.

| Token | Size / line height | Weight | Use |
|---|---|---|---|
| `--fs-caption` | 12 / 16 | 500 | Meta, table headers, badges |
| `--fs-body` | 14 / 20 | 400–500 | Body, inputs, rows |
| `--fs-subhead` | 16 / 24 | 600 | Card titles, list item titles |
| `--fs-title` | 20 / 28 | 600 | Page title (topbar), modal title |
| `--fs-stat` | 28 / 34 | 600 | KPI values |
| `--fs-total` | 44 / 48 | 700 | POS total due, change due |
| `--fs-hero` | 64 / 68 | 700 | Customer-facing amount (review/complete) |

**Minimum readable size: 12 px** (bottom-nav labels and keyboard hints included). **Nothing in the register is smaller than 14 px**, including subtotal, VAT, unit prices and the rounding caption. Sizes are written in rem in code (14 px = 0.875rem) so the reader's font setting is respected; the px values above are the defaults.

## 5. Space, shape, elevation, motion

- **Spacing:** 4 px grid. Allowed values: `4 8 12 16 20 24 32 40 48 64`. Card padding is 16, or 24 on wide back-office cards. Gaps between cards are 16.
- **Radius:**

  | Radius | Use |
  |---|---|
  | 6 | Chips, badges |
  | 8 | Inputs, buttons |
  | 12 | Cards, panels |
  | 16 | Modals, drawers, POS tiles |
  | 999 | Status capsule and pills only |

- **Elevation:** `--elev-1` cards, `--elev-2` popovers, `--elev-3` drawers, `--elev-4` modals. In dark mode elevation also adds a 1 px inset top highlight (`rgba(255,255,255,.04)`), not a heavier shadow.
- **Layering (single z-scale):** content 0 · sticky 30 · sidebar 50 · popover 80 · drawer 100 · modal 110 · toast 120 · full-screen register overlays 200, *with their dialogs at 210*. Dialogs always render above whatever opened them.
- **Motion:**
  - Durations: 140 ms for buttons and fields, 200 ms for drawers and modals; easing `cubic-bezier(.2,.8,.2,1)`.
  - Money changes "tick" (200 ms number roll) only on the total.
  - No motion longer than 300 ms on the cashier path. The 2.8 s unlock intro is removed from the cashier path and kept for first launch only.
  - Motion is opted in, not out: transitions live inside `@media (prefers-reduced-motion: no-preference)`.

## 6. System states: one model, everywhere

Every screen expresses the store's state through the same three surfaces:

1. **Status capsule** (topbar / register strip). Always visible; shows the single highest-priority state. Clicking it opens the **Sync & status sheet**: the queue by state, the last error, the actions, and the rejected items.
2. **Inline banner** (page top, below the header). Appears only for states that block or change what the user can do on that page.
3. **Inline row state.** A badge on the specific receipt, product, lot or operation.

**Priority order** (the capsule shows the first that applies):

| # | State | Capsule | Tone | Banner? | Behavior |
|---|---|---|---|---|---|
| 1 | **License blocked / read-only** | "Read-only. Contact support" | err | Yes, every page | Writes disabled with an explanation, reading/export allowed |
| 2 | **Money conflict** (server rejected an offline refund/void) | "2 refunds need review" | err | Yes on Sell & Money | Never hidden; manager settles (loss / recovered + note) |
| 3 | **Other rejected operations** | "3 changes rejected" | err | Settings › Devices & sync | Review, retry or discard (discard never offered for money items) |
| 4 | **Recovery in progress** (restoring, connecting a new device, interrupted refunds completed) | "Restoring…" / "Recovered 1 refund" | info | Yes while running | Progress, then a one-time summary |
| 5 | **Offline** | "Offline: saved on this device" | warn | Register strip only | Selling continues; nothing blocks |
| 6 | **Pending** | "12 waiting to sync" | warn | No | Counts only |
| 7 | **License grace** | "Licence: 4 days left" | warn | Owner pages | Countdown, renew CTA |
| 8 | **No open shift** | (shift chip, not capsule) "Shift closed" | warn | Register: yes, with **Open shift** | Blocks checkout and refunds with one clear action |
| 9 | **All good** | "Synced 2 min ago" | ok (dot only) | No | Quiet |

**Permission denied.** Controls the user lacks are **visible but disabled**, with a lock glyph and a visible reason linked by `aria-describedby`: "Needs the Refunds permission. Ask a manager." Where a manager may approve on the spot, offer "Manager approves with PIN". A blocked page shows a centered panel: what this page is, which permission it needs, and a **Switch user** button (opens the PIN pad). Navigation hides only whole workspaces the user can never use.

**Empty / loading / error.**

- **Empty:** one `EmptyState` (icon, title, one sentence, one action) everywhere.
- **Loading:** skeletons shaped like the content. A spinner is used only for actions taking longer than 400 ms.
- **Errors:** errors say what happened and what to do next, with the technical code in a secondary line.

## 7. Components (canonical set)

Every pattern below has **one** implementation; the duplicates found in the audit are retired.

- **Button:** primary (gold fill, `--brand-contrast` text), secondary (surface-2 + border), ghost, danger (err), and **pay** (POS only, 64 px tall, full width, `--pay-bg`/`--pay-text` in both themes, shows the exact amount the customer pays: "Pay $21.81 · 1,955,000 LBP"). Heights: 32 (dense back office, pointer pages only), 40 (default), 48 (touch, and **every** control in the register and its strip), 64 (pay). Every button has a visible focus ring (2 px `--brand`, 2 px offset). Disabled uses `--disabled-*` tokens, never opacity.
- **Input:** 40 px (48 in POS) with a `--border-input` edge and the label above. Help or error text sits below the field, never as a placeholder; errors set `aria-invalid` and `aria-describedby`.
- **Money input:** `dir="ltr"` in both languages, `inputmode="decimal"`, value aligned to the inline end, tabular. The currency is a separate adornment, never part of the value: `$` before, `LBP` / `ل.ل` after.
- **Money:** `<Money usd lbp? rounding? tone?>`. The USD line comes first. **When tender is cash and rounding applies, the LBP line shows the payable amount** ("1,955,000 LBP cash"), and the caption directly under it says what it was rounded from ("Rounded up from 1,952,000 (nearest 5,000 note)"). Change is always computed from the line the customer sees. The same rule applies to the pay button, the mobile pay bar and the review overlay.
- **SegmentedControl:** native `<input type="radio">` inside `<label>`, in a `role="radiogroup"` with an accessible name, so arrow keys move and select. Selected = `--brand-soft` fill + 2 px gold bottom edge + a check glyph (not a lighter surface alone). Used for tender, payment source, connection mode, role and date range.
- **FilterChip:** a `<button aria-pressed>` chip, neutral when off, gold tint + gold border when on. Status tone appears only in the count badge ("Low stock **23**").
- **Stat tile:** label (caption), value (stat), delta chip, and one optional footnote. Used for every KPI row. It replaces the five-plus current implementations.
- **Card / Panel:** a surface with radius 12, a 1 px border and elev-1. Panel header: title (subhead) plus a right-aligned action. No nested cards deeper than two levels.
- **Table:** 44 px rows (36 dense), a sticky surface-2 header, right-aligned numbers, row hover `--surface-hover`, selected row `--brand-soft` with a 2 px inline-start gold bar. Bulk actions appear in a bar replacing the header.
- **Tabs:** links (`<a href="?tab=value">`, `aria-current="page"`) in an underline tab bar in the page header, 2 px gold indicator, optional count badge. Stable values, so a tab is linkable and survives reload.
- **Drawer:** inline-end side (mirrors in RTL), 480 px (640 for editors), header / scroll body / sticky footer. Used for edit forms.
- **Modal:** centered, max 560 px, for confirmations and short decisions only. Destructive confirms name the object and the consequence: "Void S-1042 · $24.50 returns to the customer". When an entered amount exceeds what is allowed, the dialog says by how much and offers the allowed amount as a button ("Record $412.00 instead").
- **Badge / Pill:** caption text, `-soft` background and `-text` color. Status meaning is also carried by an icon **and** a word: "6 · Low", "0 · Out".
- **StatusBanner, StatusCapsule:** see §6.
- **PIN pad:** 3×4 grid, 72 px keys, masked dots, shake on error, lockout countdown text.
- **Toast:** bottom-center in the register, top inline-end elsewhere; 4 s; max 2 visible. Never the only place an error is shown.

## 8. Screen patterns

### Register (POS): the most important screen

The register is two columns: the **scan and product column** (about 62%) and the **cart rail** (about 38%, min 400 px).

**Scan and product column**

- The scan field is always focused; focus returns after every action.
- The scan feedback line sits under the field. Success shows the item and the new total; an unknown barcode offers "Add product"; insufficient stock says which lot is short.
- Below are department chips and a product grid with 132 px tiles: name, price, and a stock dot only when low.

**Cart rail, top to bottom**

1. Customer chip (walk-in by default).
2. Lines: name, qty stepper, line total. Discount and override are revealed per line.
3. Totals block: subtotal, discount, VAT, then **total due** at 44 px with USD + LBP.
4. Tender: Cash / Card / Wallet / Debt SegmentedControl (F2–F5). Cash shows USD and LBP money inputs, exact-amount buttons (48 px) and a live **change due** in `--ok-money`.
5. The pay button.

**Review overlay.** A customer-facing summary of total, paid and change at hero size. One key confirms: Enter confirms, Esc goes back.

**Keyboard.** Enter on an empty scan field opens review; Enter in review confirms; F2 Cash (exact), F3 Card, F4 Wallet, F5 Debt; F8 hold; Esc back. Shortcuts are shown in a quiet strip. Only the scan field shows focus while the cashier scans.

**Below 900 px.** The cart and tender open as a bottom sheet from the fixed pay bar, which shows the line count ("4 lines") next to the pay button.

**Quick mode.** The same register with the grid hidden (scan-only); it is not a separate implementation.

### Back office

- **Every page has the same anatomy:** page header (title, tabs, primary action), an optional inline banner, then content.
- **List pages:** filters row, table, details drawer.
- **Lists on phones (< 768 px) are chosen per task, never forced:** cards when each row is one decision (receipts, customers, team, drivers); column prioritization when people scan and compare (products, suppliers, reconciliation: low-priority columns drop out); horizontal scrolling only for data-entry grids (receiving).
- **Dashboards:** the KPI tile row, then two columns: a trend chart, and an action queue sorted by money at risk. Every delta says what it compares with ("+12% vs yesterday"); the chart's text alternative is derived from its data.
- **One primary per view.** A drawer's own primary is allowed only when the page header has none. While a blocking state exists (e.g. a money conflict before closing the day), the action that resolves it is the primary and the blocked action is disabled with its reason.
- **Fixable form errors don't disable Save.** Save stays enabled; pressing it moves focus to the first problem. Disabling is reserved for what the user cannot fix here: permission, licence, no open shift (Better Design reconciliation K5).

### Lots

- A lot is shown as **"Lot A · received 12 Mar · exp 30 Apr · 6 of 10 left"**.
- The expiry chip is ok above 30 days, warn at 30 days or less, and err at 7 days or less or once expired.
- A product row shows its lots stacked in the details drawer, ordered first-expiry-first.

## 9. Arabic / RTL

- Everything mirrors through logical properties (`margin-inline-start`, `inset-inline-end`); physical left/right is forbidden. Icons with direction (arrows, chevrons, back) mirror; icons without direction (search, settings, currency) do not.
- Numbers, barcodes, SKUs and phone numbers stay LTR inside RTL text (`unicode-bidi: isolate`).
- Arabic line height runs about 10% taller (`[dir=rtl] { line-height: calc(1.1 * …) }`). Do not uppercase or letter-space Arabic.
- Printed receipts carry `dir`/`lang`, a bilingual store header, and amounts in both currencies.

## 10. Accessibility

- Touch targets are ≥ 44 px, and ≥ 48 px in the register.
- Focus is always visible. Every shell page starts with a **Skip to content** link.
- Every icon-only button has an `aria-label`.
- Status changes are announced via `aria-live="polite"`; money conflicts and blocks via `assertive`.
- No information is carried by color alone.

## 11. Do / don't

| Do | Don't |
|---|---|
| Use one gold primary action per view | Use gold for backgrounds, borders everywhere, or body text |
| Show USD and LBP together wherever money is shown to a customer | Show a rate-converted LBP for a historical refund without saying which rate |
| Say where the work is (saved here / waiting / synced / rejected) | Use red for "pending", or hide rejected items behind "Clear stuck" |
| Disable a forbidden action with a reason | Remove it silently, or let it fail on click |
| Use the token scale | Use raw hex, raw Tailwind palette classes, or arbitrary px sizes |
| Write "Offline: saved on this device", "Read-only. Contact support" | Use em dashes in UI copy, either language |
| Spell an acronym out once ("Purchase order PO-118", "Supplier invoice no.") | Use engineering words on owner screens (queue, pull, lease, LAN) |

## 12. Better Design reconciliation (2026-10-16)

The system above was reviewed with the **Better Design** MCP server (`marvkr/better-design`, server 0.44.0): its review rules, its UI principles (hierarchy, color, typography, spacing, accessibility, depth), its UX principles (navigation, forms, microcopy, errors, onboarding) and `check-comprehension` on screens 01–09. Its findings are folded into the sections above; this table records where Better Design and Midnight Gold disagreed and which way the one canonical system went.

| # | Better Design says | Midnight Gold said | Canonical decision |
|---|---|---|---|
| K1 | One action color, used only for actions | Gold also for key money figures | **Better Design.** Gold = actions, selection, focus. Money leads by size and `--text` |
| K2 | oklch colors, rem sizes | hex, px | **Hex kept** (brand source of truth, no user-facing gain). **rem adopted** in code, same values |
| K3 | Don't default to Inter | Inter + IBM Plex Sans Arabic | **Kept**, as Better Design allows when the system names it; both bundled offline |
| K4 | No em dashes in UI copy | Capsule strings used em dashes | **Better Design**, both languages |
| K5 | Don't pre-disable submit | Disable a forbidden action with a reason | **Both, scoped:** disable only what can't be fixed here; fixable validation keeps Save enabled |
| K6 | 4.5:1 floor | Money 7:1 | **Midnight Gold's stricter rule**, now actually tested |
| K7 | ~60 words and ≤ 3 actions per screen | Dense register and back office | **Documented exception** for trained repeat users; still spell acronyms once, use plain words, keep one primary |
| K8 | Prefer shadows over borders in light mode | Border + elev-1 cards | **Kept**; inputs need visible borders anyway |

Not done with Better Design (and why): `inspect-spacing` and `check-comprehension` on screens 10–17 could not run because the anonymous key's free quota ran out (HTTP 402); `finalize-dashboard-review` needs a public deploy, which is not authorised. See `DESIGN-REVIEW.md`.

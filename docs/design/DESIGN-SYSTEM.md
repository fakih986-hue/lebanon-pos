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

- the single primary action on a screen;
- active navigation;
- the focus ring;
- key money figures.

Never use gold for large backgrounds or for body text.

| Token | Dark | Light | Use |
|---|---|---|---|
| `--page-bg` | `#0B0E14` | `#F7F5F1` | App background |
| `--surface` | `#12161F` | `#FFFFFF` | Cards, panels, cart rail |
| `--surface-2` | `#171C27` | `#F6F4EF` | Inset rows, inputs, table headers |
| `--surface-3` | `#1E2430` | `#ECE8E1` | Pressed/selected, chips |
| `--border` | `rgba(148,163,184,.10)` | `#E8E4DC` | Default hairline |
| `--border-strong` | `rgba(148,163,184,.18)` | `#D9D3C8` | Inputs, dividers that matter |
| `--text` | `#F4F6FA` | `#1C1917` | Primary text, money |
| `--text-2` | `#9AA4B8` | `#57534E` | Secondary text |
| `--text-3` | `#5F6B80` | `#8C8578` | Meta, placeholders (never for values) |
| `--brand` | `#D4A843` | `#9C6F14` | Primary action, active nav, focus |
| `--brand-hover` | `#E4BC5C` | `#7E5A10` | |
| `--brand-soft` | `rgba(212,168,67,.12)` | `rgba(156,111,20,.10)` | Selected row, active tab background |
| `--brand-contrast` | `#2C1F05` | `#FFFFFF` | Text on gold |

**Status colors** are semantic only. Each has `-soft` (tint background) and `-text` (readable on soft):

| Status | Dark | Light | Meaning |
|---|---|---|---|
| ok | `#34D399` | `#16a34a` | Synced, paid, in stock, balanced |
| warn | `#FBBF24` | `#b45309` | Pending, low stock, expiring, grace period, over/short |
| err | `#F87171` | `#dc2626` | Rejected, failed, blocked, overdue, destructive |
| info | `#60A5FA` | `#0e7aa5` | Neutral notices, updates available |

**Status color rules**

- "Pending" is **warn**, never err.
- Success green appears only for a positive confirmation, e.g. "Change $2.00" or "Synced". It is never decorative.
- Payment method colors (Cash, Card, Wallet, Debt) are muted chart colors, used only in charts and legends.

**Contrast:** body text ≥ 4.5:1 and money ≥ 7:1 against its surface, in both themes.

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

**Minimum readable size: 12 px.** Nothing in the POS is smaller than 14 px.

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
  - Respect `prefers-reduced-motion`.

## 6. System states — one model, everywhere

Every screen expresses the store's state through the same three surfaces:

1. **Status capsule** (topbar / register strip). Always visible; shows the single highest-priority state. Clicking it opens the **Sync & status sheet**: the queue by state, the last error, the actions, and the rejected items.
2. **Inline banner** (page top, below the header). Appears only for states that block or change what the user can do on that page.
3. **Inline row state.** A badge on the specific receipt, product, lot or operation.

**Priority order** (the capsule shows the first that applies):

| # | State | Capsule | Tone | Banner? | Behavior |
|---|---|---|---|---|---|
| 1 | **License blocked / read-only** | "Read-only — contact support" | err | Yes, every page | Writes disabled with an explanation, reading/export allowed |
| 2 | **Money conflict** (server rejected an offline refund/void) | "2 refunds need review" | err | Yes on Sell & Money | Never hidden; manager settles (loss / recovered + note) |
| 3 | **Other rejected operations** | "3 changes rejected" | err | Settings › Devices & sync | Review, retry or discard (discard never offered for money items) |
| 4 | **Recovery in progress** (restoring, connecting a new device, interrupted refunds completed) | "Restoring…" / "Recovered 1 refund" | info | Yes while running | Progress, then a one-time summary |
| 5 | **Offline** | "Offline — saved on this device" | warn | Register strip only | Selling continues; nothing blocks |
| 6 | **Pending** | "12 waiting to sync" | warn | No | Counts only |
| 7 | **License grace** | "Licence: 4 days left" | warn | Owner pages | Countdown, renew CTA |
| 8 | **No open shift** | (shift chip, not capsule) "Shift closed" | warn | Register: yes, with **Open shift** | Blocks checkout and refunds with one clear action |
| 9 | **All good** | "Synced 2 min ago" | ok (dot only) | No | Quiet |

**Permission denied.** Controls the user lacks are **visible but disabled**, with a lock glyph and the tooltip "Needs: Refunds (ask a manager)". A blocked page shows a centered panel: what this page is, which permission it needs, and a **Switch user** button (opens the PIN pad). Navigation hides only whole workspaces the user can never use.

**Empty / loading / error.**

- **Empty:** one `EmptyState` (icon, title, one sentence, one action) everywhere.
- **Loading:** skeletons shaped like the content. A spinner is used only for actions taking longer than 400 ms.
- **Errors:** errors say what happened and what to do next, with the technical code in a secondary line.

## 7. Components (canonical set)

Every pattern below has **one** implementation; the duplicates found in the audit are retired.

- **Button:** primary (gold fill, `--brand-contrast` text), secondary (surface-2 + border), ghost, danger (err), and **pay** (POS only, 64 px tall, full width, shows the exact amount: "Pay $24.50 · 2,195,000 LBP"). Heights: 32 (dense back office), 40 (default), 48 (touch), 64 (pay). Every button has a visible focus ring (2 px `--brand`, 2 px offset).
- **Input:** 40 px (48 in POS) with label above. Help or error text sits below the field, never as a placeholder. Money inputs are right-aligned (left-aligned in RTL) and tabular, with a currency adornment.
- **Money:** `<Money usd lbp? rounding? tone?>`. The USD line comes first; the LBP line sits below in `--text-2`. When cash rounding applies, a third caption reads "Cash payable rounded to 2,200,000 LBP".
- **Stat tile:** label (caption), value (stat), delta chip, and one optional footnote. Used for every KPI row. It replaces the five-plus current implementations.
- **Card / Panel:** a surface with radius 12, a 1 px border and elev-1. Panel header: title (subhead) plus a right-aligned action. No nested cards deeper than two levels.
- **Table:** 44 px rows (36 dense), a sticky surface-2 header, right-aligned numbers, row hover `--surface-hover`, selected row `--brand-soft` with a 2 px inline-start gold bar. Bulk actions appear in a bar replacing the header.
- **Tabs:** an underline tab bar in the page header, 2 px gold indicator, optional count badge. Stable values.
- **Drawer:** inline-end side (mirrors in RTL), 480 px (640 for editors), header / scroll body / sticky footer. Used for edit forms.
- **Modal:** centered, max 560 px, for confirmations and short decisions only. Destructive confirms name the object and the consequence: "Void S-1042 · $24.50 returns to the customer".
- **Badge / Pill:** caption text, `-soft` background and `-text` color. Status meaning must also be conveyed by an icon or a word, not color alone.
- **StatusBanner, StatusCapsule:** see §6.
- **PIN pad:** 3×4 grid, 72 px keys, masked dots, shake on error, lockout countdown text.
- **Toast:** bottom-center in the register, top inline-end elsewhere; 4 s; max 2 visible. Never the only place an error is shown.

## 8. Screen patterns

### Register (POS) — the most important screen

The register is two columns: the **scan and product column** (about 62%) and the **cart rail** (about 38%, min 400 px).

**Scan and product column**

- The scan field is always focused; focus returns after every action.
- The scan feedback line sits under the field. Success shows the item and the new total; an unknown barcode offers "Add product"; insufficient stock says which lot is short.
- Below are department chips and a product grid with 132 px tiles: name, price, and a stock dot only when low.

**Cart rail, top to bottom**

1. Customer chip (walk-in by default).
2. Lines: name, qty stepper, line total. Discount and override are revealed per line.
3. Totals block: subtotal, discount, VAT, then **total due** at 44 px with USD + LBP.
4. Tender: Cash / Card / Wallet / Debt segmented control. Cash shows USD and LBP inputs, exact-amount chips and a live **change due**.
5. The pay button.

**Review overlay.** A customer-facing summary of total, paid and change at hero size. One key confirms: Enter confirms, Esc goes back.

**Keyboard.** Enter on an empty scan field opens review; Enter in review confirms; F2 Cash exact; F8 hold; Esc back. Shortcuts are shown in a quiet strip.

**Quick mode.** The same register with the grid hidden (scan-only); it is not a separate implementation.

### Back office

- **Every page has the same anatomy:** page header (title, tabs, primary action), an optional inline banner, then content.
- **List pages:** filters row, table, details drawer.
- **Dashboards:** the KPI tile row, then two columns — a trend chart, and an action queue sorted by money at risk.

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
- Focus is always visible.
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

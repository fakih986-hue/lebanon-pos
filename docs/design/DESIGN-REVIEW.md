# Midnight Gold v2 — design review record

Round 3: 2026-10-16. Prototypes in `docs/design/prototypes/` (17 surfaces × EN/AR). Rendered QA in `docs/design/qa/`.

## Tools: what contributed, what was unavailable

| Tool | Status | Contribution |
|---|---|---|
| **Better Design** (`marvkr/better-design`, MCP server 0.44.0) | **Used in round 3**, through its MCP endpoint (verified: handshake, 42 tools). Skill installed in `.claude/skills/better-design`. **Quota now exhausted** (HTTP 402 after 25 free anonymous queries); a free account is needed to continue. Not yet loaded as native tools in this Claude Code session (see "Better Design integration" below) | Review rules, UI principles (hierarchy, color, typography, spacing, accessibility, depth), UX principles (navigation, forms, microcopy, errors, onboarding), `check-comprehension` on screens 01–09. Its findings drove round 3 (below) and §12 of the design system |
| Superdesign CLI 0.14 (skill 0.6.0) | Available. **Generation credits exhausted**; nothing purchased. | Repo init (`.superdesign/init/`), project + Brand Asset (logo), canvas hosting of hand-authored drafts via `import-design-draft` (no credits) |
| Hand authoring (Claude, `claude-opus-5-5`) | Used | All draft HTML, through `docs/design/build-prototypes.cjs` |
| Headless Chrome, network blocked | Used | 108 renders (9 screens × EN/AR × dark/light × 1440/1024/390) with screenshots; per-page self-check (overflow, broken images, loaded fonts, unnamed controls, rendered text contrast) |
| WCAG contrast calculator (`docs/design/contrast-check.cjs`) | Used | Every token pair in both themes, including tints over the page and over insets |
| Built-in browser pane | Used | Manual inspection of rendered screens |
| Local Tailwind compiler (`@tailwindcss/node` + oxide) | Used | Compiles exactly the utilities the prototypes use, so there is no CDN |
| `@fontsource/inter`, `@fontsource/ibm-plex-sans-arabic` (OFL-1.1) | Installed in `apps/desktop` | Bundled woff2 fonts (Latin + Arabic, 400–700) |
| `lucide-react` (already a dependency, ISC) | Used | Icons inlined as SVG, so there is no icon CDN |

## Better Design integration: exact state

| Step | State |
|---|---|
| Skill `better-design` | Installed (`npx skills add marvkr/better-design --skill better-design`), project copy in `.claude/skills/better-design` |
| Installer `npx better-design --project` | Ran. It did **not** configure Claude Code (no `claude` CLI on PATH). It wrote `opencode.json` (holds the agent key), `.codex/hooks.json`, `skills-lock.json` and a block in `AGENTS.md`. The first three are git-ignored |
| Claude Code MCP entry | Added as a git-ignored project `.mcp.json` (`better-design`, remote HTTP, same key). Verified from this machine with that exact entry: handshake OK, 42 tools, `check-comprehension` answered |
| Native tools in this session | **Not loaded.** Remaining step: restart Claude Code in this folder and approve the project MCP server `better-design` when prompted |
| Quota | **Exhausted** (HTTP 402 `AGENT_QUOTA_EXHAUSTED`). Remaining step: create a free Better Design account with the claim link saved in the git-ignored `.better-design-claim.local.txt`; the key and history carry over |
| Not run | `inspect-spacing` and `check-comprehension` for 10–17 (quota); `finalize-dashboard-review` (needs a public deploy, not authorised) |

**Not followed from the installer's AGENTS.md block:**
- **"Deploy dashboards to a public HTTPS preview".** Deployment is not authorised.
- **"Start UI builds with `find-design-system`".** The product keeps its own Midnight Gold system, and the block's own first rule says the same.

## Round 3: Better Design findings and what changed

| Severity | Finding (Better Design rule) | Change |
|---|---|---|
| Critical | Cash total shown two ways: 1,952,000 on the total and pay button, but change computed from 1,955,000 (`numbers-carry-a-reference`) | The LBP line, pay button, pay bar and review show the **payable** cash amount, with "Rounded up from 1,952,000" directly under it (01, 02, 08, 10, 17) |
| Critical | Tender and segmented selectors not keyboard-operable (`no-click-on-non-interactive`) | One SegmentedControl on native radios in a named radiogroup; F2–F5 for tender |
| Serious | Light money below the system's own 7:1 | Pay button uses the dark gold recipe in both themes (7.26:1); `--ok-money` light `#0A5428`; the checker now tests 7:1 money pairs |
| Serious | Input borders 1.6:1 (non-text 3:1) | `--border-input` (3.3 / 4.1:1) |
| Serious | Selected segment 1.06:1 | Gold tint + 2 px gold edge + check glyph |
| Serious | Gold and warning amber share a hue in dark mode | Dark `--warn` → `#FB923C` |
| Serious | Register controls 32–40 px | Every register and strip control ≥ 48 px |
| Serious | POS text under 14 px, including money | Register captions, labels and money lines at 14 px; key hints 12 px |
| Serious | Two primaries per view (03, 05) | 03 header action secondary; 05 "Review & settle" primary, "Close the day" disabled with "Settle 2 refunds first" |
| Serious | Stock badges color-only | "6 · Low" / "0 · Out" with icons |
| Serious | Tabs were not links | `<a href="?tab=…" aria-current>` |
| Serious | Arabic: the money input flipped ("20 $") | Money inputs `dir=ltr`, `inputmode=decimal`, end-aligned, separate currency adornment |
| Serious | Comprehension: acronyms, engineering words | "Supplier invoice no.", "Purchase order PO-118", "Changes waiting to send", "Last full download", "Other devices on this Wi-Fi"; the dense-screen exception is documented (DESIGN-SYSTEM §12 K7) |
| Moderate | Gold used for non-actions; Save pre-disabled; trends without a reference; underlined nav; two focus rings; em dashes; units; vague buttons; Arabic coinages; no skip link; mobile cart hidden | All addressed (chart tokens, Save enabled, "vs yesterday", one focus, no em dashes, "4 lines · 12 units", Retry/Discard split, Arabic copy, skip links, pay bar with cart button) |
| Found on visual review after the fixes | "Total due" wrapped; check glyph overflowed the tender cell; receipt-list LBP not the cash-payable value; Arabic PIN dots filled right-to-left | Fixed |

## Principles applied

The principles come from the design system (`DESIGN-SYSTEM.md`) and general accessibility and visual-design practice, applied directly rather than through a Better Design tool:

- **Hierarchy.** One gold primary action per view.
- **Money first.** The money figure is the largest element, always in USD and LBP, with tabular numerals.
- **System states.** One model, with a priority order: capsule, then banner, then row badge.
- **Accessibility.**
  - Touch targets ≥ 44 px, 48–72 px in the register.
  - Visible focus.
  - Labelled controls.
  - `role`/`aria` on dialogs, radiogroups, progress and live status.
  - No meaning carried by color alone.
- **RTL.**
  - Logical properties throughout.
  - Directional icons mirror; neutral ones don't.
  - Numbers isolated left-to-right.
  - Arabic line height +10%.
- **Responsive.**
  - Back office: sidebar (≥1200), then icon rail (768–1199), then bottom navigation (<768).
  - Register: two columns, then a stacked layout with a fixed pay bar (<900).
  - Tables scroll inside their card, never the page.

## Findings and fixes

| # | Finding | Evidence | Fix |
|---|---|---|---|
| 1 | Meta text (`--text-3`) failed AA in both themes (~3.3:1) | contrast-check | Dark `#5F6B80`→`#7C879B`; light `#8C8578`→`#635D55` |
| 2 | White text on light-theme gold button 4.47:1 | contrast-check + rendered check | Light `--brand` `#9C6F14`→`#996d14` |
| 3 | Light success / warning text on their tints < 4.5 on the page background | rendered check (4.31–4.49) | `--ok` →`#137639`, `--warn` →`#a44c09`; the checker now tests tints over page and inset |
| 4 | Register top strip is dark in both themes, but used light-theme status colors in light mode (3.45:1) | rendered check | The strip declares its own dark status tokens |
| 5 | Barcode meta on a selected (gold-tinted) table row 4.09:1 | rendered check | Secondary lines in table cells use `text-2` |
| 6 | Horizontal overflow on Receiving at 390 px | rendered check (`overflowBy` = an `sr-only` header) | Standard `sr-only` and `position:relative` on scroll containers; all 2- and 3-column form grids use `minmax(0,1fr)` |
| 7 | 2-column form grids could not shrink below input intrinsic width | code review + #6 | As #6 |
| 8 | Sidebar gradient made background detection read the page color | false positive in checker | Solid `background-color` fallback under the gradient (also correct CSS) |
| 9 | Change due in the first prototype was wrong (39,000 vs 35,000 LBP) | manual arithmetic check (round 1) | Corrected |
| 10 | A lots example contradicted first-expiry-first | manual review (round 1) | Corrected |
| 11 | **QA harness itself was wrong:** `--window-size` cannot go below Chrome's ~500 px minimum, so "phone" renders were laid out at 500 px and cropped | reported viewport `500x749` ≠ `390x844` | Harness rebuilt on DevTools-protocol device emulation; it now fails any render whose viewport differs |
| 12 | Simple POS kept a 420 px column on phones (inline style beat the media query) | real 390 px render, clipped total | Column width moved to a class the responsive rules override |
| 13 | "Simple mode" chip on the dark strip used light-theme gold (2.38:1) | rendered check | Strip declares dark brand tokens too |
| 14 | Amber badge on an amber-tinted row (4.46:1) | rendered check | Row marked with an amber edge instead of a second tint |

## Results

### Final matrix

- **204 / 204 renders clean.** 17 surfaces × EN/AR × dark/light × 1440×900 / 1024×768 / 390×844.
- **All exact viewports.**
- **Network blocked** for every render.

### What every render passed

- No horizontal overflow and no broken images.
- Inter loaded in 108/108 renders, and IBM Plex Sans Arabic in 54/54 Arabic renders. All fonts are local files.
- Icons render. They are inline SVG, and every render has at least 7.
- No unlabelled controls.
- No text below AA contrast, out of ~6,800 rendered text nodes checked.
- Arabic pages are `dir=rtl`.

### Token contrast

- All 32 pairs pass in both themes (`contrast.json`): AA text, tints over the page and over insets, **7:1 money**, and **3:1 non-text UI**.

### Negative control

- A deliberately broken page (2000 px element, unnamed button, faint text, missing image) was flagged in all 12 of its renders.
- Overflow, broken images and unlabelled controls were caught everywhere.
- Faint text was caught in dark theme. In light theme the same color is high contrast, so not flagging it is correct.

### Artifacts

- `qa/report.json`, the contact sheet `qa/index.html`, and the screenshots in `qa/shots/` (git-ignored; regenerate with `node docs/design/qa-prototypes.cjs`).

### Not covered by these checks

- The checks find defects, not design quality. They don't judge visual hierarchy, Arabic copy quality or interaction behavior. **They are not design approval**: that is yours, on the previews.
- Arabic copy was revised but has not had a native-speaker review.
- Screen-reader output itself was not tested; only accessible names were.
- Real devices were not tested.

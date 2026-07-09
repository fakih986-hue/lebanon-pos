# Agent Handoff Log - UI/HR Design Transfer Sprint

**Date:** 2026-07-06
**Phase:** Design extraction + planning (no implementation)
**Status:** Approved with corrections. Proceeding to POS-UI-1.

---

## 2026-07-09 — Fable — Sprint POS-UX-F1 (Premium Visual Foundation, Phase 1) — COMPLETE

- Card payment method now visible in BOTH QuickPOS (`QuickPOSMode.tsx`, grid-cols-4) and main POS (`CartBody.tsx`); active tile = gold `--brand` + `--brand-contrast` text + aria-pressed. Removed per-method emerald/violet/amber active classes (design law: no method colors in tender UI).
- Scan-bar error escalation: `scanError` transient state (1.2s) in POSPage flows to both scan bars — danger border + danger-soft ring on unknown barcode / out-of-stock / stock-cap. Pairs with existing error buzz.
- "Clean" → "Clear sale" (i18n values EN+AR); new `pos.pay` key; checkout button now "Pay $X" (Debt keeps "Record Debt — $X").
- Topbar version chip removed; cart steppers 28→36px w/ aria-labels; icon-only buttons (camera/clear/more) labeled.
- Verified live in browser: add-to-cart, qty +/-, Card select, cash change calc, Clear Sale confirm + cancel-preserves-cart, error flash rgb(248,113,113). tsc clean, 62/62 vitest.
- No behavior changes: money math / checkout / sync / stock untouched.
- Docs: fable-implementation-checklist.md Phase 1 marked complete.
- NEXT: Phase 2 (TenderPanel extraction) awaits approval. Note for OpenCode: pre-existing null-guard bug — failed unlock on empty user store throws at security.service.ts:627 recordAuditEvent (null.id); harmless but noisy, worth a guard.

## What Was Done

### 1. Titan HR Design System Extraction
- Read `globals.css` (441 lines) - all tokens, themes, animations
- Read `shared.tsx` - Card, PageHeader, StatusBadge, StatCard, Modal, ConfirmDialog, EmptyState, PageError, ModuleTile
- Read `forms.tsx` - Button, Input, Select, IconButton, SearchInput, DatePicker
- Read `dashboard-layout.tsx` - Full shell (sidebar, header, content, mobile)
- Read `data-table.tsx` - DataTable with search, sort, pagination, CSV
- Read `icons.tsx` - SVG icon system, skeleton loading
- Read `money.tsx` - Currency formatting
- Read `toast.tsx` - Toast notification system
- Read `dashboard/page.tsx` - Dashboard home with widget board
- Read `widgets.tsx` - Widget system (KPI, charts, work queue)
- Read `employees/page.tsx` (first 200 lines) - Employee list layout pattern
- Read `page.tsx` (login) - Login page layout

### 2. POS Design System Audit
- Read `apps/desktop/src/index.css` (full) - All tokens, overrides, component styles
- Read `apps/admin/src/index.css` (full) - Admin token system
- Read `apps/ordering/src/index.css` - Ordering overrides
- Read `apps/driver/src/index.css` - Driver overrides
- Read 15+ POS component files for pattern analysis
- Documented all hardcoded colors, token gaps, and inconsistencies

### 3. Deliverables Produced
- **`stages/agent-reviews/ui-hr-design-transfer/plan.md`** - Complete 10-section design transfer plan:
  1. Titan HR Design DNA (full token catalog)
  2. What to copy directly vs adapt vs keep POS-specific
  3. POS Design Target (desired feeling for each screen)
  4. Page-by-page application plan (7 sprints)
  5. Component migration plan (12 components)
  6. Token plan (final state for all scales)
  7. Implementation phasing (7 sprints, time estimates are rough/untrusted)
  8. Verification plan (per-sprint + final QA)
  9. Open questions / risks
  10. Risk summary

---

## Key Findings

### Gap Size
- **Small gap**: Token architecture, button system, table system, modal system, card system, chips - POS is already ~80% aligned with Titan HR design quality
- **Medium gap**: Typography scale (POS has no scale tokens), spacing tokens (uses raw Tailwind), focus-visible (recently added in previous work)
- **Large gap**: Component consistency across apps (4 separate CSS files), RTL support (partial), admin/ordering/driver token systems diverged

### What POS Already Has / Previously Improved
Previous design sprints have already significantly upgraded POS quality:
- Refined warm ivory palette + gold brand tokens (`--page-bg: #F7F5F1`)
- Elevation scale (`elev-1` through `elev-4`)
- Button press effects (`scale(0.975)`)
- Focus-visible for keyboard users
- Card hover lift, input hover states
- Modal system with animations
- Toast system with semantic borders
- Skeleton shimmer
- Categories tab, underline WorkspaceTabs
- ProductsPage redesign with HR layout patterns

### What Remains (7 Sprints - Time Estimates Are Rough/Untrusted)
The plan breaks remaining work into 7 sprints:
1. Tokens + primitives (additive, no breaking changes)
2. Shell/nav/login/settings
3. Dashboard + reports
4. Products/inventory/customers tables
5. Main POS sales screen - **HIGH RISK, must verify with real sales-flow smoke test**
6. Receipts/invoices/print views
7. Final QA pass

---

## Design Decisions Made

1. **Keep gold brand** - POS uses `#9C6F14` deep gold, NOT HR's `#5b45d4` violet. This plan targets Titan HR design LANGUAGE (patterns, scale tokens, interaction behaviors), not HR's violet brand color. Gold accent stays unless product owner explicitly wants identical HR violet branding.
2. **Keep always-dark sidebar** - POS tradition, does not need to follow HR's light-sidebar-in-light-mode.
3. **Keep touch targets large** - POS checkout product tiles stay 62px minimum (HR's 44px rows are too small for touch).
4. **Keep receipt/print independent** - Print is a different medium.
5. **No shared UI package yet** - HR and POS are separate products. Future: extract `@titan/ui` with theme support.
6. **Additive token migration** - Add new scale tokens, do not remove existing ones. No breaking changes.

---

## Approvals
- [x] Design team: confirm gold brand vs violet accent - **GOLD KEPT**
- [x] Product owner: confirm sprint priority order
- [x] Engineering: POS-UI-5 risk acknowledged, requires smoke test
- [ ] DevOps: schedule Railway deployment

---

## Implementation Started
- [x] Corrections applied to plan + handoff files
- [ ] POS-UI-1: Tokens + Primitives - in progress
- [ ] POS-UI-2: Shell + Nav + Login + Settings
- [ ] POS-UI-3 through POS-UI-7: pending

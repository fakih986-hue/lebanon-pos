# Sprint plan: dual-currency drawer accounting

Status: 2026-10-16. **Plan only. Nothing here is implemented.** This is one bounded correctness sprint, separate from design work and from the rounding policy.

## Goal

The drawer holds two currencies, so it is accounted for in two currencies:
- Every cash event records the USD and LBP that **physically** moved.
- A shift's expected cash is computed **per currency**.
- The close counts USD and LBP **separately**.
- The variance is reported per currency.

A combined USD figure remains, but only as a reporting value at a stated rate. It never proves the drawer balances.

## Out of scope

- **The rounding policy.** It is not approved yet. Today's rounding and change calculation are unchanged; this sprint records what that calculation hands over.
- Receipt redesign, and the remaining screen migrations.
- Authenticated cashier attribution (`docs/PERMISSIONS-ENFORCEMENT.md`).

## What exists today

| Event | Stored now | Physical movement derivable? |
|---|---|---|
| Cash sale | `SaleTender`: `paidUsd`, `paidLbp`, `changeUsd`, `changeLbp`, `changeCurrency`, `exchangeRate` | **Yes.** USD = paidUsd − (changeCurrency = USD ? changeUsd : 0); LBP = paidLbp − (changeCurrency = LBP ? changeLbp : 0). Today `changeUsd` and `changeLbp` are both stored (one is the other's conversion); only `changeCurrency` was handed back |
| Cash refund | `SaleRefund.total` (USD), `exchangeRate` | **No.** The payout currency is not recorded |
| Expense, supplier payment | `amount` (USD), `paymentMethod`/`method` | **No.** USD only |
| Cash in/out, owner draw | `CashMovement.amountUsd` | **No.** USD only |
| Opening float | `Shift.openingFloatUsd` | **No.** USD only |
| Close | `Shift.expectedCashUsd`, `closingCashUsd`, `differenceUsd` (combined) | n/a |

## Changes, in four bounded groups

### Group 1: server schema, capability and ledger (API)

**Additive, nullable columns** (one migration; nothing renamed; existing columns keep their meaning):

| Model | Columns |
|---|---|
| `Shift` | `openingFloatLbp`, `drawerLedgerVersion`, `expectedDrawerUsd`, `expectedDrawerLbp`, `countedDrawerUsd`, `countedDrawerLbp`, `varianceUsd`, `varianceLbp`, `closingRate` |
| `SaleRefund` | `payoutUsd`, `payoutLbp` |
| `Expense`, `SupplierPayment`, `CashMovement` | `currency` (`USD` / `LBP`), `amountLbp`. The existing USD amount keeps the USD value at the event's rate |

**Ledger function** `drawerLedger(shift, events) → { usd, lbp }`:
- one pure module, byte-identical in `apps/api/src/lib/` and `apps/desktop/src/features/pos/lib/`, like `refundAllocation.ts`;
- checked by shared vectors in `packages/shared/test-vectors/drawer-ledger.json`.

**Capability** `drawer-ledger-v1`:
- The server advertises it.
- The server records each device's sync schema (from `x-titan-sync-schema`).
- The tenant switch is server-owned. It turns on only when every active device and hub is on the new schema.

**Validation.** A pushed v1 event must state both currencies consistently: `amountLbp` equals `amountUsd × rate` within the event's rounding, or the event is a pure single-currency event. A refund payout must not exceed the sale's net paid per currency (the cumulative rule from the rounding proposal applies only once that policy is approved; until then, payouts are capped per currency).

**Tests (real Postgres):**
- migration applies on a copy of the scratch schema;
- capability gating, with old clients refused explicitly (no silent dropping);
- a pushed v1 shift reconciles per currency;
- legacy rows are untouched.

### Group 2: desktop services (no UI change yet)

- Services record the physical movement per currency:
  - `shift.service`: float in both currencies.
  - `cashMovement.service`, `expense.service`, the supplier payment service: currency + amount.
  - `sales.service` refunds: payout currency, default the sale's tender breakdown.
- `computeShiftCashBreakdown` becomes `drawerLedger`, with one implementation used by the drawer widget, StaffPage, `accounting.helpers` and the server X- and Z-reports. Today four copies exist.
- Sync payloads include the new fields **only** when the connected server advertises the capability. Otherwise the device records v0 events exactly as today.
- An operation that can't be stored is held (kept and flagged, never stripped).
- Tests: vectors; legacy v0 and v1 shifts side by side; offline then sync; a capability-less server holds the operation.

### Group 3: drawer and close UI (Midnight Gold v2 components)

- Opening float: USD and LBP fields.
- Close:
  - count USD and count LBP;
  - expected and variance shown per currency;
  - the combined figure underneath, labelled "at 89,500 LBP/$ (today's rate), reporting only".
- Expense, cash in/out and owner draw get a currency selector. The default is USD, as today.
- Refund dialog: a payout per currency, prefilled from the sale's tender breakdown.
- QA: fresh-profile phone, tablet and desktop scenes, EN/AR, with the existing harness.

### Group 4: reports and end-to-end

- X-report, Z-report, daily close and accounting: per-currency drawer lines; the combined line labelled with its rate.
- End to end on the scratch DB: open a shift with $100 + 500,000 LBP, then run:
  - an LBP sale, a USD sale and a mixed sale with LBP change;
  - a partial LBP refund;
  - an LBP expense, a USD cash-in and an owner draw;
  - a close with counted notes.

  Expected USD and expected LBP must equal the counted notes exactly. X and Z must agree. A legacy closed shift must come out byte-identical.

## History and open shifts

- **Closed shifts are never recomputed.** Their combined `expectedCashUsd` and `differenceUsd` stay as stored.
- **The version is stamped at shift open** (`drawerLedgerVersion`). A shift open when the switch flips finishes as v0, with today's single-currency close.
- **Old events stay as they are.** Sales already have a derivable per-currency movement. Refunds, expenses, supplier payments and cash movements from v0 have no recorded currency, so reports show them as USD, as recorded, and never infer an LBP amount.

## Acceptance

- [ ] Every cash event in a v1 shift records USD and LBP movements; none is inferred from today's settings.
- [ ] Expected USD and LBP match the counted notes exactly in the end-to-end scenario.
- [ ] The desktop drawer, StaffPage, accounting, X-report and Z-report give the same per-currency figures (shared vectors).
- [ ] An old server or hub refuses or holds v1 operations explicitly. No field is silently dropped.
- [ ] v0 shifts and closed shifts are unchanged.
- [ ] Both test suites, typecheck, lint baseline and build pass; real-DB tests run on the scratch DB only.

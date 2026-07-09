# Sprint POS-COMM-3 — Customer Debt / Customer Profile Commercial Polish

**Status:** PLAN ONLY — Awaiting Review
**Date:** 2026-07-09
**Author:** OpenCode (DeepSeek V4)
**Preceded by:** POS-HARDEN-1 PASS, POS-COMM-2 PASS

---

## 1. Current-State Audit

### 1.1 What Already Exists (Do NOT Rebuild)

| Feature | Location | Quality |
|---------|----------|---------|
| Customer CRUD (add/edit/delete) | `CustomersPage.tsx` + `customer.service.ts` | Working |
| FIFO debt aging (`computeAging`) | `customer.service.ts:computeAging` | Correct — do not touch |
| DebtSale / DebtPayment models | `customer.service.ts` | Correct — do not touch |
| `recordDebtPayment` with amount validation | `customer.service.ts` | Correct |
| `recordDebtSale` with `reverseDebtSale` | `customer.service.ts` | Correct |
| `getCustomerLedger` with computed fields | `customer.service.ts` | Correct |
| `getCustomerActivity` timeline | `customer.service.ts` | Correct |
| Balance calculation (`debtTotal - paidTotal`) | `customer.service.ts` | Correct — do not touch |
| Customer statement download/print | `CustomersPage.tsx` | Working |
| WhatsApp debt reminder | `CustomersPage.tsx` | Working |
| Ledger totals (`getLedgerTotals`) | `CustomersPage.tsx` | Working |
| Aging buckets (current/30/60/90) | `CustomersPage.tsx` | Working |
| KPI cards strip | `CustomersPage.tsx` | Working |
| `checkoutBlocked` debt validation | `POSPage.tsx:275-278` | Correct — do not touch |
| Auto-select first customer for Debt | `POSPage.tsx:127-131` | Working |
| `creditLimitExceeded` calculation | `POSPage.tsx:269-273` | Correct — do not touch |
| `completeSale` debt recording | `POSPage.tsx:651-656` | Correct — do not touch |
| TenderPanel debt picker | `TenderPanel.tsx:240-289` | Working but needs UX polish |

### 1.2 Exact UX Gaps

| Priority | Gap | Impact |
|----------|-----|--------|
| **P0** | POS customer picker is a raw `<select>` — no search, no balance in options | Unusable with 50+ customers |
| **P0** | No inline customer creation from POS tender panel | Cashier must leave sale to add customer |
| **P0** | Credit limit exceeded is a passive color change, no explanation text | Cashier doesn't understand why sale is blocked |
| **P0** | Overpayment in debt payment silently capped to `min(amount, balance)` | User enters $500 for $300 balance, silently becomes $300 |
| **P1** | No archive/restore UI — functions exist in service (`archiveCustomer`, `restoreCustomer`) but not wired to buttons | Feature gap |
| **P1** | No sort/filter in customer list beyond text search | Can't sort by balance, oldest debt, last activity |
| **P1** | No credit limit progress bar | Manager can't assess risk visually |
| **P1** | No customer balance/risk shown in POS picker dropdown | Cashier selects blindly |
| **P2** | `"Bank Transfer"` and `"Refund Credit"` methods exist in `DebtPayment` type but not in UI | Missing payment methods |
| **P2** | Statement is plain-text only | No branded format |
| **P2** | No payment edit/void | Can't fix mistakes |
| **P2** | No merged-duplicate detection (same phone = separate customer) | Data quality issue |
| **P2** | No promise-to-pay / installment tracking | Feature gap |
| **P2** | No customer groups/categories | All customers are flat |

---

## 2. Proposed Scope

### Phase A: Customer List / Status Badges (Priority P0-P1)

| Task | File | Description |
|------|------|-------------|
| A1 | `CustomersPage.tsx` | Add sort controls: Name, Balance (highest first), Last Activity, Oldest Debt |
| A2 | `CustomersPage.tsx` | Make aging bars clickable — clicking a band filters the table to only customers with debt in that bucket |
| A3 | `CustomersPage.tsx` | Add "Archived" toggle checkbox — show archived customers (uses existing `archiveCustomer/restoreCustomer`) |
| A4 | `CustomersPage.tsx` | Add archive/restore button per row (uses existing service functions) |
| A5 | `CustomersPage.tsx` | Improve debt/risk badges: "Over limit" (rose), "Near limit" (amber, >80% of credit limit), "Good" (emerald, no debt) |
| A6 | `CustomersPage.tsx` | Add credit limit progress bar in table balance column (fills toward danger when balance approaches limit) |

### Phase B: Customer Profile / Statement Labels (Priority P1-P2)

| Task | File | Description |
|------|------|-------------|
| B1 | `CustomersPage.tsx` | Add credit limit progress bar in right-rail Ledger panel header |
| B2 | `CustomersPage.tsx` | Add `"Bank Transfer"` and `"Refund Credit"` payment method buttons to Pay Debt form |
| B3 | `CustomersPage.tsx` | Warn user when overpayment is capped — toast: `"Amount capped to $X (balance)"` |
| B4 | `CustomersPage.tsx` | Add `aria-label` and `aria-pressed` to payment method toggle buttons |
| B5 | `CustomersPage.tsx` | Add `aria-label` to action icon buttons (WhatsApp, edit, delete, download, print) |

### Phase C: POS Debt/Customer Picker Clarity (Priority P0)

| Task | File | Description |
|------|------|-------------|
| C1 | `TenderPanel.tsx` | Replace raw `<select>` with searchable combobox — input filters customers by name/phone, Enter selects first match |
| C2 | `TenderPanel.tsx` | Show balance + risk chip in dropdown options: `"Ali — $45 owed [Over limit]"` |
| C3 | `TenderPanel.tsx` | Add inline "New Customer" mini-form when no customers exist or user clicks + — name + phone only |
| C4 | `TenderPanel.tsx` | Add prominent `aria-label` to the customer dropdown |
| C5 | `TenderPanel.tsx` | When `creditLimitExceeded`, show explicit text: "Sale blocked — customer would exceed $X.XX credit limit" (replaces passive color-only warning) |

### Phase D: Accessibility + Verification (Priority P2)

| Task | File | Description |
|------|------|-------------|
| D1 | `TenderPanel.tsx` | Ensure all payment method buttons have `aria-pressed` (Cash/Card/Wallet/Debt already have this — verify) |
| D2 | `CustomersPage.tsx` | Tab order through customer list → right panel is logical |
| D3 | `CustomersPage.tsx` | Modal close (✕) has `aria-label` |
| D4 | All files | Run typecheck, tests, build. Verify 0 regressions. |

---

## 3. Explicit Non-Goals

The following MUST NOT be changed:

- [ ] Customer ledger math (`computeAging`, `balance = debtTotal - paidTotal`)
- [ ] Debt balance calculation (FIFO aging algorithm)
- [ ] `recordDebtPayment` validation logic (except overpayment warning)
- [ ] `recordDebtSale` / `reverseDebtSale` logic
- [ ] `checkoutBlocked` debt condition (`!selectedCustomer || creditLimitExceeded`)
- [ ] `completeSale` debt recording path (lines 651-656)
- [ ] `creditLimitExceeded` calculation (lines 269-273)
- [ ] Storage keys, localStorage/IndexedDB write functions
- [ ] Sync queue operations (`enqueueSyncOperation`)
- [ ] Backend API endpoints or Prisma schema
- [ ] POS tender math (cash change, USD/LBP conversion, `ceilLbp`)
- [ ] Exact LBP bug fix (POS-BUG-1 — already fixed, must not be regressed)
- [ ] Broad `CustomersPage` refactor (no splitting into sub-components at this stage)
- [ ] Customer type definition (no schema changes)
- [ ] Any stock/inventory/receiving/product behavior

---

## 4. Risk Assessment

### 4.1 What Could Accidentally Break Customer Debt?

| Risk | Likelihood | Severity | Mitigation |
|------|-----------|----------|------------|
| Changing `<select>` to combobox breaks `selectedCustomerId` state binding | Medium | High | Keep `onSelectCustomer(id)` callback identical; test with empty/many customers |
| Adding inline customer creation calls `addCustomer()` incorrectly | Medium | High | Use exact same `addCustomer` call shape as existing Add Customer panel; validate required fields |
| Adding `"Bank Transfer"`/`"Refund Credit"` to payment method buttons changes the `DebtPayment.method` type union | Low | Medium | These values already exist in the `DebtPayment.method` type — just exposing them |
| Modifying `CustomersPage` table structure breaks selection or KPI display | Low | Medium | Only add new columns/badges, don't rearrange existing columns |
| Archive/restore buttons call wrong function or wrong customer ID | Low | High | Use exact same pattern as product archive/restore (already working in ProductsPage) |

### 4.2 Highest-Risk Files

| File | Risk | Why |
|------|------|-----|
| `TenderPanel.tsx` | **HIGH** | Shared by CartBody and QuickPOSMode — any regression breaks checkout in two modes |
| `POSPage.tsx` | **HIGH** | `checkoutBlocked` is the gate for all sale completion — must not regress |
| `CustomersPage.tsx` | **MEDIUM** | Large file (965 lines) — targeted additions only, no restructure |
| `customer.service.ts` | **LOW** | Only used by CustomersPage — isolated risk |

### 4.3 What Needs Manual Verification

- [ ] POS Debt: select customer → credit limit exceeded → checkout blocked with explanation text visible
- [ ] POS Debt: select customer → credit limit OK → checkout succeeds
- [ ] POS Debt: no customer selected → Debt tile shows warning
- [ ] CustomersPage: sort by balance → table reorders correctly
- [ ] CustomersPage: archive customer → disappears from active view → toggles to archived view → visible
- [ ] CustomersPage: record payment with overpayment amount → toast warns about capping
- [ ] QuickPOS mode: Debt tile → customer picker works → checkout succeeds
- [ ] Full POS mode: Debt tile → customer picker works → checkout succeeds

---

## 5. Implementation Phases

### Phase A — Customer List / Status Badges (Estimated: small)

```
Files: CustomersPage.tsx (only)
Adds: sort controls, aging-band click filtering, archive toggle,
      archive/restore buttons, debt/risk badges, credit limit progress bar
```

### Phase B — Customer Profile / Statement Labels (Estimated: small)

```
Files: CustomersPage.tsx (only)
Adds: credit limit progress bar in ledger, Bank Transfer/Refund Credit methods,
      overpayment warning, aria-labels on action buttons
```

### Phase C — POS Debt/Customer Picker Clarity (Estimated: medium)

```
Files: TenderPanel.tsx (only)
Adds: searchable combobox, balance-in-options, inline New Customer form,
      credit-limit explanation text
```

### Phase D — Accessibility + Verification (Estimated: tiny)

```
Files: all touched, plus test files
Verifies: typecheck, 62+ tests, build, aria audit
```

---

## 6. Verification Plan

### Automated

```
1. npx tsc -p apps/desktop/tsconfig.json --noEmit   → PASS
2. npx vitest run apps/desktop                        → 62+ tests PASS
3. npx vite build apps/desktop                        → PASS
```

### Browser Smoke

| Check | Expected |
|-------|----------|
| `/customers` loads | KPI cards, table, right rail visible |
| Customer search | Filters by name and phone |
| Sort by balance | Highest balance at top |
| Debt/risk badges render | "Over limit" (rose), "Near limit" (amber), "Good" (emerald) |
| Archive button | Customer disappears from active view |
| Archived toggle | Shows archived customers |
| Record payment (overpayment) | Warning toast: "Amount capped to $X" |
| Bank Transfer payment method | Visible in Pay Debt form |
| Refund Credit payment method | Visible in Pay Debt form |
| POS Cash → switch to Debt | Customer picker visible |
| POS Debt with no customer | Checkout blocked |
| POS Debt with credit limit exceeded | Checkout blocked + explanation text visible |
| POS Debt with valid customer | Checkout succeeds |
| QuickPOS Debt same flow | Identical to full POS |
| No console errors | Clean console |
| `aria-label` on action buttons | Verified in DOM inspector |
| `aria-pressed` on payment method buttons | Verified in DOM inspector |

---

## 7. Files to Modify (Summary)

| File | Phase | What Changes |
|------|-------|-------------|
| `CustomersPage.tsx` | A, B | Sort controls, aging band filters, archive toggle, archive/restore buttons, debt/risk badges, credit limit progress bar, Bank Transfer + Refund Credit methods, overpayment warning, aria-labels |
| `TenderPanel.tsx` | C | Searchable customer combobox, balance-in-options, inline New Customer form, credit-limit explanation text |
| `customer.service.ts` | A | Add `getCustomersByRisk()` sort helper (pure function, no storage changes) |
| `POSPage.tsx` | **DO NOT TOUCH** | Tender/customer/debt logic already correct — no changes needed |
| `__tests__/core.test.ts` | D | 2-3 new tests for sort/risk helpers |

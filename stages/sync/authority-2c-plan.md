# POS-SYNC-AUTHORITY-2C — Inventory Reconciliation + Repair Tool (PLAN)

**Date:** 2026-07-14
**Status:** planning — no code yet
**Depends on:** 2A ledger (committed `7ed08f0`, must be live on the hub before 2C is useful)
**Principle:** surface and safely repair drift using three independent stock views. **Does not** change checkout or stock math, and **does not** make stock derive from the ledger (that's 2B, still gated).

---

## 0. Prerequisite (first task): seed opening balances for existing products

2A only records `Opening` for products created/bootstrapped after it went live. On an already-populated hub, pre-existing products have no opening movement, so `Σmovements ≠ Product.stock` for them. **2C-0:** a one-time, idempotent seed — for every product that currently has **no movements**, create `Opening` = current `Product.stock` (reuse `recordStockMovementOnce`, ref `opening:<syncId>`). Run once at 2C startup / via an admin action. After this, "ledger expected" is a true baseline. Record-only; changes no stock.

## 1. Three independent views (the heart of the tool)

For each product, compute and compare:
- **A — aggregate:** `Product.stock`.
- **B — open batches:** `Σ InventoryBatch.quantityRemaining WHERE status='Open'`.
- **L — ledger expected:** `Σ StockMovement.quantity` (opening + all deltas).

Differences surfaced: `A−B`, `A−L`, `B−L`. In a healthy store all three agree.

## 2. Read side — reconciliation report (2C-1, zero write risk)

- **API:** `GET /api/inventory/reconciliation` (admin/manager auth) → per-product rows:
  `{ productId, syncId, name, barcode, aggregate:A, openBatchTotal:B, ledgerExpected:L, diffAB, diffAL, diffBL, severity, classification[], suggestedAction }`.
- **Severity:** `ok` (all agree within epsilon), `warn` (small/ explainable), `error` (aggregate vs batch/ledger mismatch, negative batch, consumed-with-remaining, etc.).
- **Classifications:** reuse/extend the existing client-side `getReconciliationIssues` types (`stock_batch_mismatch`, `negative_batch`, `consumed_with_remaining`, `open_with_zero`, `stock_no_lots`, `orphan_batch`) + ledger-aware ones (`ledger_vs_aggregate`, `no_opening_baseline`).
- **UI:** an admin **Reconciliation** screen — list sorted by severity, filter "discrepancies only / all", each row shows A/B/L + diffs + suggested action. **Report only in 2C-1 (no repair button yet).**

## 3. Repair side — safe, ledgered, operator-confirmed (2C-2)

**Key rule: repair uses only the EXISTING adjustment path** (`recordStockAdjustment` → "adjust" op → already ledgered + tested). No new stock-mutation code, no direct writes, no negative stock (adjustment guards apply).

- Operator picks the **source of truth** per issue:
  - *Batches are truth* (the succarinee/evian class: aggregate over-stated vs empty/lower batches) → adjust aggregate to `B`.
  - *Physical count* → route to the existing Stock Count flow (already emits Count-Correction adjustments).
  - *Aggregate is truth* (untracked/legacy product with no batches) → leave, or create an opening/adjustment as chosen.
- Every repair: requires **confirmation + a reason**, produces a `StockAdjustment` (audit: `adjustmentNumber`, reason, note, valueImpact) **and** its `Adjustment` movement (audit trail), plus an `AuditEvent`.
- Guardrails: manager/admin only; one product at a time (or reviewed batch); repairs are themselves ledgered so the report reflects them immediately.

## 4. What 2C explicitly does NOT do
- Does not make `Product.stock` derive from the ledger (that's 2B, gated).
- Does not touch checkout / sale / refund / receive logic.
- Does not add the unique constraint or the product-update stock-strip (still separate).
- Repair never bypasses the adjustment path or writes stock directly.

## 5. Phasing
- **2C-0:** opening-balance seed for existing products (baseline). Record-only.
- **2C-1:** reconciliation report API + admin screen (read-only). High value, zero write risk — replaces "eyeball the DB."
- **2C-2:** repair actions via the adjustment path + confirmations + audit trail. Replaces manual DB fixes.

## 6. Open decisions for approval
1. **Opening-balance seed:** seed `Opening = current stock` for all existing products with no movements — confirm approach + when to run (2C startup vs explicit admin "initialize ledger" button).
2. **Repair truth-source model:** confirm "operator chooses truth (batches / physical count / aggregate), repair applies via adjustment" — vs a narrower "only offer aggregate→batch reconcile" first.
3. **Phasing:** ship **2C-1 (report-only) first** and gain confidence before enabling 2C-2 repair? (Recommended.)
4. **Installer/deploy:** 2C needs a hub build to be usable (UI + API). Bundle with 2A on the next installer — confirm timing.

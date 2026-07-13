# POS-SYNC-AUTHORITY-2A — Stock Ledger: Discovery & Record-Only Spec

**Date:** 2026-07-14
**Status:** discovery complete — spec proposed, **no code yet** (awaiting go-ahead)
**Principle:** formalize stock history without changing current behavior.

---

## 1. Headline finding: the ledger already mostly exists — **extend `StockMovement`, do not create a new table**

`StockMovement` (schema.prisma:774) is already ~80% a stock ledger:

| Field | Role |
|-------|------|
| `id` (uuid) | movement PK |
| `tenantId`, `productId` | scope |
| `type` | `Receive \| Sale \| Refund \| Adjustment \| WriteOff` |
| `quantity` | **signed delta** (−qty for sale, +qty for refund/receive/adjust) |
| `balance` | **running per-product balance after this movement** (a built-in projection checkpoint) |
| `reference` | **the source-event id** (saleId / refundId / batchId / adjustmentId / `void:<id>`) |
| `note`, `createdAt` | context + time |
| indexes | `(tenantId, productId)`, `(tenantId, createdAt)` |

The authoritative **server** helper `recordMovement` (sync.ts:655) is already called by **every** stock-changing path:

| Path | Call | Signed delta | `reference` |
|------|------|--------------|-------------|
| Sale | `recordMovement(pid,"Sale",-qty,saleId)` | − | sale UUID |
| Refund | `recordMovement(pid,"Refund",+qty,refundId)` | + | refund UUID |
| Void | `recordMovement(pid,"Refund",+qty,"void:"+id)` | + | `void:<saleId>` |
| Receive | `recordMovement(pid,"Receive",+qty,batchId)` | + | batch UUID |
| Adjustment | `recordMovement(pid,"Adjustment",Δ,adjId,reason)` | ± | adjustment UUID |
| **Stock count** | via **adjustments** (reason "Count Correction") → Adjustment movements | ± | adjustment UUID |

**`reference` already reuses the existing sale/refund/batch/adjustment UUIDs** — exactly the "no new idempotency keys" rule. And **`StockMovement` is hub-local (never synced to cloud)** — so the ledger naturally stays local; only projections/snapshots would sync.

**Conclusion: 2A is "complete + harden `StockMovement`," not "build a ledger from scratch." Much smaller and lower-risk than the original AUTHORITY-2A.**

## 2. Gaps to close in 2A (all additive, no behavior change)

1. **Source tracking missing on server movements.** The authoritative `recordMovement` records no `deviceId` / `registerId` / `cashier` (the *client-local* mirror has `userId`/`userName`, but the hub's does not). → Add nullable `deviceId`, `userId`, `userName`; thread them from the push op's `deviceId` + `req.auth`.
2. **No explicit `batchId`.** Movements are product-level; batch attribution lives in `sale.batchAllocations` / `adjustment.batchAllocations`. → Optional nullable `batchId` for batch-level traceability (nice-to-have).
3. **Ledger not independently idempotent.** Duplicate application is prevented *upstream* (sale/refund idempotency guards), so movements aren't double-written today — but the ledger itself has no guard. → Add `@@unique([tenantId, reference, type, productId])` (the per-line key works for multi-product sales sharing one saleId). Belt-and-suspenders.
4. **`WriteOff`/damage path unverified.** `writeOffStock` (product.service.ts:892, reasons Damage/Expired/Theft/Manual Correction) must be confirmed to flow through the **adjustment** op (ledgered) and not a **direct product update** (product/update path does NOT call `recordMovement` → would be unledgered). → Verify; if it's a direct update, route it through an adjustment/WriteOff movement.
5. **`balance` computed read-last-then-add.** Serialized within a single op's transaction, but two concurrent ops for the *same product* could race the running balance. → Low priority; note and optionally harden.
6. **No retention/compaction.** Unbounded growth. → See §3.

## 3. Retention / snapshot design (decide in 2A, implement minimally)

- Keep full movement detail for a configurable window (e.g. 6–12 months).
- Periodically write a **snapshot movement** per product (a checkpoint row carrying the current `balance`); `balance` already gives per-row checkpoints, so this fits the existing shape.
- **Compact**: prune movements older than the retention window *behind* the most recent snapshot (never lose the ability to reconstruct current balance).
- **Cloud**: keep the event stream hub-local; sync only periodic **snapshots/summaries** to the cloud if cloud-side history is wanted (keeps sync volume sane).

## 4. Record-only boundary (the safety guarantee of 2A)

- Stock continues to be driven by `Product.stock` + batch consumption exactly as today.
- The ledger stays **audit/reconciliation only** — **no** sale/refund/receive path reads from it to compute stock (that is 2B, gated).
- Net behavioral change of 2A = **zero**.

## 5. Tests 2A must add

- **Completeness:** each path (sale / refund / void / receive / adjustment / count-via-adjustment / write-off) emits exactly one correct signed movement with the right `reference`.
- **Idempotency:** a duplicate sale/refund produces **no** duplicate movements (upstream guard + new unique index).
- **Record-only parity:** enabling ledger fields changes no stock outcome.
- **Drift invariant (the seed for 2C):** `sum(signed quantity for a product) == Product.stock` at a checkpoint — this is exactly the drift detector 2C's reconciliation tool will surface.

## 6. Open verification items (finish before writing 2A code)

- Confirm `writeOffStock`/damage routes through an adjustment op (ledgered) vs a direct product update (gap #4).
- Confirm the concurrency exposure of the `balance` read-last-then-add under real multi-device load (gap #5).
- Confirm no OTHER stock-changing path exists that bypasses `recordMovement` (e.g. bulk imports, restore-from-cloud, migrations).

## 7. Sequence (agreed)

1. **2A** (this) — extend + harden `StockMovement`, close gaps, retention, tests. Record-only.
2. **2C** — reconciliation/drift report + safe repair tool on top of the ledger (replaces manual DB fixes).
3. **2B** — projection enforcement (stock derives from ledger). **Gated**: only if 2A/2C reveal drift that can't be safely controlled, and only with a full re-verification of every money path.
- Multi-hub / cloud-dashboard-edit conflict rules: **out of scope** until a real second hub exists.

---

# 8. Verification report (3 items — read-only, complete)

## Item 1 — Damage / write-off: **no gap**
`writeOffStock` (product.service.ts:892) → `recordStockAdjustment(quantityChange = −qty, reason)` → "inventory"/"adjust" op → server `recordMovement(..., "Adjustment", …)`. Damage/Expired/Theft/Manual-Correction all ledgered as Adjustment movements.

## Item 2 — `StockMovement.balance` concurrency: **low severity, advisory only**
`recordMovement` computes `balance` by reading the last movement then adding the delta. Each op runs in its own per-op `$transaction` (READ COMMITTED), so two concurrent movements for the **same product** can read the same prior balance and write the same running total. **Only the `balance` column is affected — the signed `quantity` deltas are always correct**, and `Product.stock` is updated atomically & correctly regardless. Truth = `sum(quantity)`, not `balance`. → Treat `balance` as advisory; the 2C reconciliation must compute from sum-of-deltas, not `balance`. Optional later hardening (DB-side atomic balance) — not required for 2A.

## Item 3 — Full stock-mutation bypass scan

**Final list of server-authoritative stock-changing paths:**

| Path | Location | Δ stock | Ledgered? |
|------|----------|--------|-----------|
| Sale | sync.ts (decrementProductStock + FEFO) | − | ✅ Sale · ref=saleId |
| Refund | sync.ts refund-create | + | ✅ Refund · ref=refundId |
| Void | sync.ts sale-void | + | ✅ Refund · ref=void:saleId |
| Receive | sync.ts inventory-receive | + | ✅ Receive · ref=batchId |
| Adjustment (incl. damage/write-off) | sync.ts inventory-adjust | ± | ✅ Adjustment · ref=adjId |
| Stock count | client → adjustment ops | ± | ✅ (as Adjustment) |
| **Delivery fulfill** | delivery.ts:679, 536 | − | ❌ **GAP** |
| **Delivery cancel/revert** | delivery.ts:538 | + | ❌ **GAP** |
| Product create (opening stock) | sync.ts / cloudSync create | initial | ❌ no "Opening" movement |
| Cloud bootstrap / explicit restore | cloudSync upsert (restore only) | set | ❌ no movement |
| Product update carrying `stock` | sync.ts product-update | — | ⚠️ **client hard-blocks** (product.service.ts:348); server unguarded |

**Gaps found:**
1. **Delivery orders (real).** `delivery.ts` changes stock via `decrementProductStock`/`increaseProductStock` on fulfill/cancel with **no** `recordMovement`. A genuine unledgered stock path.
2. **Opening balances.** New products + bootstrap/restore set initial stock with no movement, so `sum(movements) ≠ Product.stock` from t0. The 2C drift invariant needs either an "Opening" movement = initial stock, or an `opening + Σmovements == stock` definition.
3. **Product-update stock (defense-in-depth, low).** Client blocks it; server does not strip `stock` from a product/update patch. A rogue/legacy op could write stock unledgered.

## Final answer — is implementation safe now?

**Yes for the record-only core, with two carefully-handled items:**

**Safe, purely additive (record-only):**
- Add nullable `StockMovement.deviceId / userId / userName` (+ optional `batchId`); thread source into server `recordMovement`.
- Add `recordMovement` to **delivery.ts** fulfill/cancel (closes gap #1) — logs an existing stock change, does not alter the outcome.
- Emit **"Opening" movements** on product-create + bootstrap/restore (closes gap #2) — record-only.

**Handle with care (NOT bundled into "record-only"):**
- **Idempotency `@@unique([tenantId, reference, type, productId])`** — a unique constraint can FAIL to apply if historical duplicate movements exist. → Add as a **non-unique index + app-level idempotent write** in 2A; defer the unique constraint until a dedupe/verify pass confirms the column is clean.
- **Server-side strip of `stock` from product/update** (gap #3) — the one edit that changes an unguarded write (not purely additive). → Treat as a separate, explicitly-approved defense-in-depth item.

**Retention/snapshot:** design now, minimal implementation can wait until volume warrants (flag, not blocking).

**Conclusion:** 2A record-only is safe to implement. Net stock behavior change = zero. The only non-additive edges (unique constraint, product-update strip) are explicitly carved out for separate handling.

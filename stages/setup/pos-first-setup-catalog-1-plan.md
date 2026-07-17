# POS-FIRST-SETUP-CATALOG-1 — First-Time Product Catalog Setup (PLAN)

**Date:** 2026-07-18
**Status:** planning pass — **no code**
**Builds on:** Bulk Import (ONBOARDING-1), Catalog Cleanup (CLEANUP-1), Image Batch (IMAGE-BATCH-1), CREATE-STOCK-1, RECEIVE-1, AUTHORITY-2A ledger.

---

## 0. Two facts that shape this design

1. **`StockMovement.type` is a free string** (`schema.prisma`: `// Receive | Sale | Refund | Adjustment | WriteOff | Opening`). The server *already* records an **`"Opening"`** movement (`sync.ts` create handler, `reference: opening:<syncId>`) — but only when a `product.create` carries non-zero stock, which **never happens now** (CREATE-STOCK-1 sends `stock:0`). So today opening stock records as **`"Receive"`**, indistinguishable from daily purchases. Distinguishing it needs **no schema migration** — just routing to `type:"Opening"`.
2. **Receiving / purchase reports are Purchase-Order-based** (`recordPurchaseOrder` / `getPurchaseOrders`, shown in Suppliers). Opening stock creates **no PO**, so it is **already excluded** from purchase/supplier reports. The only place opening stock currently pollutes is the **stock-movement ledger** (logged as `Receive`).

**Implication:** the whole feature hinges on one small primitive — commit opening stock as an **`Opening`** batch+movement (not `Receive`), with **no PO** — then wrap it in a wizard. Everything else is reuse.

---

## 1. UI location & flow

- **First-run wizard** — shown when the store is genuinely fresh: **catalog empty AND no sales history** (data-driven, so it never nags an active store), dismissible via a device-local flag `lebanonpos.setup-completed.v1`.
- **Permanent entry:** **Settings → Data & Setup → "Set up product catalog"** to reopen the wizard any time (kept separate from the daily **Receive stock** screen so setup never looks like receiving).

Wizard steps:
```
Welcome  →  Choose method  →  [Import | Scan | Sample | Empty]  →  Preview  →  Confirm  →  Done
```
- Welcome states plainly: "This is opening inventory — a starting count, not a supplier purchase."
- If the store already has sales/stock (see §6), show a warning gate before any method.

## 2. Setup methods

| Method | Behaviour | Reuse |
|---|---|---|
| **Spreadsheet import** | paste/upload the full-column CSV; preview; commit in **opening mode** | `parseProductImport` + `analyzeProductImport` (ONBOARDING-1); commit via the new opening primitive |
| **Scan one-by-one** | a lightweight opening-entry list (scan barcode → name/price/opening qty), no supplier/PO fields | Receive row UI patterns, but opening-mode commit |
| **Start empty** | create nothing; just mark setup done | flag only |
| **Sample / demo catalog** | seed a small, clearly-labelled demo set for trialing; one-click wipe | a bundled fixture + opening primitive |

## 3. Data model

| Concept | Representation | Schema change? |
|---|---|---|
| Opening stock (aggregate) | `Product.stock` incremented once via the opening op | none |
| **Opening batch** | an `InventoryBatch` (FEFO/reconciliation-compatible) with `batchNumber` `OPENING-<date>` (convention; no new column) | none |
| **Opening movement** | `StockMovement` **`type:"Opening"`**, `reference: opening:<batchId>` | none (free string) — add `"Opening"` to the **client** `MovementType` union (additive) |
| Setup-completed flag | `lebanonpos.setup-completed.v1` (device-local) + data-driven "empty catalog & no sales" check | none |
| No PO | opening commit never calls `recordPurchaseOrder` | none |

## 4. Reuse points (exact)

- `import.service.ts` → `parseProductImport`, `analyzeProductImport` (preview + conflict classification), template/export.
- `catalogHealth.ts` → `analyzeCatalog` (post-setup cleanliness check inside the wizard's Done step).
- `productImage.service.ts` → `completeMissingImages` (optional "add images now?" step after commit).
- `product.service.ts` → `createProduct` (already `stock:0` create + metadata + aliases + `parentId` variants).
- `inventoryBatch.service.ts` → the batch/receive path, extended with an **opening** flag.

## 5. Commit behaviour (opening mode)

Per staged row (from the analyzer's plan):
- **create** → `createProduct({... stock: openingQty, barcodeAliases, parentId?, variantName? })`. Today createProduct's opening-batch call records `Receive`; **the new opening primitive records it as `Opening` instead** (see §7).
- **aliases** → `barcodeAliases` on create (conflict-checked).
- **variants** → `parentId` + `variantName`; parent flagged `isParent`.
- **opening stock** → **opening batch + `Opening` movement**, aggregate +qty, **once** (reconciliation A = B = L).
- **NO** supplier, **NO** PurchaseOrder, **NO** `Receive` movement.

Existing/duplicate barcodes and alias conflicts are **rejected in preview** (reuse analyzer rules) — a first-setup should not restock; it establishes the catalog.

## 6. Safety

- **Preview before commit** (reuse the import dry-run: create/existing/variant/conflict/invalid counts + lists). No mutation until Confirm.
- **Duplicate & conflict checks** — reuse `analyzeProductImport` (barcode owned by another product → reject; name collision → warn; alias/variant rules).
- **Confirm** step with a plain summary ("Create N products, opening stock for M, no supplier purchase recorded").
- **Warn if the store already has history** — if any sales exist, or products with stock/batches exist, the wizard shows: *"This store already has activity. Opening setup is for a brand-new store and records stock as opening inventory (not purchases). Use Bulk Import or Receive stock instead."* Require an explicit extra confirmation to proceed (or steer away). This is the key guard against polluting a live store.

## 7. The one new primitive: opening-mode stock

Add an `opening` flag to the opening-stock path so the batch + movement are tagged `Opening`, not `Receive`:
- **Client:** add `"Opening"` to `MovementType`; `receiveInventoryBatches(entries, { opening: true })` (or a dedicated `openingInventory(...)`) sets `opening:true` on the enqueued `inventory/receive` payload and records the local movement as `Opening`.
- **Server (`sync.ts` inventory/receive handler):** when `opening:true`, record the ledger movement as `type:"Opening"`, `reference: opening:<batchId>` (instead of `Receive`) — same idempotent single increment, same batch creation. Purely a branch on movement type; **no change to the Receive path, no schema change**.
- **Reconciliation:** opening batch (B) + Opening movement (L) + aggregate (A) all post once → A = B = L holds (the reconciliation report already sums all movement types for L).

## 8. Reports

- **Purchases / supplier reports** — PO-based; opening stock has no PO → already excluded. ✅ (no work)
- **Stock-movement ledger / product history** — opening now shows as **`Opening`**, cleanly separable from `Receive`. Add an optional **"Opening inventory"** summary (Σ `Opening` movements) distinct from **"Purchases"** (Σ POs). *(Phase 1F.)*
- **Daily receiving report** must exclude `Opening` movements if it ever sums movements (today it's PO-based, so safe).

## 9. Risks

- **R1 — server movement-type branch.** Must not alter existing `Receive` behaviour; additive `opening` flag only. Cover with an API test (opening → `Opening` movement + increment once; unset → `Receive` as today).
- **R2 — reconciliation drift.** Opening batch + Opening movement must post exactly once each. Regression test A = B = L for an opening commit.
- **R3 — polluting an active store.** The history warning (§6) must reliably detect existing sales/stock before allowing opening mode.
- **R4 — demo catalog residue.** Sample data must be one-click removable (tag demo products; a "remove sample data" action).
- **R5 — multi-device first-run.** Use the data-driven "empty & no sales" check (not just a local flag) so a second device on an already-set-up store doesn't show the wizard.
- **R6 — hub-authoritative stock.** Opening batches flow through the same authority as receiving; ensure they aren't stripped/re-applied by AUTHORITY-1 pulls (reuse the receive path, which is already correct).
- **R7 — installer/deploy.** The server branch (R1) means a future build **and** a Railway deploy are needed for cloud parity (no migration).

## 10. Implementation phases

- **1A — Opening primitive (foundational).** Client `MovementType += "Opening"`; opening flag on the batch/receive path; server records `Opening` movement on the flag. Tests: opening vs receive movement type; reconciliation A=B=L. *(Server change → later Railway deploy.)*
- **1B — Wizard shell + detection.** First-run detection (empty & no sales) + Settings → Data & Setup entry; "Start empty"; Welcome/Confirm/Done scaffold.
- **1C — Import method.** Reuse the import analyzer/preview; commit in opening mode.
- **1D — Scan one-by-one.** Opening-entry list (no supplier/PO).
- **1E — Sample/demo catalog** + one-click removal.
- **1F — Opening-inventory report** (separate from purchases) + the active-store warning polish.

## Acceptance (this pass)
No code. UI flow (§1–2), data flow + the single new primitive (§3, §5, §7), exact reuse points (§4), safety (§6), reports separation (§8), risks (§9), phased plan (§10). Recommend starting with **1A** (the opening primitive) since every method depends on it; it's the only server-touching piece and can be built + tested in isolation before any wizard UI.

# POS-RECEIVE-UX-1 — Unknown-Barcode Decision Flow (PLAN)

**Date:** 2026-07-14
**Status:** planning pass — **no code**
**Builds on:** POS-PRODUCT-CREATE-STOCK-1 (opening-stock double-count fixed), POS-BARCODE-ALIAS-1 (alias matching correct in scan/search/dedup/server identity).
**Guardrail:** no stock/tender/tax/refund/sale/ledger math changes; `inventory/receive` remains the single authority for received quantity; aliases share the product's one price.

---

## 1. Current row states (exact)

Source: `apps/desktop/src/pages/products/ProductReceivePage.tsx`. Each row is a `BatchRow`
(`{ id, name, category, quantity, cost, price, reorderPoint, reorderQuantity, expiryDate, barcode, labels, accent }`).
Row readiness = `isRowReady` = `name && barcode && quantity > 0`. Matching is recomputed on every render via
`findProductByBarcode(row.barcode)` (alias-aware after ALIAS-1).

| # | State | Trigger | What renders today | Gap |
|---|---|---|---|---|
| 1 | **Empty barcode** | new row | fields blank, no banner | — |
| 2 | **Known primary barcode** | scan/type a product's primary | green "Restocking: {name}" banner; Name/Category **disabled**, prefilled; Stock preview `s → s+qty` | OK |
| 3 | **Known alias barcode** | scan/type an alias | same as #2 (resolves via `productHasBarcode`); `fillRowFromBarcode` sets `row.barcode = product.barcode` (the **primary**) | ⚠ scanned alias value is discarded from the row (loses scan context) |
| 4 | **Unknown barcode, no lookup** | scan/type new code | amber "New product" banner; if `barcode.length ≥ 3 && !name` → hidden `<select>` "**+ Add as alias of...**" listing **every** product | ⚠ picker unsearchable; ⚠ only shows while name empty; ⚠ **writes immediately** |
| 5 | **Unknown barcode + catalog suggestion** | UPCitemdb/OpenFoodFacts hit | blue "Tap to use" suggestion → fills name/category | OK as accelerator; disappears once name set |
| 6 | **Typed name matches existing product** | user types "Pepsi", unknown barcode | **nothing** — treated as a brand-new product | ⚠ no "already exists" nudge → duplicate product |
| 7 | **Same name, different price** | as #6 with different price | new product created with its own price | ⚠ silent duplicate; owner intent ambiguous (new size? mistake?) |
| 8 | **Same name, same price** | as #6 | new product created (duplicate) | ⚠ the classic "two Pepsis" problem |
| 9 | **Duplicate barcode conflict** | barcode belongs to a product but row name/category differ | on Save, `receiveProducts` rejects: `"{barcode}" already used by "{name}"` | OK (reject) but only surfaces at Save, not inline |

**Immediate side-effect (state 4):** selecting a product in "+ Add as alias of..." calls
`updateProduct(targetId, { barcodeAliases: [...] })` **during onChange** — it persists + enqueues sync
**before Save Batch**, and an abandoned batch still mutates data. This is the main behavior to remove.

**Save path today:** `saveBatch()` → `receiveAndRecord(rows, context)` → `receiveProducts(entries)`.
`ProductReceiveInput` has **no alias/decision field**; every entry is either "barcode matches → restock" or
"no match → create new". There is no "attach this barcode to product X" path through Save.

---

## 2. Final row decision model

Give each row an explicit **decision** (discriminated by `mode`) instead of inferring intent from field emptiness:

| mode | Meaning | Resolves at Save to |
|---|---|---|
| `matched` | barcode already belongs to a product (primary or alias) | restock that product by `quantity` (metadata refresh as today) |
| `new` | staged brand-new product | create product (stock:0 create + `inventory/receive` qty) + optional metadata |
| `alias` | staged: attach `barcode` as an alias of an existing **targetProductId**, and restock it | add alias to target (conflict-checked) **and** `inventory/receive` qty for target |
| `variant` | staged variant / pack size of a parent (deferred to 1D) | out of scope this sprint |
| `conflict` | barcode used by a different product, or alias collision, or invalid | blocked from Save with inline reason |

- Default on scan: `matched` if `findProductByBarcode` hits; otherwise `new`.
- The row carries `targetProductId?: number` (set only in `alias`/`variant`).
- `matched` and `alias` rows keep the target's **single price** (price field read-only, mirrors current disabled Name/Category on match) — this is the Pepsi invariant.

---

## 3. UX

### 3.1 Immediately after scanning an **unknown** barcode
Replace the hidden select with an inline **decision strip** on the row (no modal for the common path; a compact drawer only for the picker). It shows three explicit buttons plus the existing accelerators:

```
Unknown barcode 6291041500213
[ + New product ]   [ ↳ Add to existing product ]   [ ⧉ Variant / pack ]   (Skip)
Suggested: "Pepsi 330ml" (catalog)  ·  Tap to use
```

- **+ New product** → row.mode = `new`; unlocks Name/Category/Price/Cost/Qty (as today).
- **↳ Add to existing product** → opens the searchable picker (3.2); on pick → row.mode = `alias`.
- **⧉ Variant / pack** → 1D (disabled/"coming soon" until Sprint 5).
- **Skip** → clears the row's barcode (scan again), no state kept.
- Catalog suggestion stays as a one-tap name filler for the `new` path.

### 3.2 Searchable "add to existing product" picker (replaces the unsearchable `<select>`)
- A small popover/drawer with a search box (name **or** barcode/alias, via `productMatchesSearch`), results list capped (e.g. top 20) each showing **name · primary barcode · price · current stock**.
- Picking sets `row.mode = "alias"`, `row.targetProductId`, prefills name/category/price/cost from the target (read-only), keeps the **scanned barcode** as the alias to attach (fixes state #3's lost-context gap).
- No write happens here — staged only.

### 3.3 Name-match warning (states 6–8)
When a row is `new` and the typed `name` normalizes to an existing product's name:
```
⚠ "Pepsi" already exists (barcode 5449000000996, $0.75).
   [ Add this barcode to it ]   [ Keep as new product ]
```
- **Add this barcode to it** → converts row to `alias` targeting that product (one click).
- **Keep as new product** → dismisses the nudge for this row (owner decides; not a hard block — two legitimately different products can share a name).
- If multiple products share the name, the button opens the picker (3.2) pre-filtered.

### 3.4 Save Batch
- Validate all rows; any `conflict` row blocks Save with an inline reason (surfaced *before* Save, not only after).
- Writes happen **only here**, once, in this order per row:
  - `matched` → restock (unchanged).
  - `new` → create (stock:0) + receive qty (unchanged, already correct).
  - `alias` → (a) attach barcode to `targetProductId` via the alias-aware update, (b) receive qty for the target. Both idempotent-safe; stock only via `inventory/receive`.
- Summary reflects **receive actions** (created / restocked / aliased / batches), addressing the "summary is product-count based" gap.

### 3.5 Abandon
- Because every decision is staged in row state and **nothing writes until Save**, closing/clearing the batch (`resetBatch`, navigation away) mutates nothing. This removes today's immediate-alias-write side-effect.

### 3.6 Avoiding side effects before Save
- Remove the `onChange`→`updateProduct` call.
- Picker/decision buttons only set row fields (`mode`, `targetProductId`, name/price mirror).
- Catalog lookup remains read-only (external fetch; no writes).

---

## 4. Technical model

### 4.1 Staged in row state (no writes)
Extend `BatchRow` with:
```
mode: "matched" | "new" | "alias" | "variant" | "conflict"
targetProductId?: number    // alias/variant target
targetPrimaryBarcode?: string
conflictReason?: string
```
Matching/decision derives `mode` on scan; user actions mutate it. `isRowReady` extends: `alias` rows need `targetProductId` + `quantity > 0`; `new` rows unchanged.

### 4.2 Writes only on Save Batch
`saveBatch()` partitions ready rows by `mode` and passes decisions down (no writes in the UI layer).

### 4.3 `receiveProducts` — accept alias decisions (additive, back-compatible)
Extend `ProductReceiveInput` with an optional decision:
```
attachAliasToProductId?: number   // when set: attach `barcode` as an alias of this product, then receive qty for it
```
Behavior when set:
- Look up target by id; if missing → reject.
- If `barcode` already primary/alias of the target → no-op alias add (still receive qty).
- If `barcode` belongs to a **different** product → `conflict` (reject; reuse ALIAS-1 checks).
- Else add `barcode` to the target's `barcodeAliases` (via the existing alias-aware update path) and push a receive batch for the target (qty, cost, price of the **target**, not new pricing).
When unset → today's behavior (match-or-create) unchanged. `receiveAndRecord` threads the new field from the row.

### 4.4 Alias sync
Aliases attached at Save flow through `updateProduct` → `product.update` sync op carrying `barcodeAliases`
(server persists them, ALIAS-1). Other devices/cloud pick them up; POS resolves them (already). No new sync entity.

### 4.5 Out of scope (explicit)
- **Images** — Sprint 4 (POS-PRODUCT-IMAGE-1).
- **Pack-size stock multipliers / full variants** — Sprint 5 (POS-PACK-VARIANTS-1); the `variant` mode is a stub here.
- **Per-alias pricing** — intentionally unsupported; aliases share the product's single price (the Pepsi model).

---

## 5. Implementation phases

- **1A — Unknown-barcode decision strip + staged alias.** Add `mode`/`targetProductId` to `BatchRow`; render the decision strip; implement `new` vs `alias` staging; remove the immediate `updateProduct` side-effect; extend `receiveProducts`/`receiveAndRecord` with `attachAliasToProductId` and apply on Save. *(Core of the sprint.)*
- **1B — Searchable existing-product picker.** Replace the full-list `<select>` with the search popover (3.2); reuse `productMatchesSearch`; cap results; show name/barcode/price/stock.
- **1C — Name-collision warning.** Nudge on `new` rows whose name matches an existing product; one-click convert-to-alias (or open picker if ambiguous).
- **1D — Variant / pack-size flow.** Deferred to Sprint 5; `variant` mode stays a disabled stub until then.

---

## 6. Risk list

- **R1 — receiveProducts signature change.** Mitigate: `attachAliasToProductId` is optional; unset = today's exact behavior; covered by new unit tests (alias-decision receive + regression of match/create).
- **R2 — ProductReceivePage row-logic rewrite is sizeable.** Mitigate: ship 1A→1C incrementally; keep `matched`/`new` behavior byte-identical; land behind the same page (no route change).
- **R3 — Removing the immediate alias write changes current behavior.** It's a bug fix (abandoned batches no longer mutate). Note in the sprint; no data risk.
- **R4 — Picker performance with large catalogs.** Cap results + debounce search; render name/barcode/price only.
- **R5 — Name-collision false positives.** Warning is a nudge, never a hard block; owner can "Keep as new product."
- **R6 — Aliasing to the wrong product.** Require explicit pick; show primary barcode + price + stock; keep the scanned alias visible; conflict-check on Save.
- **R7 — Variant/pack semantics touch price/stock math.** Explicitly deferred; `variant` is a stub this sprint.
- **R8 — State #3 alias-scan context loss.** Fixed by keeping the scanned barcode as the alias rather than overwriting `row.barcode` with the primary.

## Acceptance (this pass)
No code. Current row states mapped (§1), final decision model (§2), UX (§3), data/state + `receiveProducts` model (§4), phased split 1A–1D (§5), risks (§6). Awaiting authorization to implement **1A**.

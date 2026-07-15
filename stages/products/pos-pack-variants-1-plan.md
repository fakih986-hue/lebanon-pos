# POS-PACK-VARIANTS-1 — Pack Sizes & Product Variants (PLAN)

**Date:** 2026-07-15
**Status:** planning pass — **no code**
**Builds on:** POS-BARCODE-ALIAS-1 (aliases), POS-RECEIVE-UX-1A/1C (decision flow + name nudge), POS-PRODUCT-IMAGE-1.
**Guardrail:** no stock/sync/tender/tax/refund/ledger changes; do not change barcode-alias behavior; do not implement variants/packs in this pass.

---

## 0. Headline finding

**Variants already exist and mostly work.** The data model, POS variant picker, catalog grouping, and ordering label are all shipped. **Packs do not exist at all** — today a "6-pack" can only be a separate product, which is exactly the recommended first-release policy. So this is less "build variants from scratch" and more "**fill the two real gaps** (create variants during receiving; polish ordering grouping) and **decide the pack policy**."

---

## 1. Current product model (exact)

`apps/desktop/src/features/pos/types/product.ts` + `apps/api/prisma/schema.prisma` (migration `20260526211605_variants_delivery`):

| Field | Meaning today |
|---|---|
| `id` / `syncId` | local id / cross-system identity |
| `name` | product name |
| `barcode` | primary barcode (one product) |
| `barcodeAliases: string[]` | **same sellable item, same price, same stock bucket** (ALIAS-1) |
| `price` / `cost` / `stock` | per-product (per-row) money + quantity |
| `parentId?: number \| null` | links a **variant** to its parent product |
| `isParent?: boolean` | marks a grouping parent |
| `variantName?: string` | e.g. "330ml", "Large", "Red" |
| `image?` | optional (IMAGE-1) |
| reorderPoint/Qty, supplier, expiry, favorite, archived | per-product |

**There is NO field for pack size / unit / pack quantity.** Packs have zero model support today.

## 2. Current UI (exact)

- **Create variants:** `createProduct({ parentId, variantName })` exists. ProductsPage **Add product** view has: "This product has variants" (`isParent`) toggle, a **Variants** table (list/remove), and an **Add variant** form (name/price/stock/barcode → child product). ([ProductsPage.tsx](../../apps/desktop/src/pages/products/ProductsPage.tsx))
- **POS grid + picker:** tapping an `isParent` product that has children opens **`VariantPicker`** (children filtered by `parentId`, each showing its own name/price/stock/barcode). Selecting adds that child to the cart. ([POSPage.tsx:323](../../apps/desktop/src/features/pos/pages/POSPage.tsx), [VariantPicker.tsx](../../apps/desktop/src/features/pos/components/VariantPicker.tsx))
  - Note: `filteredProducts` does **not** hide children, so a variant can also appear as its own POS card and be scanned/added directly. Acceptable (each variant is independently sellable) but worth a visual-grouping pass.
- **Catalog table grouping:** `ProductTable` groups variants under parents with expand/collapse (`parents = !parentId`, `variants` grouped by `parentId`, orphan-variant handling). ([ProductTable.tsx:222](../../apps/desktop/src/features/pos/components/ProductTable.tsx))
- **Ordering website:** MenuPage renders `variantName` as a subtitle on each product card — **flat list, no grouping/picker**. ([ordering/src/pages/MenuPage.tsx:394](../../apps/ordering/src/pages/MenuPage.tsx))
- **Receiving decision flow:** the 1A decision strip already has **New product / Add to existing (alias)**; the **"Variant / pack" button is present but disabled** ("coming later"). ([ProductReceivePage.tsx](../../apps/desktop/src/pages/products/ProductReceivePage.tsx))

**Gaps:** (a) can't create a variant *during receiving*; (b) no pack concept; (c) ordering site doesn't group variants under one card.

## 3. Product identity rules (definitions)

| Kind | Definition | Data representation | Stock | Price |
|---|---|---|---|---|
| **Alias** | Same sellable item, e.g. same Pepsi can from two suppliers with different barcodes | extra entry in `barcodeAliases` on **one** product row | **shared** (one bucket) | **shared** (one price) |
| **Variant** | Same family, genuinely different sellable item (330ml vs 1L; flavor/size) | separate product row with `parentId` → parent; `variantName` set | **separate** bucket | **separate** price |
| **Pack** | A sellable package of the same item (single can vs 6-pack) | **(first release)** separate product row (optionally `parentId` + a display-only `packQuantity`) | **separate** bucket | **separate** price |
| **Bundle** | Multiple *different* products sold together | — **out of scope**, not implemented, no model | — | — |

Decision test for a scanned/added barcode: **same price & interchangeable → Alias**; **different price / different size, same family → Variant**; **N-of-the-same-item in one scan unit → Pack**.

## 4. Commercial policy options (packs)

- **Option A — Packs are separate products, independent stock.** A "Pepsi 6-pack" is its own product/barcode/price/stock. Simplest and safest; **zero new stock math**; receiving/refunds/reconciliation unchanged. Downside: selling a 6-pack does not auto-decrement single-can stock (owner manages both buckets, or breaks packs manually).
- **Option B — Pack consumes N units of the parent/single.** Selling one 6-pack decrements 6 singles. Powerful, but it **touches every stock path**: sale decrement, refund restore, batch/FEFO consumption, receiving, reconciliation (aggregate vs batch vs ledger), and the hub-authoritative sync. High risk of the exact silent-drift class of bug we just spent sprints removing.
- **Option C — Hybrid.** Ship A now (separate stock), add an explicit, auditable **manual "break a pack into singles" conversion tool** later (a stock adjustment: −1 pack, +N singles, both ledgered). Never automatic.

## 5. Recommended first-release policy

**Adopt Option C, starting at Option A.** Concretely:
- **Variants = separate products, grouped visually.** (Already built; just finish receiving-time creation + ordering grouping.)
- **Packs = separate products with separate stock.** A `packQuantity` field, if added, is **display/labeling metadata only** — it does **not** couple stock.
- **No automatic single↔pack stock conversion in the first release.**
- A **manual conversion tool** (ledgered stock adjustment) is a later, explicitly-approved phase (1D), and **automatic depletion (1E) stays off** until separately approved.

Rationale (endorsed): auto pack-conversion sounds great for supermarkets but touches sale/refund/receive/reconciliation/sync simultaneously. Separate buckets keep every already-hardened stock path untouched; conversion can be layered on safely later as an *explicit, audited* operation.

## 6. UX (receiving decision — extends 1A)

When a scanned barcode is unknown, the decision strip offers four choices:
- **Same item (alias)** — 1A (shares price/stock). *(shipped)*
- **New product** — 1A. *(shipped)*
- **Variant of existing** — pick a parent (searchable, reuse 1A picker), then capture the variant's own fields. Creates a child product (`parentId` + `variantName`) via the existing `createProduct` path + its own opening receive. **No new stock math** — a variant create is just a product create, exactly like "New product" but linked.
- **Pack size of existing** — same as Variant in the first release (separate product), plus a `packQuantity` label; **no stock coupling**.

**Fields:** variant/pack name (`variantName` e.g. "1L"/"6-pack"), size/unit (free text label), pack quantity (label only, first release), price, cost, barcode (the scanned one), image (IMAGE-1), qty to receive. Alias reuses the parent's price (unchanged).

**Warnings (extends 1C):**
- Same **name** exists → nudge (already shipped).
- Same **name + same price** → suggest **alias** (interchangeable item).
- Same **name + different price/size** → suggest **variant**.
- These are nudges, never hard blocks; owner always decides.

## 7. Implementation phases

- **1A — Visual grouping only (variants as separate products).** Tidy the POS grid so children don't double-show alongside the parent picker; keep catalog grouping. Low risk, no model change. *(Mostly already present — audit/tighten.)*
- **1B — Receiving can create a variant linked to a parent.** Enable the disabled "Variant" path in the decision strip: pick parent → capture variant fields → `createProduct({parentId, variantName})` + receive. Reuses existing paths; no new stock semantics.
- **1C — POS / ordering-website grouped display.** Group variants under one card on the ordering site (parent card → choose size), matching the desktop picker. Commercial polish.
- **1D — Optional manual pack-conversion tool (approval-gated).** An explicit, ledgered adjustment: −1 pack ⇒ +N singles (and reverse). Never automatic. Its own sprint + tests + reconciliation review.
- **1E — Automatic pack stock depletion (separately approved only).** Sell 1 pack ⇒ auto −N singles across sale/refund/receive/reconciliation/sync. **Off** until explicitly authorized; highest risk.

## 8. Risks

- **R1 (highest) — auto pack conversion (1E) touches every stock path.** Mitigation: not in first release; separate buckets; conversion is manual + ledgered when it does land.
- **R2 — POS double-display of variants** (child card + parent picker) could confuse. Mitigation: 1A visual-grouping pass.
- **R3 — Alias vs variant misclassification** by staff (wrong bucket). Mitigation: the price-based nudges in §6; both are reversible before Save (staged).
- **R4 — `packQuantity` mistaken for stock coupling.** Mitigation: label it clearly as display-only in the first release; no code reads it for stock.
- **R5 — Ordering-site grouping** must not change desktop/POS behavior. Mitigation: 1C is presentation-only on the ordering app.
- **R6 — Parent product sellability ambiguity** (a parent with its own stock/price vs a pure grouping). Mitigation: document that a parent with children is a grouping (opens picker); revisit if needed in 1A.

## 9. Explicitly NOT implemented (this pass or first release)

- **No** automatic single↔pack stock conversion (1E) — not now.
- **No** pack→singles stock coupling of any kind in the first release (packs = separate stock buckets).
- **No** bundles (different products sold as one unit) — no model, out of scope.
- **No** changes to barcode-alias behavior, stock authority, sync, tender/tax/refund/ledger.
- **No** new stock math for variants — a variant is just a linked product create.
- **No code in this sprint at all** — design only.

## Acceptance (this pass)
No code. Alias/variant/pack/bundle defined (§3), pack policy options + recommendation (§4–5), receiving UX + warnings (§6), phased plan 1A–1E (§7), risks (§8), and an explicit not-implemented list (§9). Awaiting review to authorize **1B** (variant creation in receiving) as the first low-risk build step; pack conversion (1D/1E) stays gated.

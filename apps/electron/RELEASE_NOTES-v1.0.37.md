# Titan POS v1.0.37 — Receiving, Data Correctness & Images

**Type:** Desktop + hub build. **Server code changed** (barcode alias resolution in `sync.ts`).
**Baseline:** v1.0.36. **Schema/migrations:** none changed.
**Railway:** **not deployed in this build.** The bundled hub API contains the new
alias-aware resolution; the **cloud** will need a Railway deploy later to match
(no data/schema change — safe whenever authorized).

---

## What's in this build

### Data correctness
- **Opening-stock double-count fixed** (`createProduct`). New Product / Quick
  Create / Add variant previously sent full stock on create **and** a receive
  batch, doubling stock on the hub/cloud (24 → 48) with a matching duplicate
  ledger movement that reconciliation couldn't catch. Now the create sends
  `stock: 0` and the `inventory/receive` op is the sole authority (mirrors
  RECEIVE-1). Local display keeps the entered quantity.
- **Barcode aliases correct everywhere.** Duplicate detection now spans primary
  **and** alias barcodes (primary-vs-alias and alias-vs-alias, counted once).
  Server barcode identity (`resolveProductId`, product create/update fallback)
  now resolves by primary **or** alias — an alias match never overwrites the
  owner's primary barcode.

### Receiving
- **Unknown-barcode decision flow.** Scanning an unknown barcode now asks
  explicitly: **New product · Add to existing · Create variant · Skip** — no
  more silent duplicate products.
- **Staged alias, committed on Save.** "Add barcode to existing" uses a
  searchable product picker and is **staged in the row** — nothing is written
  until Save Batch (an abandoned batch mutates nothing). The old hidden
  "Add as alias of…" select that wrote immediately is gone.
- **Name-collision nudge.** Typing a name that matches an existing active
  product prompts *"'Pepsi' already exists — add this barcode to it?"* (soft;
  never blocks; never auto-merges).
- **Create a variant while receiving.** Make a variant of an existing product
  from the Receive screen — separate barcode/price/stock, parent flagged
  `isParent` (metadata only, parent stock untouched). No pack conversion.

### Images
- **Product images at create & receive.** Optional image in Quick Create and on
  new-product receive rows (upload → compressed to ≤300×300 JPEG data URL,
  works offline). Existing products' images are never overwritten on restock or
  alias.

### Navigation (from the earlier UX line, first shipped here end-to-end)
- Sidebar groups **Sell / Stock / Money**; **Receive stock**; dedicated
  **Stock & Batches** (`/stock`) workspace (Adjust & count · Batches ·
  Reconciliation); Products is catalog-focused; Settings **Devices & Sync**.

### Build hygiene
- The SPA copy step now **clears stale hashed bundles** before packaging. The
  packaged app carries exactly **one** `index-*.js` (was 16), shrinking the
  installer ~4 MB.

---

## Artifacts

| Artifact | File |
|---|---|
| NSIS installer | `apps/electron/dist-v8/Titan POS Setup 1.0.37.exe` |
| Portable EXE | `apps/electron/dist-v8/Titan POS 1.0.37.exe` |

### SHA-256
```
935cd9c18b613c3544ca8863018edbabb7a56cf0c101813058f293e2227bb4f1  Titan POS Setup 1.0.37.exe
278a90a30ba8731191d3241ac99728901dcef379e38fad8ed788636232f71ea3  Titan POS 1.0.37.exe
```

**Not published:** no GitHub release, no auto-update manifest (`latest.yml`
removed). Install manually when ready.

---

## Hub acceptance checklist
- [ ] Sidebar shows **Stock & Batches**; `/stock` opens (Adjust & count · Batches · Reconciliation)
- [ ] Settings shows **Devices & Sync**; Products shows catalog tabs only
- [ ] **New Product** with a picture; created product stock is correct (not doubled)
- [ ] **Receive** an unknown barcode → decision strip (New / Add to existing / Create variant / Skip)
- [ ] **Add to existing** attaches the barcode on Save (scan it at POS → resolves)
- [ ] Typing an existing name → **"already exists"** nudge
- [ ] **Create variant** → new product with its own price/stock; parent stock unchanged
- [ ] Received quantities land exactly once (aggregate = batches = ledger)

---

## Verification
- Typechecks: desktop / API / electron = 0
- Tests: desktop **145**, API **208**
- Packaged SPA: single bundle `index-C0BhkLli.js`; markers present
  (Stock & Batches, /stock, Devices & Sync, Unknown barcode, Add to existing,
  already exists, Creating variant, Variant has its own price, Image optional).
  *(“Stock tools” intentionally absent — that Products tab was replaced by
  `/stock` → “Adjust & count” in IA-2B.5.)*
- Packaged API bundle: alias-aware `barcodeAliases` resolution present.
- Double-count fix & alias-aware dedup verified by unit tests (minified in the
  bundle, so asserted at the source/test level).

## Notes
- **Railway deploy needed later** (cloud parity for alias resolution) — no
  schema change, deploy whenever authorized. Not done here.

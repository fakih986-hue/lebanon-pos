# Titan POS v1.0.39 — First-Time Catalog Setup & Onboarding

**Type:** Desktop client **+ server (sync) change.** **No schema/migration change.**
**Baseline:** v1.0.38. **Railway:** deploy required (sync.ts records opening
inventory as an `Opening` movement).

---

## What's in this build

### First-time catalog setup wizard (Settings → System + Dashboard prompt)
- **Fresh-store detection** classifies a store as fresh / active / review and
  shows a non-blocking, dismissible first-run prompt on genuinely empty stores.
- **Guided spreadsheet import** — paste/upload/template → dry-run preview
  (creates, restocks, variants, +barcodes, conflicts, invalid, opening
  units/value) → explicit confirm → commit. Commits into **opening inventory**.
- **Guided scan setup** — scan/type barcode with name/category/cost/price/qty,
  extra barcodes, optional image. Handles existing-product, alias, and
  name-nudge cases. Fast loop: Save & scan next / Save & finish / Clear row,
  with a session list + running opening totals.
- **"Start empty"** simply marks setup done.

### Opening inventory primitive (client + server)
- Starting stock is recorded as an **`Opening`** ledger movement in **`OPENING-*`**
  batches — **not** a daily Receive, and with **no supplier PO / payment**. Keeps
  purchase reports clean and the aggregate/batch/ledger in agreement.
- Server `inventory/receive` handler strips the transient `opening` flag and tags
  the movement `Opening` vs `Receive` (idempotent by batch id; backward
  compatible — absent flag = `Receive`).

### Opening inventory report (Stock & Batches → Opening inventory)
- New tab listing opening movements: date, product, barcode, category, quantity,
  unit cost, value, batch. Summary (products / units / value), date + category
  filters, CSV export. Deep link `?view=Opening`; linked from the wizard's Done
  step. Separate from daily receiving/purchase reports.

### Product onboarding & catalog tools (from this cycle)
- **Bulk product import** (parse → dry-run preview → commit), CSV template +
  current-catalog export.
- **Catalog cleanup panel** with health analysis and **bulk missing-image
  completion**.

*(Ordering-website and public-website changes from earlier cycles ship via their
own web deploys, not this installer.)*

---

## Artifacts

| Artifact | File |
|---|---|
| NSIS installer | `apps/electron/dist-v8/Titan POS Setup 1.0.39.exe` |
| Portable EXE | `apps/electron/dist-v8/Titan POS 1.0.39.exe` |

### SHA-256
```
189f269be2e59e10e31ed744423620bab7f0926dbcf8c52248e18936da9b48b2  Titan POS Setup 1.0.39.exe
1b76c1ca706aaa1bc3336fcd10d0e7846ce7222b657ae5605d062e176ccaae37  Titan POS 1.0.39.exe
```

**Not published:** no GitHub release, no auto-update manifest (`latest.yml` removed). Install manually.

---

## Hub acceptance checklist
- [ ] Dashboard on a fresh store shows the **"Set up your product catalog"** prompt; **Dismiss** hides it and it stays hidden
- [ ] Settings → System → **First-time catalog setup** opens the wizard
- [ ] **Import**: preview shows counts + opening units/value; confirm requires the acknowledgement checkbox; committed products appear with correct stock
- [ ] **Scan**: existing barcode prompts for opening qty; a new barcode whose name matches nudges "Add barcode / Keep as new"; Save & scan next resets the row
- [ ] **Stock & Batches → Opening inventory** lists the imported/scanned stock, totals are correct, **Export CSV** downloads; wizard Done → **View opening inventory report** lands here
- [ ] Imported/scanned opening stock creates **no** supplier purchase order or payment (check Suppliers/Purchases)
- [ ] Daily **Receive stock** still records normal `LOT-*` batches / Receive movements
- [ ] Everything from 1.0.38 still works (Safe backup export, dashboard action queue, Stock & Batches, product images, variant creation)

---

## Verification
- Typechecks: desktop / API / electron = 0 (desktop via `tsc -b`)
- Tests: desktop **220**, API **211**
- Packaged SPA: single root bundle `index-DaFgOKZX.js` (stale-asset hygiene applied); markers present — First-time catalog setup, Confirm opening inventory, Save & scan next, Opening inventory, `view=Opening`, Bulk import products, Catalog cleanup
- Schema/migrations: **none**
- Server: `sync.ts` opening-movement handling → **Railway deploy required**
